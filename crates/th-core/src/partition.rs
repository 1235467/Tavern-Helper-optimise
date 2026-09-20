//! Streaming partitioner — replicates `StreamingOne.vue`'s `contents` computed:
//!
//!   1. preprocess: `html.replaceAll('mes_text','TH-streaming')` + strip
//!      `<div class="TH-collapse-code-block-button">(显示|隐藏)(前端)?代码块</div>`
//!   2. top-level nodes → classify each:
//!        isFrontendElement(el)          → iframe      (class TH-render, or
//!                                          <pre> whose decoded text isFrontend)
//!        else containsFrontendElement   → nested_iframe (descendant div.TH-render
//!                                          or descendant frontend <pre>)
//!        else tag == 'details'          → details
//!        else                           → normal (text/markup/normal elements)
//!   3. merge consecutive normal chunks (chunkBy: only normal+normal merge)
//!   4. NEW: `sealed` per chunk — element closed AND not the last node, or a
//!      closed element at EOF. Trailing text/unclosed element = unsealed.
//!
//! Output: [u32 pp_len][pp bytes][u32 count][count × 24B records]
//! record: u8 kind | u8 sealed | u16 _ | u32 html_start | u32 html_end |
//!         u32 code_start | u32 code_end | u32 _
//! (code_* = entity-encoded inner span of the <pre>, iframe chunks only;
//!  all offsets are into the preprocessed bytes embedded in this output)

use crate::entities;
use crate::frontend_scan;
use crate::tokenizer::{eq_ci, has_class, Element, Node, NodeKind, Parser};

pub const KIND_NORMAL: u8 = 0;
pub const KIND_DETAILS: u8 = 1;
pub const KIND_IFRAME: u8 = 2;
pub const KIND_NESTED: u8 = 3;

/// `html.replaceAll('mes_text', 'TH-streaming')` then the collapse-button strip:
/// /<div class="TH-collapse-code-block-button">(?:显示|隐藏)(?:前端)?代码块<\/div>/g
pub fn preprocess(input: &[u8]) -> Vec<u8> {
    let needle = b"mes_text";
    let mut buf = Vec::with_capacity(input.len() + 16);
    let mut i = 0;
    while i < input.len() {
        if input[i..].starts_with(needle) {
            buf.extend_from_slice(b"TH-streaming");
            i += needle.len();
        } else {
            buf.push(input[i]);
            i += 1;
        }
    }
    // strip collapse buttons
    const PRE: &[u8] = b"<div class=\"TH-collapse-code-block-button\">";
    const LABEL1: &[u8] = "显示".as_bytes();
    const LABEL2: &[u8] = "隐藏".as_bytes();
    const FRONTEND: &[u8] = "前端".as_bytes();
    const SUFFIX: &[u8] = "代码块</div>".as_bytes();
    let mut out = Vec::with_capacity(buf.len());
    let mut k = 0;
    while k < buf.len() {
        if buf[k..].starts_with(PRE) {
            let mut j = k + PRE.len();
            if buf[j..].starts_with(LABEL1) || buf[j..].starts_with(LABEL2) {
                j += LABEL1.len();
                if buf[j..].starts_with(FRONTEND) {
                    j += FRONTEND.len();
                }
                if buf[j..].starts_with(SUFFIX) {
                    k = j + SUFFIX.len();
                    continue; // stripped
                }
            }
        }
        out.push(buf[k]);
        k += 1;
    }
    out
}

fn el_is_frontend(s: &[u8], el: &Element) -> bool {
    // isFrontendElement: hasClass('TH-render') || (is('pre') && isFrontend(text))
    if has_class(s, el, b"TH-render") {
        return true;
    }
    if eq_ci(&s[el.tag_start..el.tag_end], b"pre") {
        let text = entities::text_content(&s[el.inner_start..el.inner_end]);
        return frontend_scan::is_frontend_bytes(&text);
    }
    false
}

/// containsFrontendElement (descendants only — self already checked):
/// descendant `div.TH-render` OR descendant frontend `<pre>`.
fn el_contains_frontend(s: &[u8], el: &Element, all: &[Element]) -> bool {
    let lo = el.inner_start;
    let hi = el.inner_end;
    for d in all {
        if d.outer_start < lo || d.outer_end > hi || d.outer_start == el.outer_start {
            continue; // outside, or self
        }
        if eq_ci(&s[d.tag_start..d.tag_end], b"div") && has_class(s, d, b"TH-render") {
            return true;
        }
        // descendant <pre> passes isFrontendElement if it has TH-render class
        // OR its decoded text isFrontend (same dual check as the self-case)
        if eq_ci(&s[d.tag_start..d.tag_end], b"pre") {
            if has_class(s, d, b"TH-render") {
                return true;
            }
            let text = entities::text_content(&s[d.inner_start..d.inner_end]);
            if frontend_scan::is_frontend_bytes(&text) {
                return true;
            }
        }
    }
    false
}

fn classify(s: &[u8], node: &Node, elements: &[Element]) -> u8 {
    if node.kind != NodeKind::Element {
        return KIND_NORMAL;
    }
    let el = &elements[node.element];
    if el_is_frontend(s, el) {
        return KIND_IFRAME;
    }
    if el_contains_frontend(s, el, elements) {
        return KIND_NESTED;
    }
    if eq_ci(&s[el.tag_start..el.tag_end], b"details") {
        return KIND_DETAILS;
    }
    KIND_NORMAL
}

fn push_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

pub fn partition(input: &[u8]) -> Vec<u8> {
    let pp = preprocess(input);
    let s = pp.as_slice();
    let mut parser = Parser::new(s);
    let nodes = parser.parse();
    let elements = &parser.elements;

    // classify + merge consecutive normals
    struct Chunk {
        kind: u8,
        start: usize,
        end: usize,
        sealed: bool,
        code: Option<(usize, usize)>,
    }
    let mut chunks: Vec<Chunk> = Vec::new();
    let n_nodes = nodes.len();
    for (idx, node) in nodes.iter().enumerate() {
        let kind = classify(s, node, elements);
        // sealed: element sealed iff close-tag seen; text/markup sealed iff a
        // sibling follows (the trailing node may still grow mid-stream)
        let node_sealed = match node.kind {
            NodeKind::Element => elements[node.element].sealed,
            _ => idx + 1 < n_nodes,
        };
        if kind == KIND_NORMAL {
            if let Some(last) = chunks.last_mut() {
                if last.kind == KIND_NORMAL {
                    last.end = node.end;
                    last.sealed = last.sealed && node_sealed;
                    continue;
                }
            }
        }
        let code = if kind == KIND_IFRAME {
            let el = &elements[node.element];
            // for div.TH-render wrappers the code lives in the inner <pre>;
            // for bare <pre> it is the pre's own inner text
            if eq_ci(&s[el.tag_start..el.tag_end], b"pre") {
                Some((el.inner_start, el.inner_end))
            } else {
                // find the frontend <pre> inside (first match, mirrors the
                // $div.children('pre') lookup — actually the runtime picks the
                // wrapped pre; first descendant frontend pre is equivalent)
                elements
                    .iter()
                    .find(|d| {
                        d.outer_start >= el.inner_start
                            && d.outer_end <= el.inner_end
                            && d.outer_start != el.outer_start
                            && eq_ci(&s[d.tag_start..d.tag_end], b"pre")
                            && frontend_scan::is_frontend_bytes(&entities::text_content(
                                &s[d.inner_start..d.inner_end],
                            ))
                    })
                    .map(|d| (d.inner_start, d.inner_end))
            }
        } else {
            None
        };
        chunks.push(Chunk { kind, start: node.start, end: node.end, sealed: node_sealed, code });
    }

    // serialize: [pp_len][pp][count][records]
    let mut out = Vec::with_capacity(4 + pp.len() + 4 + chunks.len() * 24);
    push_u32(&mut out, pp.len() as u32);
    out.extend_from_slice(&pp);
    push_u32(&mut out, chunks.len() as u32);
    for c in &chunks {
        out.push(c.kind);
        out.push(c.sealed as u8);
        out.extend_from_slice(&[0u8; 2]);
        push_u32(&mut out, c.start as u32);
        push_u32(&mut out, c.end as u32);
        let (cs, ce) = c.code.unwrap_or((0, 0));
        push_u32(&mut out, cs as u32);
        push_u32(&mut out, ce as u32);
        push_u32(&mut out, 0);
    }
    out
}

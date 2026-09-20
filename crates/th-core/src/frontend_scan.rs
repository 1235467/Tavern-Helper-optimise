//! is_frontend + find_frontend_blocks — locate every `<pre>` whose decoded
//! text content satisfies isFrontend (`html>`|`<head>`|`<body` substrings,
//! case-sensitive — verbatim src/util/is_frontend.ts).

use crate::entities;
use crate::tokenizer::{contains_cs, eq_ci, Parser};

pub fn is_frontend_bytes(s: &[u8]) -> bool {
    contains_cs(s, b"html>") || contains_cs(s, b"<head>") || contains_cs(s, b"<body")
}

/// [u32 count][count × 24B: outer_start outer_end inner_start inner_end
///                ordinal flags pad pad]
/// `ordinal` = index among ALL <pre> elements in the input (document order) —
/// lets JS pair a block with `element.querySelectorAll('pre')[ordinal]`.
/// `flags` bit0 = sealed (close tag seen — used by streaming to freeze
/// already-complete inner pres of a nested_iframe chunk).
pub fn find_frontend_blocks(input: &[u8]) -> Vec<u8> {
    let mut parser = Parser::new(input);
    parser.parse();
    let mut pres: Vec<(usize, usize, usize, usize, usize, u32)> = Vec::new();
    let mut ordinal = 0usize;
    for el in &parser.elements {
        if !eq_ci(&input[el.tag_start..el.tag_end], b"pre") {
            continue;
        }
        let ord = ordinal;
        ordinal += 1;
        let text = entities::text_content(&input[el.inner_start..el.inner_end]);
        if is_frontend_bytes(&text) {
            pres.push((
                el.outer_start,
                el.outer_end,
                el.inner_start,
                el.inner_end,
                ord,
                el.sealed as u32,
            ));
        }
    }
    let mut out = Vec::with_capacity(4 + pres.len() * 24);
    out.extend_from_slice(&(pres.len() as u32).to_le_bytes());
    for (a, b, c, d, e, f) in pres {
        for v in [a as u32, b as u32, c as u32, d as u32, e as u32, f] {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    out
}

//! Minimal HTML tokenizer tuned to replicate what matters for the render
//! pipeline: top-level node spans, element inner/outer spans, tag names,
//! `class` attribute values, and "sealed" (close-tag seen) flags.
//!
//! Not a spec-complete parser — it mirrors jQuery `$(html)`/innerHTML for the
//! constructs that appear in chat message HTML: elements, text, comments,
//! doctype/PI, stray close tags, raw-text elements (script/style/textarea/
//! title), void elements, self-closing syntax, and same-tag nesting.

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum NodeKind {
    Element,
    Text,
    /// comment / doctype / processing-instruction / stray close tag — all of
    /// which classify as "normal" chunks in the streaming partitioner.
    Markup,
}

#[derive(Clone, Copy, Debug)]
pub struct Element {
    /// byte offset of the '<' starting the open tag
    pub outer_start: usize,
    /// byte offset just past the element ('>' of close tag +1; open-tag end
    /// for void/self-closing; == inner_end when unsealed at EOF)
    pub outer_end: usize,
    /// byte offset just past the open tag '>'
    pub inner_start: usize,
    /// byte offset of the '<' of the matching close tag (== inner_start when
    /// the element is empty/unsealed-at-EOF)
    pub inner_end: usize,
    /// tag name byte range (lower-cased on demand by callers)
    pub tag_start: usize,
    pub tag_end: usize,
    /// raw attribute region (between tag name and '>' or '/>'), for class scan
    pub attrs_start: usize,
    pub attrs_end: usize,
    /// close tag was seen in input
    pub sealed: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Node {
    pub kind: NodeKind,
    pub start: usize,
    pub end: usize,
    /// index into `Parser.elements` when kind == Element
    pub element: usize,
}

const VOID: &[&[u8]] = &[
    b"area", b"base", b"br", b"col", b"embed", b"hr", b"img", b"input", b"link", b"meta", b"param",
    b"source", b"track", b"wbr",
];
/// raw-text / RCDATA elements whose contents are never markup
const RAW_TEXT: &[&[u8]] = &[b"script", b"style", b"textarea", b"title"];

const MAX_DEPTH: usize = 256;

pub fn is_void(tag: &[u8]) -> bool {
    VOID.iter().any(|t| eq_ci(t, &tag.to_ascii_lowercase()))
}

pub fn is_raw_text(tag: &[u8]) -> bool {
    RAW_TEXT.iter().any(|t| eq_ci(t, &tag.to_ascii_lowercase()))
}

pub fn eq_ci(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.to_ascii_lowercase() == y.to_ascii_lowercase())
}

/// case-insensitive substring search
pub fn contains_ci(hay: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || hay.len() < needle.len() {
        return needle.is_empty();
    }
    hay.windows(needle.len()).any(|w| eq_ci(w, needle))
}

/// case-sensitive substring search
pub fn contains_cs(hay: &[u8], needle: &[u8]) -> bool {
    needle.is_empty() || hay.windows(needle.len()).any(|w| w == needle)
}

fn is_name_start(b: u8) -> bool {
    b.is_ascii_alphabetic()
}
fn is_name_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'-' || b == b':' || b == b'_'
}
fn is_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\x0C' | b'\r')
}

pub struct Parser<'a> {
    pub s: &'a [u8],
    pos: usize,
    /// every element parsed, in document order (flat — spans carry nesting)
    pub elements: Vec<Element>,
}

impl<'a> Parser<'a> {
    pub fn new(s: &'a [u8]) -> Self {
        Parser { s, pos: 0, elements: Vec::new() }
    }

    /// Parse the whole input; returns top-level nodes.
    pub fn parse(&mut self) -> Vec<Node> {
        self.parse_children(None, 0)
    }

    /// Skip `<name ...>` open tag; returns (name_start,name_end,attrs_start,attrs_end,open_end,self_closing)
    /// or None if `<` at pos doesn't start an element.
    fn scan_open_tag(&self, at: usize) -> Option<(usize, usize, usize, usize, usize, bool)> {
        let s = self.s;
        if at + 1 >= s.len() || s[at] != b'<' || !is_name_start(s[at + 1]) {
            return None;
        }
        let name_start = at + 1;
        let mut i = name_start;
        while i < s.len() && is_name_char(s[i]) {
            i += 1;
        }
        let name_end = i;
        let attrs_start = i;
        // scan to '>' honoring quoted attribute values
        let mut quote = 0u8;
        while i < s.len() {
            let b = s[i];
            if quote != 0 {
                if b == quote {
                    quote = 0;
                }
            } else if b == b'"' || b == b'\'' {
                quote = b;
            } else if b == b'>' {
                // detect self-closing: last non-ws char before '>' is '/'
                let mut j = i;
                while j > attrs_start && is_ws(s[j - 1]) {
                    j -= 1;
                }
                let self_closing = j > attrs_start && s[j - 1] == b'/';
                return Some((name_start, name_end, attrs_start, i, i + 1, self_closing));
            }
            i += 1;
        }
        // EOF inside tag: treat as unclosed open tag ending at EOF
        Some((name_start, name_end, attrs_start, s.len(), s.len(), false))
    }

    /// Find `</name` (case-insensitive, followed by ws/`>`/`/`) from `from`.
    /// Returns (close_start, close_end_past_gt).
    fn find_close_tag(&self, from: usize, name: &[u8]) -> Option<(usize, usize)> {
        let s = self.s;
        let mut i = from;
        while i + 1 < s.len() {
            if s[i] == b'<' && s[i + 1] == b'/' {
                let ns = i + 2;
                let mut j = ns;
                while j < s.len() && is_name_char(s[j]) {
                    j += 1;
                }
                if eq_ci(&s[ns..j], &name.to_ascii_lowercase()) {
                    // consume to '>'
                    let mut k = j;
                    while k < s.len() && s[k] != b'>' {
                        k += 1;
                    }
                    return Some((i, if k < s.len() { k + 1 } else { s.len() }));
                }
            }
            i += 1;
        }
        None
    }

    /// Parse sibling nodes until `until` close-tag name (None = top level).
    /// On a non-matching `</name>` inside a child scope, returns *without*
    /// consuming so the tag can bubble to a matching ancestor.
    fn parse_children(&mut self, until: Option<Vec<u8>>, depth: usize) -> Vec<Node> {
        let s = self.s;
        let mut nodes: Vec<Node> = Vec::new();
        while self.pos < s.len() {
            let start = self.pos;
            let b = s[self.pos];

            if b == b'<' && self.pos + 1 < s.len() {
                match s[self.pos + 1] {
                    b'!' => {
                        // comment / doctype / CDATA
                        let end = if s[self.pos..].starts_with(b"<!--") {
                            match find_sub(&s[self.pos + 4..], b"-->") {
                                Some(off) => self.pos + 4 + off + 3,
                                None => s.len(),
                            }
                        } else {
                            match memchr_gt(&s[self.pos..]) {
                                Some(off) => self.pos + off + 1,
                                None => s.len(),
                            }
                        };
                        self.pos = end;
                        nodes.push(Node { kind: NodeKind::Markup, start, end, element: usize::MAX });
                        continue;
                    }
                    b'?' => {
                        let end = match memchr_gt(&s[self.pos..]) {
                            Some(off) => self.pos + off + 1,
                            None => s.len(),
                        };
                        self.pos = end;
                        nodes.push(Node { kind: NodeKind::Markup, start, end, element: usize::MAX });
                        continue;
                    }
                    b'/' => {
                        // close tag
                        let ns = self.pos + 2;
                        let mut j = ns;
                        while j < s.len() && is_name_char(s[j]) {
                            j += 1;
                        }
                        if let Some(ref name) = until {
                            if eq_ci(&s[ns..j], name) {
                                // do NOT consume — caller consumes & seals
                                return nodes;
                            }
                            if depth > 0 {
                                // unmatched close inside a child scope: bubble
                                return nodes;
                            }
                        }
                        // top-level stray close tag → markup node
                        let mut k = j;
                        while k < s.len() && s[k] != b'>' {
                            k += 1;
                        }
                        let end = if k < s.len() { k + 1 } else { s.len() };
                        self.pos = end;
                        nodes.push(Node { kind: NodeKind::Markup, start, end, element: usize::MAX });
                        continue;
                    }
                    _ => {}
                }

                if let Some((ns, ne, as_, ae, open_end, self_closing)) = self.scan_open_tag(self.pos) {
                    let tag: Vec<u8> = s[ns..ne].to_ascii_lowercase();
                    self.pos = open_end;
                    let idx = self.elements.len();
                    let mut el = Element {
                        outer_start: start,
                        outer_end: open_end,
                        inner_start: open_end,
                        inner_end: open_end,
                        tag_start: ns,
                        tag_end: ne,
                        attrs_start: as_,
                        attrs_end: ae,
                        sealed: true, // provisional; fixed below
                    };
                    self.elements.push(el);
                    nodes.push(Node { kind: NodeKind::Element, start, end: open_end, element: idx });

                    if self_closing || is_void(&tag) || depth >= MAX_DEPTH {
                        // sealed trivially; inner empty
                        el.inner_end = open_end;
                        self.elements[idx] = el;
                        continue;
                    }

                    if is_raw_text(&tag) {
                        // raw content until </name
                        match self.find_close_tag(self.pos, &tag) {
                            Some((cs, ce)) => {
                                el.inner_end = cs;
                                el.outer_end = ce;
                                self.pos = ce;
                            }
                            None => {
                                el.inner_end = s.len();
                                el.outer_end = s.len();
                                el.sealed = false;
                                self.pos = s.len();
                            }
                        }
                        self.elements[idx] = el;
                        let n = nodes.last_mut().unwrap();
                        n.end = el.outer_end;
                        continue;
                    }

                    // normal element: recurse for children until </tag>
                    let children_start = self.pos;
                    let _children = self.parse_children(Some(tag.clone()), depth + 1);
                    // now: either at </tag (not consumed) or EOF
                    if self.pos < s.len()
                        && s[self.pos] == b'<'
                        && self.pos + 1 < s.len()
                        && s[self.pos + 1] == b'/'
                    {
                        let ns2 = self.pos + 2;
                        let mut j = ns2;
                        while j < s.len() && is_name_char(s[j]) {
                            j += 1;
                        }
                        if eq_ci(&s[ns2..j], &tag) {
                            let mut k = j;
                            while k < s.len() && s[k] != b'>' {
                                k += 1;
                            }
                            let ce = if k < s.len() { k + 1 } else { s.len() };
                            el.inner_end = self.pos;
                            el.outer_end = ce;
                            self.pos = ce;
                        } else {
                            // shouldn't happen (parse_children returns only on match/EOF/stray-top)
                            el.inner_end = children_start.max(self.pos);
                            el.outer_end = self.pos;
                            el.sealed = false;
                        }
                    } else {
                        // EOF: unsealed
                        el.inner_end = self.pos.min(s.len());
                        el.outer_end = self.pos.min(s.len());
                        el.sealed = false;
                    }
                    self.elements[idx] = el;
                    let n = nodes.last_mut().unwrap();
                    n.end = el.outer_end;
                    continue;
                }
            }

            // text run: consume until next '<' that starts markup-ish, or any '<'
            // (DOM treats stray '<' as text — mirror: consume until '<' followed
            // by !, /, ?, or letter; bare '<' stays text and loop re-handles it)
            let mut i = self.pos;
            while i < s.len() {
                if s[i] == b'<' && i + 1 < s.len()
                    && (s[i + 1] == b'!' || s[i + 1] == b'/' || s[i + 1] == b'?' || is_name_start(s[i + 1]))
                {
                    break;
                }
                i += 1;
            }
            // '<' at very end with nothing after → text
            if i == self.pos {
                i = self.pos + 1; // progress guarantee (the '<' char itself)
            }
            self.pos = i;
            nodes.push(Node { kind: NodeKind::Text, start, end: i, element: usize::MAX });
        }
        nodes
    }
}

fn find_sub(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn memchr_gt(s: &[u8]) -> Option<usize> {
    s.iter().position(|&b| b == b'>')
}

/// Extract `class` attribute value span of an element's attr region.
/// Mirrors `hasClass` semantics: whitespace-separated token match, case-sensitive.
pub fn has_class(s: &[u8], el: &Element, class: &[u8]) -> bool {
    let mut i = el.attrs_start;
    let end = el.attrs_end;
    while i < end {
        while i < end && is_ws(s[i]) {
            i += 1;
        }
        let ns = i;
        while i < end && !is_ws(s[i]) && s[i] != b'=' && s[i] != b'/' {
            i += 1;
        }
        let ne = i;
        while i < end && is_ws(s[i]) {
            i += 1;
        }
        if i < end && s[i] == b'=' {
            i += 1;
            while i < end && is_ws(s[i]) {
                i += 1;
            }
            let (vs, ve) = if i < end && (s[i] == b'"' || s[i] == b'\'') {
                let q = s[i];
                let vs = i + 1;
                let mut j = vs;
                while j < end && s[j] != q {
                    j += 1;
                }
                let ve = j;
                i = (j + 1).min(end);
                (vs, ve)
            } else {
                let vs = i;
                while i < end && !is_ws(s[i]) {
                    i += 1;
                }
                (vs, i)
            };
            if ne > ns && eq_ci(&s[ns..ne], b"class") {
                // token match
                return s[vs..ve]
                    .split(|b| is_ws(*b))
                    .any(|tok| tok == class);
            }
        } else {
            // bare attribute
            if i == ns {
                i += 1; // progress
            }
        }
    }
    false
}

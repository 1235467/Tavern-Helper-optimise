//! Builtin macro-like scanner (src/function/macro_like.ts):
//!   get:    /\{\{get_(message|chat|character|preset|global)_variable::(.*?)\}\}/gi
//!   format: /^(.*)\{\{format_(...)_variable::(.*?)\}\}/gim
//!
//! The format regex is line-anchored with a greedy prefix: `^(.*)` grabs the
//! whole line up to the LAST `{{format_…}}` on it, so /g produces one match
//! per line containing ≥1 format macro. We emit one record per line with
//! match_start=line_start and macro_start=the last macro's `{{` — the JS side
//! re-applies its recursive prefix handling verbatim.
//!
//! Output: [u32 count][count × 24B records]
//!   u8 kind (0=get,1=format) | u8 scope (0=message,1=chat,2=character,
//!   3=preset,4=global) | u16 pad | u32 match_start | u32 match_end |
//!   u32 macro_start | u32 path_start | u32 path_end
//! Records are ordered get-first then format (the macro array applies get
//! replacements before format replacements).

use crate::tokenizer::eq_ci;

const SCOPES: &[&[u8]] = &[b"message", b"chat", b"character", b"preset", b"global"];

/// Try to match `_variable::path}}` macro tail starting at `brace` (`{{`).
/// `kind`: b"get_" or b"format_" (matched case-insensitively).
/// Returns (macro_start, match_end, path_start, path_end, scope) or None.
fn match_macro(s: &[u8], brace: usize, kw: &[u8]) -> Option<(usize, usize, usize, usize, u8)> {
    let mut i = brace + 2;
    if i + kw.len() > s.len() || !eq_ci(&s[i..i + kw.len()], kw) {
        return None;
    }
    i += kw.len();
    let mut scope = None;
    for (idx, sc) in SCOPES.iter().enumerate() {
        if i + sc.len() <= s.len() && eq_ci(&s[i..i + sc.len()], sc) {
            scope = Some(idx as u8);
            i += sc.len();
            break;
        }
    }
    let scope = scope?;
    const TAIL: &[u8] = b"_variable::";
    if i + TAIL.len() > s.len() || !eq_ci(&s[i..i + TAIL.len()], TAIL) {
        return None;
    }
    i += TAIL.len();
    let path_start = i;
    // (.*?) lazy → first '}}'
    let mut j = path_start;
    loop {
        if j + 1 >= s.len() {
            return None; // no '}}'
        }
        if s[j] == b'}' && s[j + 1] == b'}' {
            return Some((brace, j + 2, path_start, j, scope));
        }
        j += 1;
    }
}

fn push_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

fn emit(out: &mut Vec<u8>, kind: u8, scope: u8, m_start: u32, m_end: u32, mac_start: u32, p_start: u32, p_end: u32) {
    out.push(kind);
    out.push(scope);
    out.extend_from_slice(&[0u8; 2]);
    for v in [m_start, m_end, mac_start, p_start, p_end] {
        push_u32(out, v);
    }
}

fn is_line_break(b: u8) -> bool {
    b == b'\n' || b == b'\r'
    // (U+2028/2029 also break JS `^` — handled by the byte check below)
}

pub fn scan(s: &[u8]) -> Vec<u8> {
    let mut recs: Vec<[u32; 5]> = Vec::new(); // m_start,m_end,macro_start,p_start,p_end
    let mut kinds: Vec<(u8, u8)> = Vec::new();

    // pass 1: get_ macros (all occurrences, left→right)
    let mut i = 0;
    while i + 1 < s.len() {
        if s[i] == b'{' && s[i + 1] == b'{' {
            if let Some((ms, me, ps, pe, sc)) = match_macro(s, i, b"get_") {
                kinds.push((0, sc));
                recs.push([ms as u32, me as u32, ms as u32, ps as u32, pe as u32]);
                i = me;
                continue;
            }
        }
        i += 1;
    }
    let n_get = kinds.len();

    // pass 2: format_ macros — one record per line, macro = LAST on the line
    let mut line_start = 0usize;
    let mut pos = 0;
    while pos <= s.len() {
        if pos == s.len() || is_line_break(s[pos]) {
            // end of line [line_start, pos): find last format macro in it
            let line = &s[line_start..pos];
            let mut last: Option<(usize, usize, usize, usize, u8)> = None;
            let mut k = 0;
            while k + 1 < line.len() {
                if line[k] == b'{' && line[k + 1] == b'{' {
                    if let Some((ms, me, ps, pe, sc)) = match_macro(line, k, b"format_") {
                        last = Some((ms, me, ps, pe, sc));
                        k = me;
                        continue;
                    }
                }
                k += 1;
            }
            if let Some((ms, me, ps, pe, sc)) = last {
                kinds.push((1, sc));
                recs.push([
                    line_start as u32,
                    (line_start + me) as u32,
                    (line_start + ms) as u32,
                    (line_start + ps) as u32,
                    (line_start + pe) as u32,
                ]);
            }
            if pos == s.len() {
                break;
            }
            // handle \r\n as one break; U+2028/2029 byte sequences
            if s[pos] == b'\r' && pos + 1 < s.len() && s[pos + 1] == b'\n' {
                pos += 1;
            }
            pos += 1;
            line_start = pos;
        } else {
            pos += 1;
        }
    }

    let mut out = Vec::with_capacity(4 + kinds.len() * 24);
    push_u32(&mut out, kinds.len() as u32);
    for (idx, ((kind, scope), r)) in kinds.iter().zip(recs.iter()).enumerate() {
        let _ = idx;
        emit(&mut out, *kind, *scope, r[0], r[1], r[2], r[3], r[4]);
    }
    let _ = n_get;
    out
}

//! ```-fence unwrap for script content — port of
//! `content.match(/^\s*```[^\n]*\n(.*)\n```\s*$/is)?.[1] ?? content`
//! (src/panel/script/iframe.ts:18).

fn is_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\x0C' | b'\r' | 0x0B)
}

pub fn unwrap_fence(s: &str) -> &str {
    let b = s.as_bytes();
    // ^\s*```
    let mut i = 0;
    while i < b.len() && is_ws(b[i]) {
        i += 1;
    }
    if i + 3 > b.len() || &b[i..i + 3] != b"```" {
        return s;
    }
    i += 3;
    // [^\n]*\n — language tag line, then required newline
    let nl = match b[i..].iter().position(|&c| c == b'\n') {
        Some(off) => i + off,
        None => return s,
    };
    let content_start = nl + 1;
    // (.*)\n```\s*$ — greedy: LAST `\n````, whose tail is whitespace-only.
    // Trim trailing ws, require ``` then \n before it.
    let mut e = b.len();
    while e > 0 && is_ws(b[e - 1]) {
        e -= 1;
    }
    if e < 3 || &b[e - 3..e] != b"```" {
        return s;
    }
    if e < 4 || b[e - 4] != b'\n' {
        return s;
    }
    let content_end = e - 4;
    if content_end < content_start {
        return s;
    }
    &s[content_start..content_end]
}

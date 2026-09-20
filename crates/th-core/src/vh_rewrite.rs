//! Faithful port of `replaceVhInContent` (src/panel/render/iframe.ts:5-75).
//!
//! Replicates the JS regex passes exactly — including quirks:
//!  - early-out uses *stricter* test regexes than the replace passes
//!    (`.style.minHeight='50vh solid'` fails the test but pass 3 would convert:
//!    if it's the only vh usage, it is correctly left untouched);
//!  - `style`/`min-height`/`setProperty` are NOT word-bounded (`xstyle=` matches);
//!  - pass-2 inner replace has NO lookahead and NO trailing `\b`, so only the
//!    first `\d+vh` per `min-height:` decl is taken;
//!  - convert pattern has a trailing `\b` but NO leading one (`x50vh` converts);
//!  - `Nvh` → `var(--TH-viewport-height)` iff N==100, else
//!    `calc(var(--TH-viewport-height) * N/100)` with JS number formatting.
//!
//! Case-insensitive throughout (all source regexes are /i).

use crate::tokenizer::{contains_ci, eq_ci};

const VAR: &str = "var(--TH-viewport-height)";

fn is_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\x0C' | b'\r' | 0x0B)
}
fn is_word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}
fn is_digit(b: u8) -> bool {
    b.is_ascii_digit()
}

fn find_ci(s: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if from + needle.len() > s.len() {
        return None;
    }
    s[from..].windows(needle.len()).position(|w| eq_ci(w, needle)).map(|p| p + from)
}

fn skip_ws(s: &[u8], mut i: usize) -> usize {
    while i < s.len() && is_ws(s[i]) {
        i += 1;
    }
    i
}

/// JS Number→String for the values `parsed/100` produces.
/// Matches for the realistic range; diverges only for |v| < 1e-6 or >= 1e21
/// (JS exponential notation) — documented micro-divergence.
fn js_num(v: f64) -> String {
    if v == v.trunc() && v.abs() < 1e21 {
        return format!("{}", v as i64);
    }
    format!("{}", v)
}

/// convertVhToVariable: replace each `(\d+(?:\.\d+)?)vh\b` (ci).
fn convert_vh(s: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        if is_digit(s[i]) {
            let ns = i;
            let mut j = i;
            while j < s.len() && is_digit(s[j]) {
                j += 1;
            }
            // optional .digits
            if j + 1 < s.len() && s[j] == b'.' && is_digit(s[j + 1]) {
                j += 2;
                while j < s.len() && is_digit(s[j]) {
                    j += 1;
                }
            }
            let num_end = j;
            if j + 1 < s.len() && eq_ci(&s[j..j + 2], b"vh") && (j + 2 == s.len() || !is_word(s[j + 2]))
            {
                let vend = j + 2;
                let parsed: f64 = std::str::from_utf8(&s[ns..num_end])
                    .ok()
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(f64::NAN);
                if parsed.is_finite() {
                    if parsed == 100.0 {
                        out.extend_from_slice(VAR.as_bytes());
                    } else {
                        out.extend_from_slice(
                            format!("calc({} * {})", VAR, js_num(parsed / 100.0)).as_bytes(),
                        );
                    }
                } else {
                    out.extend_from_slice(&s[ns..vend]);
                }
                i = vend;
                continue;
            }
        }
        out.push(s[i]);
        i += 1;
    }
    out
}

// ---------------------------------------------------------------------------
// test regexes (early-out) — verbatim semantics
// ---------------------------------------------------------------------------

/// /min-height\s*:\s*[^;{}]*\d+(?:\.\d+)?vh/i — does a min-height decl contain
/// a digit+vh before the next ; { or }
fn test_css_min_vh(s: &[u8]) -> bool {
    let mut from = 0;
    while let Some(p) = find_ci(s, b"min-height", from) {
        if let Some(_v) = scan_decl(s, p + b"min-height".len(), true) {
            return true;
        }
        from = p + 1;
    }
    false
}

/// After "min-height", expect `\s*:\s*` then scan the decl region [vstart..t)
/// (t = first ; { }). `require_tail` mirrors the pass-1 lookahead `\s*[;}]`:
/// the last `\d+(\.\d+)?vh` in the region must be followed by whitespace only
/// before a `;`/`}` terminator (`{` and EOF fail). Returns (vstart, last_vh_end, t).
fn scan_decl(s: &[u8], mut i: usize, require_tail: bool) -> Option<(usize, usize, usize)> {
    i = skip_ws(s, i);
    if i >= s.len() || s[i] != b':' {
        return None;
    }
    i = skip_ws(s, i + 1);
    let vstart = i;
    let mut t = vstart;
    while t < s.len() && !matches!(s[t], b';' | b'{' | b'}') {
        t += 1;
    }
    // last \d+(\.\d+)?vh ending within [vstart, t)
    let mut last: Option<usize> = None; // vh_end
    let mut k = vstart;
    while k < t {
        if is_digit(s[k]) {
            let mut j = k;
            while j < t && is_digit(s[j]) {
                j += 1;
            }
            if j + 1 < t && s[j] == b'.' && is_digit(s[j + 1]) {
                j += 2;
                while j < t && is_digit(s[j]) {
                    j += 1;
                }
            }
            if j + 2 <= t && eq_ci(&s[j..j + 2], b"vh") {
                last = Some(j + 2);
            }
        }
        k += 1;
    }
    if require_tail {
        if t >= s.len() || s[t] == b'{' {
            return None;
        }
        if let Some(ve) = last {
            if s[ve..t].iter().all(|&b| is_ws(b)) {
                return Some((vstart, ve, t));
            }
        }
        return None;
    }
    last.map(|ve| (vstart, ve, t))
}

/// /style\s*=\s*(["'])[\s\S]*?min-height\s*:\s*[^;]*?\d+(?:\.\d+)?vh[\s\S]*?\1/i
fn test_inline_style_vh(s: &[u8]) -> bool {
    let mut from = 0;
    while let Some(p) = find_ci(s, b"style", from) {
        if let Some((cs, ce, _q)) = scan_style_attr(s, p + 5) {
            // content contains min-height\s*:\s*[^;]*?\d+(\.\d+)?vh
            let inner = &s[cs..ce];
            let mut j = 0;
            while let Some(mp) = find_ci(inner, b"min-height", j) {
                if scan_decl_semicolon(inner, mp + b"min-height".len()).is_some() {
                    return true;
                }
                j = mp + 1;
            }
        }
        from = p + 1;
    }
    false
}

/// after `style`, expect \s*=\s*(quote), then content = up to first ' or "
/// (the [^"']*? can't contain either). Returns (content_start, content_end, quote)
/// if the terminating quote equals the opening quote.
fn scan_style_attr(s: &[u8], mut i: usize) -> Option<(usize, usize, u8)> {
    i = skip_ws(s, i);
    if i >= s.len() || s[i] != b'=' {
        return None;
    }
    i = skip_ws(s, i + 1);
    if i >= s.len() || (s[i] != b'"' && s[i] != b'\'') {
        return None;
    }
    let q = s[i];
    let cs = i + 1;
    let mut j = cs;
    while j < s.len() && s[j] != b'"' && s[j] != b'\'' {
        j += 1;
    }
    if j >= s.len() || s[j] != q {
        return None;
    }
    Some((cs, j, q))
}

/// min-height decl inside a style attr value: `min-height\s*:\s*` then
/// `[^;]*?` to the FIRST \d+(\.\d+)?vh (lazy, no lookahead, no trailing \b).
/// Returns (vstart, vh_end).
fn scan_decl_semicolon(s: &[u8], mut i: usize) -> Option<(usize, usize)> {
    i = skip_ws(s, i);
    if i >= s.len() || s[i] != b':' {
        return None;
    }
    i = skip_ws(s, i + 1);
    let vstart = i;
    // first \d+(\.\d+)?vh with the whole matched span free of ';'
    let mut k = vstart;
    while k < s.len() && s[k] != b';' {
        if is_digit(s[k]) {
            let mut j = k;
            while j < s.len() && is_digit(s[j]) {
                j += 1;
            }
            if j + 1 < s.len() && s[j] == b'.' && is_digit(s[j + 1]) {
                j += 2;
                while j < s.len() && is_digit(s[j]) {
                    j += 1;
                }
            }
            if j + 2 <= s.len() && eq_ci(&s[j..j + 2], b"vh") {
                return Some((vstart, j + 2));
            }
        }
        k += 1;
    }
    None
}

/// /(\.style\.minHeight\s*=\s*(["']))([\s\S]*?vh)(\2)/i  OR
/// /(setProperty\s*\(\s*(["'])min-height\2\s*,\s*(["']))([\s\S]*?vh)(\3\s*\))/i
/// (stricter test: value must END with vh before the closing quote / ')')
fn test_js_vh(s: &[u8]) -> bool {
    // variant A: .style.minHeight = '...vh'
    let mut from = 0;
    while let Some(p) = find_ci(s, b".style.minheight", from) {
        if let Some((_vs, ve, _q)) = scan_assign_value(s, p + b".style.minheight".len()) {
            if ve >= 2 && eq_ci(&s[ve - 2..ve], b"vh") {
                return true;
            }
        }
        from = p + 1;
    }
    // variant B: setProperty('min-height', '...vh')
    let mut from = 0;
    while let Some(p) = find_ci(s, b"setproperty", from) {
        if let Some((_vs, ve)) = scan_setproperty_value(s, p + b"setproperty".len()) {
            if ve >= 2 && eq_ci(&s[ve - 2..ve], b"vh") {
                return true;
            }
        }
        from = p + 1;
    }
    false
}

/// After `.style.minHeight`: \s*=\s* quote, value lazy to same quote.
/// Returns (vstart, vend) — vend = position of closing quote.
fn scan_assign_value(s: &[u8], mut i: usize) -> Option<(usize, usize, u8)> {
    i = skip_ws(s, i);
    if i >= s.len() || s[i] != b'=' {
        return None;
    }
    i = skip_ws(s, i + 1);
    if i >= s.len() || (s[i] != b'"' && s[i] != b'\'') {
        return None;
    }
    let q = s[i];
    let vs = i + 1;
    let mut j = vs;
    while j < s.len() && s[j] != q {
        j += 1;
    }
    if j >= s.len() {
        return None;
    }
    Some((vs, j, q))
}

/// After `setProperty`: \s*\(\s* q 'min-height' q \s*,\s* q2 value \3\s*\)
/// Returns (vstart, vend) where vend = position of closing q2.
fn scan_setproperty_value(s: &[u8], mut i: usize) -> Option<(usize, usize)> {
    i = skip_ws(s, i);
    if i >= s.len() || s[i] != b'(' {
        return None;
    }
    i = skip_ws(s, i + 1);
    if i >= s.len() || (s[i] != b'"' && s[i] != b'\'') {
        return None;
    }
    let q1 = s[i];
    i += 1;
    if !eq_ci(&s[i..(i + 10).min(s.len())], b"min-height") {
        return None;
    }
    i += 10;
    if i >= s.len() || s[i] != q1 {
        return None;
    }
    i = skip_ws(s, i + 1);
    if i >= s.len() || s[i] != b',' {
        return None;
    }
    i = skip_ws(s, i + 1);
    if i >= s.len() || (s[i] != b'"' && s[i] != b'\'') {
        return None;
    }
    let q2 = s[i];
    let vs = i + 1;
    // value lazy to `\3\s*\)` : first q2 followed by ws* ')'
    let mut j = vs;
    while j < s.len() {
        if s[j] == q2 {
            let k = skip_ws(s, j + 1);
            if k < s.len() && s[k] == b')' {
                return Some((vs, j));
            }
        }
        j += 1;
    }
    None
}

// ---------------------------------------------------------------------------
// replace passes
// ---------------------------------------------------------------------------

/// Pass 1: /(min-height\s*:\s*)([^;{}]*?\d+(?:\.\d+)?vh)(?=\s*[;}])/gi
fn pass1(s: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    let mut pos = 0;
    let mut from = 0;
    while let Some(p) = find_ci(s, b"min-height", from) {
        if let Some((vstart, vend, _t)) = scan_decl(s, p + b"min-height".len(), true) {
            // match = [p .. vend); prefix [p..vstart) unchanged
            out.extend_from_slice(&s[pos..vstart]);
            out.extend_from_slice(&convert_vh(&s[vstart..vend]));
            pos = vend;
            from = vend;
        } else {
            from = p + 1;
        }
    }
    out.extend_from_slice(&s[pos..]);
    out
}

/// Pass 2: /(style\s*=\s*(["']))([^"'"]*?)(\2)/gi with inner
///         /(min-height\s*:\s*)([^;]*?\d+(?:\.\d+)?vh)/gi
fn pass2(s: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    let mut pos = 0;
    let mut from = 0;
    while let Some(p) = find_ci(s, b"style", from) {
        match scan_style_attr(s, p + 5) {
            Some((cs, ce, _q)) => {
                let inner = &s[cs..ce];
                // test: min-height\s*:\s*[^;]*vh  (vh — digit NOT required in test!)
                let test_hit = {
                    let mut j = 0;
                    let mut found = false;
                    while let Some(mp) = find_ci(inner, b"min-height", j) {
                        // \s*:\s* then [^;]*vh before ';' or end
                        let mut i = skip_ws(inner, mp + 10);
                        if i < inner.len() && inner[i] == b':' {
                            i = skip_ws(inner, i + 1);
                            let mut t = i;
                            while t < inner.len() && inner[t] != b';' {
                                t += 1;
                            }
                            if contains_ci(&inner[i..t], b"vh") {
                                found = true;
                                break;
                            }
                        }
                        j = mp + 1;
                    }
                    found
                };
                if test_hit {
                    // inner global replace
                    let mut new_inner = Vec::with_capacity(inner.len());
                    let mut ip = 0;
                    let mut ifrom = 0;
                    while let Some(mp) = find_ci(inner, b"min-height", ifrom) {
                        if let Some((vs, ve)) = scan_decl_semicolon(inner, mp + 10) {
                            new_inner.extend_from_slice(&inner[ip..vs]);
                            new_inner.extend_from_slice(&convert_vh(&inner[vs..ve]));
                            ip = ve;
                            ifrom = ve;
                        } else {
                            ifrom = mp + 1;
                        }
                    }
                    new_inner.extend_from_slice(&inner[ip..]);
                    // emit prefix s[pos..cs), new_inner, continue after ce
                    out.extend_from_slice(&s[pos..cs]);
                    out.extend_from_slice(&new_inner);
                    pos = ce;
                    from = ce;
                } else {
                    from = p + 1;
                }
            }
            None => {
                from = p + 1;
            }
        }
    }
    out.extend_from_slice(&s[pos..]);
    out
}

/// test helper for pass3/4: /\b\d+(?:\.\d+)?vh\b/i on a value
fn val_has_vh(val: &[u8]) -> bool {
    let mut i = 0;
    while i < val.len() {
        if is_digit(val[i]) && (i == 0 || !is_word(val[i - 1])) {
            let mut j = i;
            while j < val.len() && is_digit(val[j]) {
                j += 1;
            }
            if j + 1 < val.len() && val[j] == b'.' && is_digit(val[j + 1]) {
                j += 2;
                while j < val.len() && is_digit(val[j]) {
                    j += 1;
                }
            }
            if j + 2 <= val.len()
                && j + 1 < val.len()
                && eq_ci(&val[j..j + 2], b"vh")
                && (j + 2 == val.len() || !is_word(val[j + 2]))
            {
                return true;
            }
        }
        i += 1;
    }
    false
}

/// Pass 3: /(\.style\.minHeight\s*=\s*(["']))([\s\S]*?)(\2)/gi
fn pass3(s: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    let mut pos = 0;
    let mut from = 0;
    while let Some(p) = find_ci(s, b".style.minheight", from) {
        match scan_assign_value(s, p + b".style.minheight".len()) {
            Some((vs, ve, _q)) => {
                let val = &s[vs..ve];
                if val_has_vh(val) {
                    out.extend_from_slice(&s[pos..vs]);
                    out.extend_from_slice(&convert_vh(val));
                    pos = ve;
                    from = ve;
                } else {
                    from = p + 1;
                }
            }
            None => from = p + 1,
        }
    }
    out.extend_from_slice(&s[pos..]);
    out
}

/// Pass 4: /(setProperty\s*\(\s*(["'])min-height\2\s*,\s*(["']))([\s\S]*?)(\3\s*\))/gi
fn pass4(s: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    let mut pos = 0;
    let mut from = 0;
    while let Some(p) = find_ci(s, b"setproperty", from) {
        match scan_setproperty_value(s, p + b"setproperty".len()) {
            Some((vs, ve)) => {
                // match continues to the q2 + \s* + ')' — find that end for `pos`
                let val = &s[vs..ve];
                if val_has_vh(val) {
                    out.extend_from_slice(&s[pos..vs]);
                    out.extend_from_slice(&convert_vh(val));
                    pos = ve;
                    from = ve;
                } else {
                    from = p + 1;
                }
            }
            None => from = p + 1,
        }
    }
    out.extend_from_slice(&s[pos..]);
    out
}

pub fn replace_vh_in_content(content: &str) -> String {
    let s = content.as_bytes();
    if !(test_css_min_vh(s) || test_inline_style_vh(s) || test_js_vh(s)) {
        return content.to_string();
    }
    let s1 = pass1(s);
    let s2 = pass2(&s1);
    let s3 = pass3(&s2);
    let s4 = pass4(&s3);
    String::from_utf8(s4).unwrap_or_else(|_| content.to_string())
}

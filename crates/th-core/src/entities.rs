//! HTML entity decoding + `textContent` equivalent for raw markup spans.
//!
//! Used to reproduce `$(el).text()` / `$(pre).text()` semantics without a DOM:
//! markup constructs are stripped, all descendant text is concatenated, and
//! entities are decoded. Covers numeric refs (dec+hex, with or without `;`)
//! and the named entities that realistically appear in escaped chat code —
//! unknown names pass through literally, mirroring the HTML5 tokenizer.

/// Named entity table: (name-without-&/;, codepoints).
/// Includes the full Latin-1 supplement set plus common punctuation —
/// everything showdown/markdown escapers emit and then some.
static NAMED: &[(&str, &str)] = &[
    // the big four + legacy semicolon-less capable
    ("amp", "&"), ("lt", "<"), ("gt", ">"), ("quot", "\""), ("apos", "'"),
    ("AMP", "&"), ("LT", "<"), ("GT", ">"), ("QUOT", "\""),
    // nbsp & Latin-1
    ("nbsp", "\u{a0}"), ("iexcl", "¡"), ("cent", "¢"), ("pound", "£"),
    ("curren", "¤"), ("yen", "¥"), ("brvbar", "¦"), ("sect", "§"),
    ("uml", "¨"), ("copy", "©"), ("ordf", "ª"), ("laquo", "«"),
    ("not", "¬"), ("shy", "\u{ad}"), ("reg", "®"), ("macr", "¯"),
    ("deg", "°"), ("plusmn", "±"), ("sup2", "²"), ("sup3", "³"),
    ("acute", "´"), ("micro", "µ"), ("para", "¶"), ("middot", "·"),
    ("cedil", "¸"), ("sup1", "¹"), ("ordm", "º"), ("raquo", "»"),
    ("frac14", "¼"), ("frac12", "½"), ("frac34", "¾"), ("iquest", "¿"),
    ("times", "×"), ("divide", "÷"), ("szlig", "ß"),
    ("agrave", "à"), ("aacute", "á"), ("acirc", "â"), ("atilde", "ã"),
    ("auml", "ä"), ("aring", "å"), ("aelig", "æ"), ("ccedil", "ç"),
    ("egrave", "è"), ("eacute", "é"), ("ecirc", "ê"), ("euml", "ë"),
    ("igrave", "ì"), ("iacute", "í"), ("icirc", "î"), ("iuml", "ï"),
    ("ntilde", "ñ"), ("ograve", "ò"), ("oacute", "ó"), ("ocirc", "ô"),
    ("otilde", "õ"), ("ouml", "ö"), ("oslash", "ø"), ("ugrave", "ù"),
    ("uacute", "ú"), ("ucirc", "û"), ("uuml", "ü"), ("yacute", "ý"),
    ("thorn", "þ"), ("yuml", "ÿ"),
    ("Agrave", "À"), ("Aacute", "Á"), ("Acirc", "Â"), ("Atilde", "Ã"),
    ("Auml", "Ä"), ("Aring", "Å"), ("AElig", "Æ"), ("Ccedil", "Ç"),
    ("Egrave", "È"), ("Eacute", "É"), ("Ecirc", "Ê"), ("Euml", "Ë"),
    ("Igrave", "Ì"), ("Iacute", "Í"), ("Icirc", "Î"), ("Iuml", "Ï"),
    ("Ntilde", "Ñ"), ("Ograve", "Ò"), ("Oacute", "Ó"), ("Ocirc", "Ô"),
    ("Otilde", "Õ"), ("Ouml", "Ö"), ("Oslash", "Ø"), ("Ugrave", "Ù"),
    ("Uacute", "Ú"), ("Ucirc", "Û"), ("Uuml", "Ü"), ("Yacute", "Ý"),
    ("THORN", "Þ"), ("ETH", "Ð"), ("eth", "ð"),
    // punctuation & symbols
    ("hellip", "…"), ("mdash", "—"), ("ndash", "–"), ("lsquo", "‘"),
    ("rsquo", "’"), ("ldquo", "“"), ("rdquo", "”"), ("sbquo", "‚"),
    ("bdquo", "„"), ("dagger", "†"), ("Dagger", "‡"), ("bull", "•"),
    ("permil", "‰"), ("prime", "′"), ("Prime", "″"), ("lsaquo", "‹"),
    ("rsaquo", "›"), ("oline", "‾"), ("frasl", "⁄"), ("euro", "€"),
    ("trade", "™"), ("larr", "←"), ("uarr", "↑"), ("rarr", "→"),
    ("darr", "↓"), ("harr", "↔"), ("minus", "−"), ("lowast", "∗"),
    ("radic", "√"), ("infin", "∞"), ("asymp", "≈"), ("ne", "≠"),
    ("le", "≤"), ("ge", "≥"), ("loz", "◊"), ("spades", "♠"),
    ("clubs", "♣"), ("hearts", "♥"), ("diams", "♦"), ("OElig", "Œ"),
    ("oelig", "œ"), ("Scaron", "Š"), ("scaron", "š"), ("Yuml", "Ÿ"),
    ("fnof", "ƒ"), ("circ", "ˆ"), ("tilde", "˜"), ("ensp", "\u{2002}"),
    ("emsp", "\u{2003}"), ("thinsp", "\u{2009}"), ("zwnj", "\u{200c}"),
    ("zwj", "\u{200d}"), ("lrm", "\u{200e}"), ("rlm", "\u{200f}"),
];

/// names that decode even without a trailing ';' (HTML5 "legacy" subset —
/// the ones an escaper would plausibly emit bare)
static LEGACY_NO_SEMI: &[&str] = &[
    "amp", "lt", "gt", "quot", "AMP", "LT", "GT", "QUOT", "nbsp", "copy",
    "reg", "times", "divide", "lt", "gt",
];

fn lookup_named(name: &[u8]) -> Option<&'static str> {
    let name = std::str::from_utf8(name).ok()?;
    NAMED.iter().find(|(n, _)| *n == name).map(|(_, v)| *v)
}

fn legacy_no_semi(name: &[u8]) -> bool {
    std::str::from_utf8(name)
        .map(|n| LEGACY_NO_SEMI.contains(&n))
        .unwrap_or(false)
}

/// Decode a `&...` reference at `s[i..]` (s[i]=='&').
/// Returns (decoded_utf8_bytes_or_None_for_literal, consumed_len).
fn decode_entity(s: &[u8], i: usize) -> (Option<Vec<u8>>, usize) {
    let len = s.len();
    let mut j = i + 1;
    if j >= len {
        return (None, 1);
    }
    if s[j] == b'#' {
        // numeric
        j += 1;
        let hex = j < len && (s[j] == b'x' || s[j] == b'X');
        if hex {
            j += 1;
        }
        let ds = j;
        while j < len && if hex { s[j].is_ascii_hexdigit() } else { s[j].is_ascii_digit() } {
            j += 1;
        }
        if j == ds {
            return (None, 1); // "&#" with no digits → literal '&'
        }
        let mut consumed = j - i;
        if j < len && s[j] == b';' {
            consumed += 1;
        }
        let num_str = std::str::from_utf8(&s[ds..j]).unwrap_or("");
        let code = u32::from_str_radix(num_str, if hex { 16 } else { 10 }).unwrap_or(0xFFFD);
        // HTML5: 0, surrogates, >0x10FFFF → U+FFFD
        let c = char::from_u32(code).filter(|c| *c != '\u{0}').unwrap_or('\u{FFFD}');
        let mut buf = [0u8; 4];
        return (Some(c.encode_utf8(&mut buf).as_bytes().to_vec()), consumed);
    }
    // named
    let ns = j;
    while j < len && s[j].is_ascii_alphanumeric() {
        j += 1;
    }
    if j == ns {
        return (None, 1);
    }
    let has_semi = j < len && s[j] == b';';
    if has_semi {
        if let Some(v) = lookup_named(&s[ns..j]) {
            return (Some(v.as_bytes().to_vec()), j - i + 1);
        }
        return (None, 1); // unknown named ref with ';' → literal
    }
    // no semicolon: longest-prefix match among legacy names
    let mut best: Option<usize> = None;
    for k in (ns..=j).rev() {
        let cand = &s[ns..k];
        if legacy_no_semi(cand) {
            best = Some(k);
            break;
        }
    }
    if let Some(k) = best {
        if let Some(v) = lookup_named(&s[ns..k]) {
            return (Some(v.as_bytes().to_vec()), k - i);
        }
    }
    (None, 1)
}

/// Decode all entities in a text span (no markup stripping).
/// Kept as a public utility (used by the JS fallback parity tests).
#[allow(dead_code)]
pub fn decode_entities(s: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        if s[i] == b'&' {
            let (decoded, consumed) = decode_entity(s, i);
            if let Some(d) = decoded {
                out.extend_from_slice(&d);
            } else {
                out.push(s[i]);
            }
            i += consumed.max(1);
        } else {
            out.push(s[i]);
            i += 1;
        }
    }
    out
}

/// `textContent` equivalent: strip markup constructs, keep text (including
/// raw-text element contents, mirroring DOM textContent), decode entities.
pub fn text_content(s: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    let len = s.len();
    while i < len {
        match s[i] {
            b'<' if i + 1 < len => match s[i + 1] {
                b'!' => {
                    if s[i..].starts_with(b"<!--") {
                        match s[i + 4..].windows(3).position(|w| w == b"-->") {
                            Some(off) => i += 4 + off + 3,
                            None => break, // unclosed comment eats the rest
                        }
                    } else {
                        // doctype/CDATA: skip to '>'
                        i += s[i..].iter().position(|&b| b == b'>').map(|o| o + 1).unwrap_or(len - i);
                    }
                }
                b'?' => {
                    i += s[i..].iter().position(|&b| b == b'>').map(|o| o + 1).unwrap_or(len - i);
                }
                b'/' => {
                    // close tag: skip to '>'
                    i += s[i..].iter().position(|&b| b == b'>').map(|o| o + 1).unwrap_or(len - i);
                }
                b if b.is_ascii_alphabetic() => {
                    // open tag: skip to '>' honoring quotes
                    i += 1;
                    let mut quote = 0u8;
                    while i < len {
                        let b = s[i];
                        if quote != 0 {
                            if b == quote {
                                quote = 0;
                            }
                        } else if b == b'"' || b == b'\'' {
                            quote = b;
                        } else if b == b'>' {
                            i += 1;
                            break;
                        }
                        i += 1;
                    }
                }
                _ => {
                    // '<' + other char → literal text
                    out.push(b'<');
                    i += 1;
                }
            },
            b'<' => {
                out.push(b'<');
                i += 1;
            }
            b'&' => {
                let (decoded, consumed) = decode_entity(s, i);
                if let Some(d) = decoded {
                    out.extend_from_slice(&d);
                } else {
                    out.push(s[i]);
                }
                i += consumed.max(1);
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    out
}

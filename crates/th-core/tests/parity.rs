//! Parity tests for th-core pure functions — expected values derived from the
//! original JS implementations (see test names for source refs).

use th_core::*;

// -- helpers to drive the extern fns through the static buffers --------------
// (single test thread usage per fn; safe because each call completes before
// the next — cargo runs tests multi-threaded, so go through a mutex)
use std::sync::Mutex;
static LOCK: Mutex<()> = Mutex::new(());

fn set_input(input: &[u8]) {
    unsafe {
        th_input_ensure(input.len());
        if !input.is_empty() {
            std::ptr::copy_nonoverlapping(input.as_ptr(), th_input_ptr(), input.len());
        }
        th_input_set_len(input.len());
    }
}

fn call_str_in_str_out(input: &str, f: extern "C" fn()) -> String {
    let _g = LOCK.lock().unwrap();
    unsafe {
        set_input(input.as_bytes());
        f();
        String::from_utf8(std::slice::from_raw_parts(th_result_ptr(), th_result_len()).to_vec())
            .unwrap()
    }
}

fn call_table(input: &[u8], f: extern "C" fn()) -> Vec<u8> {
    let _g = LOCK.lock().unwrap();
    unsafe {
        set_input(input);
        f();
        std::slice::from_raw_parts(th_result_ptr(), th_result_len()).to_vec()
    }
}

fn call_bool(input: &str, f: extern "C" fn() -> u32) -> bool {
    let _g = LOCK.lock().unwrap();
    unsafe {
        set_input(input.as_bytes());
        f() != 0
    }
}

fn u32s(table: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(table[off..off + 4].try_into().unwrap())
}

// ---------------------------------------------------------------------------
// is_frontend — ['html>', '<head>', '<body'].some(includes)  (case-sensitive!)
// ---------------------------------------------------------------------------
#[test]
fn test_is_frontend() {
    assert!(call_bool("<html><body>x</body></html>", is_frontend));
    assert!(call_bool("just html> alone", is_frontend)); // 'html>' has no '<'
    assert!(call_bool("<head><title>t</title>", is_frontend));
    assert!(call_bool("<body class=x>", is_frontend));
    assert!(!call_bool("<div>hello</div>", is_frontend));
    assert!(!call_bool("<BODY>", is_frontend)); // case-sensitive
    assert!(!call_bool("", is_frontend));
}

// ---------------------------------------------------------------------------
// replaceVhInContent
// ---------------------------------------------------------------------------
fn rw(s: &str) -> String {
    call_str_in_str_out(s, rewrite_srcdoc)
}

#[test]
fn test_vh_css_block() {
    assert_eq!(
        rw("<style>.a{min-height:100vh}</style>"),
        "<style>.a{min-height:var(--TH-viewport-height)}</style>"
    );
    assert_eq!(
        rw("<style>.a{min-height: 50vh ;}</style>"),
        "<style>.a{min-height: calc(var(--TH-viewport-height) * 0.5) ;}</style>"
    );
    // 33.3/100 → 0.33299999999999996 (verified: node prints the same —
    // Rust's shortest-roundtrip float formatting matches JS Number→String)
    assert_eq!(
        rw("x{min-height:33.3vh}"),
        "x{min-height:calc(var(--TH-viewport-height) * 0.33299999999999996)}"
    );
    // multiple vh in one decl, last ends the value
    assert_eq!(
        rw("x{min-height:10vh solid 20vh;}"),
        "x{min-height:calc(var(--TH-viewport-height) * 0.1) solid calc(var(--TH-viewport-height) * 0.2);}"
    );
    // tail not ending in vh → untouched
    assert_eq!(rw("x{min-height:10vh solid;}"), "x{min-height:10vh solid;}");
    // { terminator fails the lookahead
    assert_eq!(rw("x{min-height:10vh{"), "x{min-height:10vh{");
    // non-min-height untouched
    assert_eq!(rw("x{height:50vh}"), "x{height:50vh}");
}

#[test]
fn test_vh_inline_style_attr() {
    assert_eq!(
        rw(r#"<div style="min-height:60vh"></div>"#),
        r#"<div style="min-height:calc(var(--TH-viewport-height) * 0.6)"></div>"#
    );
    // 'style' is NOT word-bounded — data-style= also matches (faithful quirk)
    assert_eq!(
        rw(r#"<div data-style="min-height:60vh"></div>"#),
        r#"<div data-style="min-height:calc(var(--TH-viewport-height) * 0.6)"></div>"#
    );
}

#[test]
fn test_vh_js_assign() {
    assert_eq!(
        rw(r#"el.style.minHeight = '30vh'"#),
        r#"el.style.minHeight = 'calc(var(--TH-viewport-height) * 0.3)'"#
    );
    assert_eq!(
        rw(r#"el.style.minHeight="100vh""#),
        r#"el.style.minHeight="var(--TH-viewport-height)""#
    );
}

#[test]
fn test_vh_setproperty() {
    assert_eq!(
        rw(r#"el.style.setProperty('min-height', '40vh')"#),
        r#"el.style.setProperty('min-height', 'calc(var(--TH-viewport-height) * 0.4)')"#
    );
}

#[test]
fn test_vh_earlyout_strictness() {
    // pass-3 test requires value ending with vh before quote → early-out skips
    assert_eq!(rw(r#"el.style.minHeight = '50vh solid'"#), r#"el.style.minHeight = '50vh solid'"#);
    // but when another test passes, pass3 DOES convert the value
    let out = rw("x{min-height:10vh;} el.style.minHeight = '50vh solid'");
    assert!(out.contains("'calc(var(--TH-viewport-height) * 0.5) solid'"));
}

// ---------------------------------------------------------------------------
// text_content — entity decode + tag strip
// ---------------------------------------------------------------------------
#[test]
fn test_text_content() {
    assert_eq!(call_str_in_str_out("<b>x</b>&lt;html&gt;", text_content), "x<html>");
    assert_eq!(call_str_in_str_out("&amp;&#65;&#x42;", text_content), "&AB");
    assert_eq!(call_str_in_str_out("&zzz;&amp", text_content), "&zzz;&");
    assert_eq!(call_str_in_str_out("a<br>b", text_content), "ab");
    assert_eq!(call_str_in_str_out("x<!--c-->y", text_content), "xy");
    assert_eq!(call_str_in_str_out("1 < 2", text_content), "1 < 2");
    assert_eq!(call_str_in_str_out("&#0;&#xD800;", text_content), "\u{FFFD}\u{FFFD}");
}

// ---------------------------------------------------------------------------
// unwrap_fence — /^\s*```[^\n]*\n(.*)\n```\s*$/is
// ---------------------------------------------------------------------------
#[test]
fn test_unwrap_fence() {
    assert_eq!(call_str_in_str_out("```js\ncode\n```", unwrap_fence), "code");
    assert_eq!(call_str_in_str_out("```\nlet x=1;\n```   ", unwrap_fence), "let x=1;");
    assert_eq!(call_str_in_str_out("plain code", unwrap_fence), "plain code");
    assert_eq!(call_str_in_str_out("```js\nno close", unwrap_fence), "```js\nno close");
    // greedy: last ``` wins
    assert_eq!(call_str_in_str_out("```js\na\n```\nb\n```", unwrap_fence), "a\n```\nb");
}

// ---------------------------------------------------------------------------
// partition_message_html — the streaming chunker
// ---------------------------------------------------------------------------
struct Chunk {
    kind: u8,
    sealed: u8,
    html: String,
    code: String,
}

fn parts(html: &str) -> (String, Vec<Chunk>) {
    let t = call_table(html.as_bytes(), partition_message_html);
    let pp_len = u32s(&t, 0) as usize;
    let pp = String::from_utf8(t[4..4 + pp_len].to_vec()).unwrap();
    let base = 4 + pp_len;
    let n = u32s(&t, base) as usize;
    let mut chunks = Vec::new();
    for i in 0..n {
        let r = base + 4 + i * 24;
        let (hs, he) = (u32s(&t, r + 4) as usize, u32s(&t, r + 8) as usize);
        let (cs, ce) = (u32s(&t, r + 12) as usize, u32s(&t, r + 16) as usize);
        chunks.push(Chunk {
            kind: t[r],
            sealed: t[r + 1],
            html: pp[hs..he].to_string(),
            code: pp[cs..ce].to_string(),
        });
    }
    (pp, chunks)
}

#[test]
fn test_partition_basic() {
    // single complete frontend pre → one sealed iframe chunk
    let (_pp, c) = parts("<pre><code>&lt;html&gt;&lt;body&gt;hi&lt;/body&gt;&lt;/html&gt;</code></pre>");
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].kind, 2); // iframe
    assert_eq!(c[0].sealed, 1);
    // code span = entity-encoded inner of <pre>
    assert!(c[0].code.contains("&lt;html&gt;"));

    // text + iframe
    let (_pp, c) = parts("hello <pre><code>&lt;html&gt;x</code></pre>");
    assert_eq!(c.len(), 2);
    assert_eq!(c[0].kind, 0); // normal
    assert_eq!(c[0].html, "hello ");
    assert_eq!(c[1].kind, 2);

    // consecutive normals merge
    let (_pp, c) = parts("a<div>d</div>b");
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].kind, 0);
    assert_eq!(c[0].html, "a<div>d</div>b");

    // details without frontend
    let (_pp, c) = parts("<details><summary>s</summary>body</details>");
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].kind, 1); // details

    // details WITH frontend pre → nested_iframe wins over details
    let (_pp, c) = parts("<details><pre><code>&lt;html&gt;x</code></pre></details>");
    assert_eq!(c[0].kind, 3);

    // unclosed trailing pre → unsealed
    let (_pp, c) = parts("<pre><code>&lt;html&gt;partial");
    assert_eq!(c[0].kind, 2);
    assert_eq!(c[0].sealed, 0);

    // sealed iframe followed by more text → iframe sealed, trailing text unsealed
    let (_pp, c) = parts("<pre><code>&lt;html&gt;</code></pre>tail");
    assert_eq!(c.len(), 2);
    assert_eq!(c[0].sealed, 1);
    assert_eq!(c[1].kind, 0);
    assert_eq!(c[1].sealed, 0); // trailing text may grow

    // div.TH-render wrapper → iframe chunk
    let (_pp, c) = parts(r#"<div class="TH-render"><pre><code>&lt;html&gt;x</code></pre></div>"#);
    assert_eq!(c[0].kind, 2);
    assert!(c[0].code.contains("&lt;html&gt;"));

    // preprocess: mes_text → TH-streaming, collapse button stripped
    let (pp, _c) = parts(r#"<div class="mes_text">x</div><div class="TH-collapse-code-block-button">隐藏前端代码块</div>"#);
    assert!(pp.contains("TH-streaming"));
    assert!(!pp.contains("collapse-code-block-button"));
}

// ---------------------------------------------------------------------------
// find_frontend_blocks
// ---------------------------------------------------------------------------
#[test]
fn test_find_frontend_blocks() {
    let t = call_table(
        b"<div><pre><code>&lt;html&gt;x</code></pre></div><pre>plain</pre>".as_slice(),
        find_frontend_blocks,
    );
    let n = u32s(&t, 0);
    assert_eq!(n, 1); // only the frontend pre
    let (os, oe) = (u32s(&t, 4) as usize, u32s(&t, 8) as usize);
    assert!(os < oe);
}

// ---------------------------------------------------------------------------
// scan_builtin_macros
// ---------------------------------------------------------------------------
#[test]
fn test_macro_scan() {
    let t = call_table(
        b"hello {{get_chat_variable::foo.bar}} x".as_slice(),
        scan_builtin_macros,
    );
    assert_eq!(u32s(&t, 0), 1);
    assert_eq!(t[4], 0); // kind=get
    assert_eq!(t[5], 1); // scope=chat
    let (ms, me, ps, pe) = (u32s(&t, 8) as usize, u32s(&t, 12) as usize, u32s(&t, 20) as usize, u32s(&t, 24) as usize);
    let s = "hello {{get_chat_variable::foo.bar}} x";
    assert_eq!(&s[ms..me], "{{get_chat_variable::foo.bar}}");
    assert_eq!(&s[ps..pe], "foo.bar");

    // format: line-anchored, last-on-line
    let s2 = "pfx {{format_global_variable::a}} mid {{format_chat_variable::b}}\nnext line";
    let t2 = call_table(s2.as_bytes(), scan_builtin_macros);
    assert_eq!(u32s(&t2, 0), 1); // one record for line 1 (last macro wins)
    assert_eq!(t2[4], 1); // kind=format
    let (ms, me, macs, ps, _pe) = (
        u32s(&t2, 8) as usize,
        u32s(&t2, 12) as usize,
        u32s(&t2, 16) as usize,
        u32s(&t2, 20) as usize,
        u32s(&t2, 24) as usize,
    );
    assert_eq!(ms, 0); // match_start = line start
    assert_eq!(&s2[macs..me], "{{format_chat_variable::b}}");
    assert_eq!(&s2[ps.._pe], "b");
}

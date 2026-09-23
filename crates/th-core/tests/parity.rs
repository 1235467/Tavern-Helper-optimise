//! Parity tests for th-core — expected values derived from the original JS
//! implementations. Only the exported surface is tested: the input/result
//! buffer ABI plus `text_content` (the sole remaining wasm compute export —
//! see src/wasm/loader.ts for why the rest were retired to JS).

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

// ---------------------------------------------------------------------------
// buffer ABI — ensure/set_len grow INPUT and report the exact written length
// ---------------------------------------------------------------------------
#[test]
fn test_buffer_abi() {
    let _g = LOCK.lock().unwrap();
    unsafe {
        th_input_ensure(1024);
        assert!(th_input_capacity() >= 1024);
        set_input(b"prefix!");
        let before = std::slice::from_raw_parts(th_input_ptr(), 7).to_vec();
        // a second ensure must not lose the written prefix
        th_input_ensure(2048);
        th_input_set_len(7);
        let after = std::slice::from_raw_parts(th_input_ptr(), 7).to_vec();
        assert_eq!(before, after);
        assert_eq!(&after, b"prefix!");
    }
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

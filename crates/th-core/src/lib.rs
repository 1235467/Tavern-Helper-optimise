//! th-core: WASM compute core for tavern-helper-ng.
//!
//! Raw extern-"C" ABI — deliberately zero-dependency (no wasm-bindgen) so the
//! module stays tiny and builds with a bare rustc + wasm32 stdlib.
//!
//! ABI contract:
//!   - Input: JS writes bytes into the INPUT buffer via `th_input_ptr` +
//!     `th_input_capacity`, then calls `th_input_set_len(len)`.
//!   - Call a function (no args — all read INPUT, write RESULT).
//!   - Output: read `th_result_ptr`/`th_result_len` bytes; copy before the
//!     next call. Tables are little-endian packed records (see each module).
//!   - `is_frontend`/`*_present` style predicates return u32 0/1 directly.
//!
//! wasm is single-threaded; the static mut buffers are safe by construction.

mod entities;
mod fence;
mod frontend_scan;
mod macro_scan;
mod partition;
mod tokenizer;
mod vh_rewrite;

static mut INPUT: Vec<u8> = Vec::new();
static mut RESULT: Vec<u8> = Vec::new();

#[no_mangle]
pub extern "C" fn th_input_ptr() -> *mut u8 {
    unsafe { INPUT.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn th_input_capacity() -> usize {
    unsafe { INPUT.capacity() }
}

/// Grow INPUT capacity to at least `len` (call before writing via the ptr).
/// NB: Vec::reserve(n) guarantees capacity >= len()+n, so subtract len().
#[no_mangle]
pub extern "C" fn th_input_ensure(len: usize) {
    unsafe {
        if INPUT.capacity() < len {
            INPUT.reserve(len - INPUT.len());
        }
    }
}

/// Grow INPUT if needed, then set its length (bytes JS actually wrote).
#[no_mangle]
pub extern "C" fn th_input_set_len(len: usize) {
    unsafe {
        th_input_ensure(len);
        INPUT.set_len(len);
    }
}

#[no_mangle]
pub extern "C" fn th_result_ptr() -> *const u8 {
    unsafe { RESULT.as_ptr() }
}

#[no_mangle]
pub extern "C" fn th_result_len() -> usize {
    unsafe { RESULT.len() }
}

pub(crate) fn input() -> &'static [u8] {
    unsafe { &*std::ptr::addr_of!(INPUT) }
}

pub(crate) fn set_result(bytes: Vec<u8>) {
    unsafe { RESULT = bytes; }
}

pub(crate) fn set_result_str(s: String) {
    set_result(s.into_bytes());
}

// ---------------------------------------------------------------------------
// Exported functions (all read INPUT; writes go to RESULT unless noted)
// ---------------------------------------------------------------------------

/// isFrontend: does INPUT contain `html>`, `<head>`, or `<body` (case-sensitive,
/// verbatim port of src/util/is_frontend.ts). Returns 1/0.
#[no_mangle]
pub extern "C" fn is_frontend() -> u32 {
    frontend_scan::is_frontend_bytes(input()) as u32
}

/// replaceVhInContent: fused port of the 7 regex passes in
/// src/panel/render/iframe.ts. RESULT = rewritten document string.
#[no_mangle]
pub extern "C" fn rewrite_srcdoc() {
    let input = match std::str::from_utf8(input()) {
        Ok(s) => s,
        Err(_) => {
            // invalid utf8 cannot happen for DOM-derived strings; pass through
            set_result(input().to_vec());
            return;
        }
    };
    set_result_str(vh_rewrite::replace_vh_in_content(input));
}

/// Partition top-level nodes of a `.mes_text` innerHTML snapshot into
/// render chunks (normal/details/iframe/nested_iframe) with sealed flags.
/// RESULT = binary table:
///   [u32 count][count × 24B records:
///     u8 kind | u8 sealed | u16 flags | u32 html_start | u32 html_end |
///     u32 code_start | u32 code_end | u32 pad]
/// kind: 0=normal 1=details 2=iframe 3=nested_iframe
/// code_* = entity-encoded text-content span of the <pre> (iframe chunks only)
/// All offsets are byte offsets into the *preprocessed* input — JS must use
/// the same preprocess (mes_text→TH-streaming rename + collapse-button strip)
/// which this function performs internally on INPUT before partitioning;
/// the preprocessed text is NOT the same as INPUT — call
/// `partition_message_html` output offsets against the RESULT of
/// `preprocess_stream_html` if slicing externally. For convenience this
/// function's RESULT layout is: [u32 pp_len][pp bytes][table].
#[no_mangle]
pub extern "C" fn partition_message_html() {
    set_result(partition::partition(input()));
}

/// Locate every <pre> element whose decoded text content passes is_frontend.
/// RESULT = [u32 count][count × 20B: u32 outer_start | u32 outer_end |
///           u32 inner_start | u32 inner_end | u32 ordinal]
/// (inner = span inside the <pre> tags, still entity-encoded — feed to
/// text_content for the code; ordinal = index among all <pre> in input).
#[no_mangle]
pub extern "C" fn find_frontend_blocks() {
    set_result(frontend_scan::find_frontend_blocks(input()));
}

/// textContent equivalent: strip markup constructs, decode entities.
/// RESULT = decoded text (what `$(el).text()` would return for a fragment).
#[no_mangle]
pub extern "C" fn text_content() {
    set_result(entities::text_content(input()));
}

/// Script fence unwrap: ```lang\n...\n``` → inner, else passthrough.
/// RESULT = the unwrapped content string.
#[no_mangle]
pub extern "C" fn unwrap_fence() {
    let s = match std::str::from_utf8(input()) {
        Ok(s) => s,
        Err(_) => {
            set_result(input().to_vec());
            return;
        }
    };
    set_result_str(fence::unwrap_fence(s).to_string());
}

/// Scan for builtin macro-likes:
///   {{get_(message|chat|character|preset|global)_variable::path}}
///   {{format_(...)_variable::path}}  (line-anchored, greedy-prefix semantics:
///   one record per *line* — match_start is the line start, macro_start is the
///   LAST format macro on that line, mirroring /^(.*)\{\{format_…\}\}/gim)
/// RESULT = [u32 count][count × 24B:
///   u8 kind (0=get,1=format) | u8 scope (0..4) | u16 pad |
///   u32 match_start | u32 match_end | u32 macro_start | u32 path_start |
///   u32 path_end]
#[no_mangle]
pub extern "C" fn scan_builtin_macros() {
    set_result(macro_scan::scan(input()));
}

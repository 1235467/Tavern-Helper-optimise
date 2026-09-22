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

static mut INPUT: Vec<u8> = Vec::new();
static mut RESULT: Vec<u8> = Vec::new();

// addr_of_mut!/addr_of! instead of &mut/& static access — silences
// rust_2024 static_mut_refs warnings without changing semantics
// (single-threaded wasm; no aliasing by construction)

#[no_mangle]
pub extern "C" fn th_input_ptr() -> *mut u8 {
    unsafe { (*std::ptr::addr_of_mut!(INPUT)).as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn th_input_capacity() -> usize {
    unsafe { (*std::ptr::addr_of!(INPUT)).capacity() }
}

/// Grow INPUT capacity to at least `len` (call before writing via the ptr).
/// NB: Vec::reserve(n) guarantees capacity >= len()+n, so subtract len().
#[no_mangle]
pub extern "C" fn th_input_ensure(len: usize) {
    unsafe {
        let input = &mut *std::ptr::addr_of_mut!(INPUT);
        if input.capacity() < len {
            input.reserve(len - input.len());
        }
    }
}

/// Grow INPUT if needed, then set its length (bytes JS actually wrote).
#[no_mangle]
pub extern "C" fn th_input_set_len(len: usize) {
    unsafe {
        th_input_ensure(len);
        (*std::ptr::addr_of_mut!(INPUT)).set_len(len);
    }
}

#[no_mangle]
pub extern "C" fn th_result_ptr() -> *const u8 {
    unsafe { (*std::ptr::addr_of!(RESULT)).as_ptr() }
}

#[no_mangle]
pub extern "C" fn th_result_len() -> usize {
    unsafe { (*std::ptr::addr_of!(RESULT)).len() }
}

pub(crate) fn input() -> &'static [u8] {
    unsafe { &*std::ptr::addr_of!(INPUT) }
}

pub(crate) fn set_result(bytes: Vec<u8>) {
    unsafe { *std::ptr::addr_of_mut!(RESULT) = bytes; }
}

// ---------------------------------------------------------------------------
// Exported functions (all read INPUT; writes go to RESULT unless noted)
// ---------------------------------------------------------------------------

/// textContent equivalent: strip markup constructs, decode entities.
/// RESULT = decoded text (what `$(el).text()` would return for a fragment).
#[no_mangle]
pub extern "C" fn text_content() {
    set_result(entities::text_content(input()));
}

// WASM loader + glue for th-core's raw extern-"C" ABI.
// Plain .mjs (no TS) so node --test can exercise it without a build step.
//
// ABI: input bytes go into a shared buffer (th_input_ptr/capacity/set_len),
// each export reads INPUT and writes RESULT (th_result_ptr/len). Calls are
// synchronous and the wasm is single-threaded — results must be consumed
// before the next call.
//
// Only `text_content` is exported — measured benchmarks showed the glue
// marshalling (full-string UTF-8 encode + memory copy per call) outweighs
// the compute saved on the scan/partition functions, so those were retired
// to their byte-faithful JS ports in js_fallback/.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Instantiate th_core.wasm.
 * @param {string|URL|ArrayBuffer|Uint8Array} source wasm URL or bytes
 * @returns {Promise<ThCore|null>} null when WASM is unavailable/blocked
 */
export async function loadThCore(source) {
  try {
    let bytes;
    if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
      bytes = source;
    } else {
      const res = await fetch(source);
      bytes = await res.arrayBuffer();
    }
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new ThCore(instance.exports);
  } catch {
    return null;
  }
}

export class ThCore {
  /** @param {WebAssembly.Exports} e */
  constructor(e) {
    this._e = e;
  }

  /** write utf8 bytes of `str` into INPUT */
  _setInput(str) {
    const e = this._e;
    const bytes = encoder.encode(str);
    e.th_input_ensure(bytes.length);
    if (bytes.length) {
      // NB: memory may have grown during ensure → re-wrap the view each call
      new Uint8Array(e.memory.buffer, e.th_input_ptr(), bytes.length).set(bytes);
    }
    e.th_input_set_len(bytes.length);
    return bytes;
  }

  _resultBytes() {
    const e = this._e;
    return new Uint8Array(e.memory.buffer, e.th_result_ptr(), e.th_result_len());
  }

  _resultString() {
    return decoder.decode(this._resultBytes());
  }

  /** textContent equivalent for a markup span (strip tags + decode entities) */
  textContent(str) {
    this._setInput(str);
    this._e.text_content();
    return this._resultString();
  }
}

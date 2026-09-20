// WASM loader + glue for th-core's raw extern-"C" ABI.
// Plain .mjs (no TS) so node --test can exercise it without a build step.
//
// ABI: input bytes go into a shared buffer (th_input_ptr/capacity/set_len),
// each export reads INPUT and writes RESULT (th_result_ptr/len). Calls are
// synchronous and the wasm is single-threaded — results must be consumed
// before the next call.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Build a utf8-byte-offset → UTF-16 index map for `str`.
 * All wasm table offsets are byte offsets; the public API speaks JS string
 * indices (same as the pure-JS fallback), so convert once per call.
 */
function byteToIndex(str) {
  const map = new Uint32Array(encoder.encode(str).length + 1);
  let b = 0;
  for (let i = 0; i < str.length; i++) {
    const cp = str.codePointAt(i);
    map[b] = i;
    b += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (cp > 0xffff) {
      i += 1; // skip low surrogate
    }
  }
  map[b] = str.length;
  return map;
}

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

  /** isFrontend: contains html>|<head>|<body — matches src/util/is_frontend.ts */
  isFrontend(str) {
    this._setInput(str);
    return this._e.is_frontend() !== 0;
  }

  /** replaceVhInContent — returns rewritten document */
  rewriteSrcdoc(str) {
    this._setInput(str);
    this._e.rewrite_srcdoc();
    return this._resultString();
  }

  /** textContent equivalent for a markup span (strip tags + decode entities) */
  textContent(str) {
    this._setInput(str);
    this._e.text_content();
    return this._resultString();
  }

  /** ```-fence unwrap for script content */
  unwrapFence(str) {
    this._setInput(str);
    this._e.unwrap_fence();
    return this._resultString();
  }

  /**
   * Partition a .mes_text innerHTML snapshot into streaming chunks.
   * @returns {{html: string, chunks: Array<{kind:number, sealed:boolean, html:string, code:string}>}}
   *   html = preprocessed document (mes_text→TH-streaming, buttons stripped);
   *   chunk offsets are into that string. kinds: 0 normal 1 details 2 iframe 3 nested_iframe.
   */
  partitionMessageHtml(str) {
    this._setInput(str);
    this._e.partition_message_html();
    const res = this._resultBytes();
    const dv = new DataView(res.buffer, res.byteOffset, res.byteLength);
    const ppLen = dv.getUint32(0, true);
    // keep the preprocessed doc as BYTES — all offsets are utf8 byte offsets
    const ppBytes = res.slice(4, 4 + ppLen);
    const base = 4 + ppLen;
    const n = dv.getUint32(base, true);
    const chunks = [];
    for (let i = 0; i < n; i++) {
      const r = base + 4 + i * 24;
      const kind = res[r];
      const sealed = res[r + 1] !== 0;
      const [hs, he] = [dv.getUint32(r + 4, true), dv.getUint32(r + 8, true)];
      const [cs, ce] = [dv.getUint32(r + 12, true), dv.getUint32(r + 16, true)];
      chunks.push({
        kind,
        sealed,
        html: decoder.decode(ppBytes.subarray(hs, he)),
        code: decoder.decode(ppBytes.subarray(cs, ce)),
      });
    }
    return { html: decoder.decode(ppBytes), chunks };
  }

  /**
   * Locate frontend <pre> blocks.
   * @returns {Array<{outerStart:number, outerEnd:number, innerStart:number,
   *          innerEnd:number, code():string}>} — offsets are JS string indices
   *   (UTF-16), matching the pure-JS fallback's contract.
   */
  findFrontendBlocks(str) {
    const bytes = this._setInput(str);
    this._e.find_frontend_blocks();
    const res = this._resultBytes();
    const dv = new DataView(res.buffer, res.byteOffset, res.byteLength);
    const n = dv.getUint32(0, true);
    const map = byteToIndex(str);
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = 4 + i * 24;
      const bs = [dv.getUint32(r, true), dv.getUint32(r + 4, true), dv.getUint32(r + 8, true), dv.getUint32(r + 12, true)];
      const ordinal = dv.getUint32(r + 16, true);
      const sealed = (dv.getUint32(r + 20, true) & 1) !== 0;
      out.push({
        outerStart: map[bs[0]],
        outerEnd: map[bs[1]],
        innerStart: map[bs[2]],
        innerEnd: map[bs[3]],
        ordinal, // index among all <pre> in the input — pairs with querySelectorAll('pre')
        sealed,
        _innerBytes: bs, // byte span for the lazy code() decode
      });
    }
    return out.map(b => ({
      outerStart: b.outerStart,
      outerEnd: b.outerEnd,
      innerStart: b.innerStart,
      innerEnd: b.innerEnd,
      ordinal: b.ordinal,
      sealed: b.sealed,
      code: () => this.textContent(decoder.decode(bytes.subarray(b._innerBytes[2], b._innerBytes[3]))),
    }));
  }

  /**
   * Builtin macro scan. Returns
   *   Array<{kind:'get'|'format', scope:string, matchStart:number,
   *          matchEnd:number, macroStart:number, pathStart:number,
   *          pathEnd:number}> — all offsets are JS string indices.
   */
  scanBuiltinMacros(str) {
    this._setInput(str);
    this._e.scan_builtin_macros();
    const res = this._resultBytes();
    const dv = new DataView(res.buffer, res.byteOffset, res.byteLength);
    const n = dv.getUint32(0, true);
    const scopes = ['message', 'chat', 'character', 'preset', 'global'];
    const map = byteToIndex(str);
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = 4 + i * 24;
      const kind = res[r] === 0 ? 'get' : 'format';
      const scopeEnum = res[r + 1];
      const macroStart = map[dv.getUint32(r + 12, true)];
      // scope is captured VERBATIM (case-preserved) — the regexes are /i and
      // downstream gets the raw text, e.g. {{GET_CHAT_…}} yields 'CHAT'
      const scopeStart = macroStart + 2 + (kind === 'get' ? 4 : 7);
      const scopeEnd = scopeStart + scopes[scopeEnum].length;
      out.push({
        kind,
        scope: str.slice(scopeStart, scopeEnd),
        matchStart: map[dv.getUint32(r + 4, true)],
        matchEnd: map[dv.getUint32(r + 8, true)],
        macroStart,
        pathStart: map[dv.getUint32(r + 16, true)],
        pathEnd: map[dv.getUint32(r + 20, true)],
      });
    }
    return out;
  }
}

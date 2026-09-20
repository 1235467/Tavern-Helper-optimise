// Verbatim port of src/util/is_frontend.ts — the oracle for wasm is_frontend.
export function isFrontend(content) {
  return ['html>', '<head>', '<body'].some(tag => content.includes(tag));
}

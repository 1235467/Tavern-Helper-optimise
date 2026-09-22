// Verbatim port of src/util/is_frontend.ts.
export function isFrontend(content) {
  return ['html>', '<head>', '<body'].some(tag => content.includes(tag));
}

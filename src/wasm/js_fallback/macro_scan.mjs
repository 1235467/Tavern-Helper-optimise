// Fallback for wasm scan_builtin_macros — drives the ORIGINAL regexes and
// emits the same record shape (UTF-16 string offsets here, not bytes).
//
// get:    /\{\{get_(message|chat|character|preset|global)_variable::(.*?)\}\}/gi
// format: /^(.*)\{\{format_(...)_variable::(.*?)\}\}/gim  (line-anchored,
//         greedy prefix — one record per line, macro = last on the line)

const GET_RE = /\{\{(get)_(message|chat|character|preset|global)_variable::(.*?)\}\}/gi;
const FMT_RE = /\{\{(format)_(message|chat|character|preset|global)_variable::(.*?)\}\}/gi;

export function scanBuiltinMacros(text) {
  const recs = [];
  for (const m of text.matchAll(GET_RE)) {
    const macroStart = m.index;
    const pathStart = macroStart + m[0].indexOf('::') + 2;
    recs.push({
      kind: 'get',
      scope: m[2],
      matchStart: macroStart,
      matchEnd: macroStart + m[0].length,
      macroStart,
      pathStart,
      pathEnd: pathStart + m[3].length,
    });
  }
  // per line: last format macro, match covers line_start..macro_end
  let lineStart = 0;
  while (lineStart <= text.length) {
    let nl = -1;
    for (let i = lineStart; i < text.length; i++) {
      if (text[i] === '\n') {
        nl = i;
        break;
      }
    }
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(lineStart, lineEnd);
    let last = null;
    for (const m of line.matchAll(FMT_RE)) {
      last = m;
    }
    if (last) {
      const macroStart = lineStart + last.index;
      recs.push({
        kind: 'format',
        scope: last[2],
        matchStart: lineStart,
        matchEnd: macroStart + last[0].length,
        macroStart,
        pathStart: macroStart + last[0].indexOf('::') + 2,
        pathEnd: macroStart + last[0].indexOf('::') + 2 + last[3].length,
      });
    }
    if (nl === -1) break;
    lineStart = nl + 1;
  }
  return recs;
}

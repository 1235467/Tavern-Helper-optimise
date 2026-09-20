// Verbatim port of the script-fence unwrap (src/panel/script/iframe.ts:18).
export function unwrapFence(content) {
  return content.match(/^\s*```[^\n]*\n(.*)\n```\s*$/is)?.[1] ?? content;
}

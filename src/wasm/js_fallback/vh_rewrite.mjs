// Verbatim port of replaceVhInContent (src/panel/render/iframe.ts:5-75).
// This IS the golden implementation — the WASM rewrite_srcdoc must match it
// byte-for-byte on the fixture corpus.

function replaceVhInContent(content) {
  const has_css_min_vh = /min-height\s*:\s*[^;{}]*\d+(?:\.\d+)?vh/gi.test(content);
  const has_inline_style_vh =
    /style\s*=\s*(["'])[\s\S]*?min-height\s*:\s*[^;]*?\d+(?:\.\d+)?vh[\s\S]*?\1/gi.test(content);
  const has_js_vh =
    /(\.style\.minHeight\s*=\s*(["']))([\s\S]*?vh)(\2)/gi.test(content) ||
    /(setProperty\s*\(\s*(["'])min-height\2\s*,\s*(["']))([\s\S]*?vh)(\3\s*\))/gi.test(content);

  if (!has_css_min_vh && !has_inline_style_vh && !has_js_vh) {
    return content;
  }

  const convertVhToVariable = value =>
    value.replace(/(\d+(?:\.\d+)?)vh\b/gi, (match, value) => {
      const parsed = parseFloat(value);
      if (!isFinite(parsed)) {
        return match;
      }
      const VARIABLE_EXPRESSION = `var(--TH-viewport-height)`;
      if (parsed === 100) {
        return VARIABLE_EXPRESSION;
      }
      return `calc(${VARIABLE_EXPRESSION} * ${parsed / 100})`;
    });

  // 1) CSS 声明块 (包括 <style> 中或内联样式串) 中: `min-height: ...vh`
  content = content.replace(
    /(min-height\s*:\s*)([^;{}]*?\d+(?:\.\d+)?vh)(?=\s*[;}])/gi,
    (_m, prefix, value) => `${prefix}${convertVhToVariable(value)}`,
  );

  // 2) 行内 `style="min-height: ...vh"`
  content = content.replace(
    /(style\s*=\s*(["']))([^"'"]*?)(\2)/gi,
    (match, prefix, _quote, styleContent, suffix) => {
      if (!/min-height\s*:\s*[^;]*vh/i.test(styleContent)) return match;
      const replaced = styleContent.replace(
        /(min-height\s*:\s*)([^;]*?\d+(?:\.\d+)?vh)/gi,
        (_m, p1, p2) => `${p1}${convertVhToVariable(p2)}`,
      );
      return `${prefix}${replaced}${suffix}`;
    },
  );

  // 3) JavaScript: `element.style.minHeight = "...vh"`
  content = content.replace(
    /(\.style\.minHeight\s*=\s*(["']))([\s\S]*?)(\2)/gi,
    (match, prefix, _q, val, suffix) => {
      if (!/\b\d+(?:\.\d+)?vh\b/i.test(val)) return match;
      return `${prefix}${convertVhToVariable(val)}${suffix}`;
    },
  );

  // 4) JavaScript: `element.style.setProperty('min-height', "...vh")`
  content = content.replace(
    /(setProperty\s*\(\s*(["'])min-height\2\s*,\s*(["']))([\s\S]*?)(\3\s*\))/gi,
    (match, prefix, _q1, _q2, val, suffix) => {
      if (!/\b\d+(?:\.\d+)?vh\b/i.test(val)) return match;
      return `${prefix}${convertVhToVariable(val)}${suffix}`;
    },
  );

  return content;
}

export { replaceVhInContent as rewriteSrcdoc };

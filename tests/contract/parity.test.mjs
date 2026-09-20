// Three-way parity: wasm output === js_fallback output === expected semantics.
// Run: node --test tests/contract/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadThCore } from '../../src/wasm/th_core.mjs';
import { isFrontend } from '../../src/wasm/js_fallback/is_frontend.mjs';
import { rewriteSrcdoc } from '../../src/wasm/js_fallback/vh_rewrite.mjs';
import { unwrapFence } from '../../src/wasm/js_fallback/fence.mjs';
import { textContent } from '../../src/wasm/js_fallback/entities.mjs';
import {
  partitionMessageHtml,
  findFrontendBlocks,
  preprocessStreamHtml,
} from '../../src/wasm/js_fallback/partition.mjs';
import { scanBuiltinMacros } from '../../src/wasm/js_fallback/macro_scan.mjs';

const WASM_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../crates/th-core/target/wasm32-unknown-unknown/release/th_core.wasm',
);
const wasm = await loadThCore(await readFile(WASM_PATH));
assert.ok(wasm);

// ---------------------------------------------------------------------------
// fixture corpus — representative .mes_text innerHTML + standalone contents
// ---------------------------------------------------------------------------
const CORPUS = [
  '',
  'plain text only',
  'hello <b>world</b> tail',
  '<pre><code>&lt;html&gt;&lt;body&gt;hi&lt;/body&gt;&lt;/html&gt;</code></pre>',
  '<pre><code>&lt;html&gt;partial', // unclosed iframe block mid-stream
  '<pre>not frontend</pre>',
  'a<pre><code>&lt;html&gt;x</code></pre>b<pre><code>&lt;body&gt;y</code></pre>c',
  '<div class="TH-render"><pre><code>&lt;html&gt;x</code></pre></div>',
  '<details><summary>s</summary><pre><code>&lt;html&gt;x</code></pre></details>',
  '<details><summary>s</summary>no frontend</details>',
  '<div><span>nested</span><pre><code>&lt;body&gt;x</code></pre></div>',
  'text<!-- comment -->more',
  '<script>var a="<div>";</script>after',
  '汉字前缀<pre><code>&lt;html&gt;汉</code></pre>后缀',
  '<div class="mes_text"><pre><code>&lt;html&gt;</code></pre><div class="TH-collapse-code-block-button">隐藏前端代码块</div></div>',
  'emoji 😀 <pre><code>&lt;head&gt;&lt;/head&gt;</code></pre>',
  '<pre><code>&lt;html&gt;x</code></pre><pre><code>&lt;head&gt;y</code></pre>', // consecutive iframes (no merge)
  'a<div>1</div>b<div>2</div>c', // consecutive normals merge
];

test('is_frontend parity', () => {
  for (const s of [...CORPUS, 'lone html>', '<BODY', '<body']) {
    assert.equal(wasm.isFrontend(s), isFrontend(s), JSON.stringify(s));
  }
});

test('rewrite_srcdoc parity vs original regex impl', () => {
  const cases = [
    '',
    '<style>.a{min-height:100vh}</style>',
    '<style>.a{min-height: 33.3vh ;}</style>',
    'x{min-height:10vh solid 20vh;}',
    'x{min-height:10vh solid;}',
    'x{min-height:10vh{',
    '<div style="min-height:60vh"></div>',
    '<div data-style="min-height:60vh"></div>',
    `<div style='min-height:10vh;width:20vh'></div>`,
    `el.style.minHeight = '30vh'`,
    `el.style.minHeight = '50vh solid'`, // early-out: untouched alone
    `x{min-height:1vh;} el.style.minHeight = '50vh solid'`, // early-out via css → pass3 converts
    `el.style.setProperty('min-height', '40vh')`,
    `el.style.setProperty("min-height","70vh" )`,
    `el.style.setProperty('min-height','5vh0')`, // trailing \b fails → vh0? 5vh then '0' word char → no match
    `el.style.minHeight='x50vh'`, // leading x: convert has no \b → converts
    `MIN-HEIGHT: 25VH`, // case-insensitive
    `<style>@media{x{min-height:88vh}}</style>`,
    'nothing at all',
    '<style>.a{color:red}</style>',
  ];
  for (const c of cases) {
    assert.equal(wasm.rewriteSrcdoc(c), rewriteSrcdoc(c), `input: ${JSON.stringify(c)}`);
  }
});

test('unwrap_fence parity', () => {
  const cases = [
    '```js\ncode\n```',
    '```\nlet x=1;\n```   ',
    'plain code',
    '```js\nno close',
    '```js\na\n```\nb\n```',
    '   ```html\n<d/>\n```',
  ];
  for (const c of cases) {
    assert.equal(wasm.unwrapFence(c), unwrapFence(c), `input: ${JSON.stringify(c)}`);
  }
});

test('text_content parity (fallback vs wasm)', () => {
  const cases = [
    '<b>x</b>&lt;html&gt;',
    '&amp;&#65;&#x42;',
    '&zzz;&amp',
    'a<br>b',
    'x<!--c-->y',
    '1 < 2',
    '&#0;&#xD800;',
    '&lt;body&gt;',
    '中文&lt;html&gt;混合',
  ];
  for (const c of cases) {
    assert.equal(wasm.textContent(c), textContent(c), `input: ${JSON.stringify(c)}`);
  }
});

test('partition_message_html parity', () => {
  for (const html of CORPUS) {
    const w = wasm.partitionMessageHtml(html);
    const j = partitionMessageHtml(html);
    assert.equal(w.html, j.html, `preprocess mismatch: ${JSON.stringify(html)}`);
    assert.equal(
      w.chunks.length,
      j.chunks.length,
      `chunk count: ${JSON.stringify(html)}\n wasm=${JSON.stringify(w.chunks)}\n   js=${JSON.stringify(j.chunks)}`,
    );
    for (let i = 0; i < w.chunks.length; i++) {
      assert.equal(w.chunks[i].kind, j.chunks[i].kind, `chunk ${i} kind: ${JSON.stringify(html)}`);
      assert.equal(w.chunks[i].sealed, j.chunks[i].sealed, `chunk ${i} sealed: ${JSON.stringify(html)}`);
      assert.equal(w.chunks[i].html, j.chunks[i].html, `chunk ${i} html: ${JSON.stringify(html)}`);
      assert.equal(w.chunks[i].code, j.chunks[i].code, `chunk ${i} code: ${JSON.stringify(html)}`);
    }
  }
});

test('find_frontend_blocks parity', () => {
  for (const html of CORPUS) {
    const w = wasm.findFrontendBlocks(html);
    const j = findFrontendBlocks(html);
    assert.equal(w.length, j.length, `count: ${JSON.stringify(html)}`);
    for (let i = 0; i < w.length; i++) {
      assert.equal(w[i].outerStart, j[i].outerStart);
      assert.equal(w[i].outerEnd, j[i].outerEnd);
      assert.equal(w[i].code(), j[i].code());
    }
  }
});

test('scan_builtin_macros parity', () => {
  const cases = [
    'a {{get_chat_variable::x.y}} b',
    '{{get_message_variable::p}} {{get_global_variable::q}}',
    'pfx {{format_global_variable::a}} mid {{format_chat_variable::b}}\nnext',
    'line1 {{format_preset_variable::z}}\nline2 {{get_character_variable::w}}',
    '{{GET_CHAT_VARIABLE::Case}}', // case-insensitive
    'no macros',
    '{{get_unknown_variable::x}}', // bad scope → no match
    '{{get_chat_variable::}}', // empty path — (.*?) allows empty
    '汉字 {{format_message_variable::路.径}} 尾',
  ];
  for (const text of cases) {
    const w = wasm.scanBuiltinMacros(text);
    const j = scanBuiltinMacros(text);
    assert.equal(w.length, j.length, `count: ${JSON.stringify(text)}`);
    for (let i = 0; i < w.length; i++) {
      for (const k of ['kind', 'scope', 'matchStart', 'matchEnd', 'macroStart', 'pathStart', 'pathEnd']) {
        assert.equal(w[i][k], j[i][k], `rec ${i}.${k}: ${JSON.stringify(text)}`);
      }
      // sanity: path slice is meaningful
      assert.equal(text.slice(w[i].pathStart, w[i].pathEnd), text.slice(j[i].pathStart, j[i].pathEnd));
    }
  }
});

test('preprocess: mes_text rename + button strip', () => {
  const html = '<div class="mes_text">a</div><div class="TH-collapse-code-block-button">显示前端代码块</div>';
  assert.equal(preprocessStreamHtml(html), wasm.partitionMessageHtml(html).html);
});

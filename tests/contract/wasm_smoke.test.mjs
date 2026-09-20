// Smoke + parity test for the real th_core.wasm — run with: node --test
// Uses only node builtins (node:test/assert) — no npm deps required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadThCore } from '../../src/wasm/th_core.mjs';

const WASM_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../crates/th-core/target/wasm32-unknown-unknown/release/th_core.wasm',
);

const wasm = await loadThCore(await readFile(WASM_PATH));
assert.ok(wasm, 'wasm module must instantiate in node');

test('is_frontend', () => {
  assert.equal(wasm.isFrontend('<html><body>x</body></html>'), true);
  assert.equal(wasm.isFrontend('lone html>'), true);
  assert.equal(wasm.isFrontend('<body class=x'), true);
  assert.equal(wasm.isFrontend('<BODY>'), false); // case-sensitive
  assert.equal(wasm.isFrontend('<div>hi</div>'), false);
});

test('rewrite_srcdoc (replaceVhInContent)', () => {
  assert.equal(
    wasm.rewriteSrcdoc('<style>.a{min-height:100vh}</style>'),
    '<style>.a{min-height:var(--TH-viewport-height)}</style>',
  );
  assert.equal(
    wasm.rewriteSrcdoc('<style>.a{min-height: 50vh ;}</style>'),
    '<style>.a{min-height: calc(var(--TH-viewport-height) * 0.5) ;}</style>',
  );
  // untouched when early-out tests all fail
  const untouched = 'x{height:50vh} el.style.minHeight = \'50vh solid\'';
  assert.equal(wasm.rewriteSrcdoc(untouched), untouched);
  assert.equal(
    wasm.rewriteSrcdoc(`el.style.setProperty('min-height', '40vh')`),
    `el.style.setProperty('min-height', 'calc(var(--TH-viewport-height) * 0.4)')`,
  );
});

test('text_content', () => {
  assert.equal(wasm.textContent('<b>x</b>&lt;html&gt;'), 'x<html>');
  assert.equal(wasm.textContent('&amp;&#65;&#x42;'), '&AB');
});

test('unwrap_fence', () => {
  assert.equal(wasm.unwrapFence('```js\ncode\n```'), 'code');
  assert.equal(wasm.unwrapFence('plain'), 'plain');
});

test('partition_message_html', () => {
  const { chunks } = wasm.partitionMessageHtml(
    'hello <pre><code>&lt;html&gt;x&lt;/html&gt;</code></pre>tail',
  );
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].kind, 0); // normal text
  assert.equal(chunks[1].kind, 2); // iframe
  assert.equal(chunks[1].sealed, true);
  assert.ok(chunks[1].code.includes('&lt;html&gt;'));
  assert.equal(chunks[2].kind, 0);
  assert.equal(chunks[2].sealed, false); // trailing text may grow
  // CJK multibyte: byte offsets must slice cleanly
  const cjk = wasm.partitionMessageHtml('前缀汉字<pre><code>&lt;html&gt;</code></pre>');
  assert.equal(cjk.chunks[0].html, '前缀汉字');
  assert.equal(cjk.chunks[1].kind, 2);
});

test('scan_builtin_macros', () => {
  const s = 'a {{get_chat_variable::x.y}} b';
  const recs = wasm.scanBuiltinMacros(s);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].kind, 'get');
  assert.equal(recs[0].scope, 'chat');
  // offsets are JS string indices (uniform with the pure-JS fallback)
  assert.equal(s.slice(recs[0].pathStart, recs[0].pathEnd), 'x.y');
  assert.equal(s.slice(recs[0].matchStart, recs[0].matchEnd), '{{get_chat_variable::x.y}}');
});

test('find_frontend_blocks', () => {
  const blocks = wasm.findFrontendBlocks(
    '<div><pre><code>&lt;html&gt;hi</code></pre></div><pre>plain</pre>',
  );
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].code().includes('<html>'));
});

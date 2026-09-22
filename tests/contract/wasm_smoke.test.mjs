// Smoke test for the real th_core.wasm — run with: node --test
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

test('text_content', () => {
  assert.equal(wasm.textContent('<b>x</b>&lt;html&gt;'), 'x<html>');
  assert.equal(wasm.textContent('&amp;&#65;&#x42;'), '&AB');
});

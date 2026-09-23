// Smoke test for the real th_core.wasm — run with: node --test
// Uses only node builtins (node:test/assert) — no npm deps required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadThCore } from '../../src/wasm/th_core.mjs';

const WASM_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../crates/th-core/target/wasm32-unknown-unknown/release/th_core.wasm',
);

// the artifact is gitignored — clean checkouts skip instead of failing;
// `pnpm build:wasm` produces it (CI builds it before running tests)
const hasWasm = existsSync(WASM_PATH);
const wasm = hasWasm ? await loadThCore(await readFile(WASM_PATH)) : null;
if (hasWasm) assert.ok(wasm, 'wasm module must instantiate in node');

test('text_content', { skip: !hasWasm && 'th_core.wasm not built — run `pnpm build:wasm` first' }, () => {
  assert.equal(wasm.textContent('<b>x</b>&lt;html&gt;'), 'x<html>');
  assert.equal(wasm.textContent('&amp;&#65;&#x42;'), '&AB');
});

// wasm vs js_fallback parity — textContent is the only remaining wasm export
// (see src/wasm/loader.ts engine comment for why the rest were retired to JS).
// Run: node --test tests/contract/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadThCore } from '../../src/wasm/th_core.mjs';
import { textContent } from '../../src/core/entities.mjs';

const WASM_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../crates/th-core/target/wasm32-unknown-unknown/release/th_core.wasm',
);
// the artifact is gitignored — clean checkouts skip instead of failing;
// `pnpm build:wasm` produces it (CI builds it before running tests)
const hasWasm = existsSync(WASM_PATH);
const wasm = hasWasm ? await loadThCore(await readFile(WASM_PATH)) : null;
if (hasWasm) assert.ok(wasm);

test(
  'text_content parity (fallback vs wasm)',
  { skip: !hasWasm && 'th_core.wasm not built — run `pnpm build:wasm` first' },
  () => {
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
  },
);

#!/usr/bin/env node
// wasm-opt -Oz pass on the built th_core.wasm (binaryen). Skips gracefully
// when binaryen isn't installed — measured locally at ~13.5% size cut.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const WASM = 'crates/th-core/target/wasm32-unknown-unknown/release/th_core.wasm';

if (!fs.existsSync(WASM)) {
  console.error(`${WASM} missing — run cargo build --release --target wasm32-unknown-unknown first`);
  process.exit(1);
}

try {
  const before = fs.statSync(WASM).size;
  // --all-features: modern rustc emits bulk-memory ops + saturating fptoint,
  // which binaryen rejects by default (wasm-validator error on CI)
  execFileSync('wasm-opt', ['-Oz', '--all-features', WASM, '-o', WASM], { stdio: 'inherit' });
  const after = fs.statSync(WASM).size;
  console.log(`wasm-opt -Oz: ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB`);
} catch (e) {
  // hard-fail in CI — a silent skip ships cargo-only wasm with no signal
  if (process.env.CI) {
    console.error('wasm-opt failed in CI:', e?.message ?? e);
    process.exit(1);
  }
  console.warn('wasm-opt not found — shipping unoptimized wasm (install binaryen for ~13% size cut)');
}

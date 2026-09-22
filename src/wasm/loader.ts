// WASM dispatch layer — every call site goes through `engine.*`.
// Only `textContent` dispatches to wasm (the sole measured win); the rest bind
// the src/core/*.mjs implementations directly — byte-faithful ports of the
// ORIGINAL code paths, so wasm failure can never change behavior.

import { loadThCore, type ThCore } from './th_core.mjs';
import { isFrontend } from '../core/is_frontend.mjs';
import { rewriteSrcdoc } from '../core/vh_rewrite.mjs';
import { unwrapFence } from '../core/fence.mjs';
import { textContent as jsTextContent } from '../core/entities.mjs';
import {
  findFrontendBlocks,
  partitionMessageHtml,
  preprocessStreamHtml,
} from '../core/partition.mjs';
import { scanBuiltinMacros } from '../core/macro_scan.mjs';

export interface FrontendBlock {
  outerStart: number;
  outerEnd: number;
  innerStart: number;
  innerEnd: number;
  /** index among all <pre> in the scanned html — pairs with querySelectorAll('pre') */
  ordinal: number;
  /** close tag seen in input (streaming: freeze completed inner pres) */
  sealed: boolean;
  code(): string;
}

export interface PartitionChunk {
  kind: number; // 0 normal 1 details 2 iframe 3 nested_iframe
  sealed: boolean;
  html: string;
  code: string; // entity-encoded <pre> inner text (iframe chunks only)
}

export interface MacroRecord {
  kind: 'get' | 'format';
  scope: string;
  matchStart: number;
  matchEnd: number;
  macroStart: number;
  pathStart: number;
  pathEnd: number;
}

let wasm_instance: ThCore | null = null;
let wasm_ready: Promise<ThCore | null> | null = null;

/** Kick off wasm instantiation; resolves null when unavailable. */
export function initWasm(url?: string | URL): Promise<ThCore | null> {
  if (!wasm_ready) {
    const source =
      url ??
      // dist/index.js is an ES module — resolve relative to it
      new URL('./th_core.wasm', import.meta.url);
    wasm_ready = loadThCore(source);
  }
  return wasm_ready;
}

/** Resolves once instantiation settles (never rejects). */
export const wasmReady: Promise<ThCore | null> = (async () => {
  wasm_instance = await initWasm();
  return wasm_instance;
})();

/**
 * The engine surface used by core/. Measured: every wasm call pays a full
 * UTF-8 re-encode + byte→UTF-16 index map + memory copy in the glue layer,
 * which outweighs the compute saved on these scan/partition workloads — so
 * they bind the src/core/*.mjs ports directly. `textContent` (entity
 * decoding) is the one measured wasm win and keeps the wasm-or-JS dispatch.
 * Signatures/semantics identical either way (tests/contract/parity.test.mjs).
 */
export const engine = {
  isFrontend,

  rewriteSrcdoc,

  textContent: (s: string): string => wasm_instance?.textContent(s) ?? jsTextContent(s),

  unwrapFence,

  preprocessStreamHtml,

  partitionMessageHtml,

  findFrontendBlocks,

  scanBuiltinMacros: scanBuiltinMacros as (s: string) => MacroRecord[],
};

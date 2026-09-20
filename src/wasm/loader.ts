// WASM dispatch layer — every call site goes through `engine.*`, which prefers
// the wasm module and falls back to the pure-JS mirrors when it is missing.
// The fallbacks are byte-faithful ports of the ORIGINAL implementations, so
// WASM failure can never change behavior.

import { loadThCore, type ThCore } from './th_core.mjs';
import { isFrontend as jsIsFrontend } from './js_fallback/is_frontend.mjs';
import { rewriteSrcdoc as jsRewriteSrcdoc } from './js_fallback/vh_rewrite.mjs';
import { unwrapFence as jsUnwrapFence } from './js_fallback/fence.mjs';
import { textContent as jsTextContent } from './js_fallback/entities.mjs';
import {
  findFrontendBlocks as jsFindFrontendBlocks,
  partitionMessageHtml as jsPartitionMessageHtml,
  preprocessStreamHtml,
} from './js_fallback/partition.mjs';
import { scanBuiltinMacros as jsScanBuiltinMacros } from './js_fallback/macro_scan.mjs';

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

export type { PartitionChunk };

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

export function getWasm(): ThCore | null {
  return wasm_instance;
}

/** Resolves once instantiation settles (never rejects). */
export const wasmReady: Promise<ThCore | null> = (async () => {
  wasm_instance = await initWasm();
  return wasm_instance;
})();

/**
 * The engine surface used by core/. Each field prefers the wasm export and
 * falls back to the JS implementation — identical signatures, identical
 * semantics (enforced by tests/contract/parity.test.mjs).
 */
export const engine = {
  isFrontend: (s: string): boolean => wasm_instance?.isFrontend(s) ?? jsIsFrontend(s),

  rewriteSrcdoc: (s: string): string => wasm_instance?.rewriteSrcdoc(s) ?? jsRewriteSrcdoc(s),

  textContent: (s: string): string => wasm_instance?.textContent(s) ?? jsTextContent(s),

  unwrapFence: (s: string): string => wasm_instance?.unwrapFence(s) ?? jsUnwrapFence(s),

  preprocessStreamHtml,

  partitionMessageHtml: (s: string): { html: string; chunks: PartitionChunk[] } =>
    wasm_instance?.partitionMessageHtml(s) ?? jsPartitionMessageHtml(s),

  findFrontendBlocks: (s: string): FrontendBlock[] =>
    wasm_instance?.findFrontendBlocks(s) ?? jsFindFrontendBlocks(s),

  scanBuiltinMacros: (s: string): MacroRecord[] =>
    wasm_instance?.scanBuiltinMacros(s) ?? jsScanBuiltinMacros(s),
};

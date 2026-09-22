# tavern-helper-ng

A performance-focused rewrite of [JS-Slash-Runner / 酒馆助手](https://github.com/N0VI028/JS-Slash-Runner)
with a **Rust + WebAssembly compute core** and a thin JS shell — **drop-in ABI
compatible** with existing Tavern-Helper scripts and rendered frontends,
optimized for **Firefox desktop and Firefox Android**.

> ⚠️ Same warning as the original: running third-party JavaScript inside
> SillyTavern can exfiltrate API keys and chat data. The iframes here are a
> *context* boundary, not a *security* boundary — review every script before
> enabling it. See [SECURITY.md](SECURITY.md) for the full model.

## What is different

| Area | Original | tavern-helper-ng |
|---|---|---|
| Streaming render | full `innerHTML` snapshot + jQuery re-parse + **every iframe reloads its ~10 scripts per token** | one dependency-free tokenizer partitions chunks once per frame; **sealed chunks are frozen** — only the trailing unsealed chunk updates (opt-in `live` mode: postMessage deltas, zero reloads) |
| Per-iframe libraries | ~7 jsdelivr CDN fetches + CDN `log.js` | one local `lib/th-env.js` + `th-env.css` (`env_source:'cdn'` escape hatch) |
| vh rewriting | 7 regex passes per srcdoc | one fused pass (verbatim port of the original regexes) |
| Render bookkeeping | O(chat) lodash chains + Vue reactivity per event | `Map`/`Set` registry, Vue-free hot path |
| Log capture | unbounded reactive arrays; full flatten+sort per entry | 500-entry ring buffer per iframe + throttled version tick |
| Settings saves | deep-watch → klona whole settings per leaf write | *(planned: dirty tracking — see IMPLEMENTATION.md)* |
| Compute | all JS, main thread | `th-core` WASM for `text_content` (entity decoding) only — see below |

## Architecture

```
crates/th-core/        Rust → wasm32-unknown-unknown, no deps, raw extern-"C" ABI
                       (only `text_content` is exported — see "WASM scope")
src/wasm/              th_core.mjs (loader+glue), loader.ts (engine dispatch)
src/core/              Vue-free hot path: render_engine, runtime_registry,
                       stream_session, iframe_controller, message_scanner,
                       srcdoc, env (settings bridge), plus the *.mjs text
                       primitives — partition, entities, macro_scan,
                       is_frontend, fence, vh_rewrite
src/iframe/            bootstrap scripts — VERBATIM ABI (predefine.js et al.)
src/function|store|    the ~150-function TavernHelper API layer (ported verbatim)
  type|util|panel|
tests/contract/        node:test suites — text_content parity + ABI fixtures
```

Key design rules:

- **The ABI lives in the iframe bootstraps** (`predefine.js` & co.) — they are
  reused verbatim, so `window.TavernHelper`, `eventOn`, `$`, `Vue`, `Mvu`,
  naming schemes (`TH-message--`, `TH-script--`), event strings and DOM
  markers are identical.
- **WASM never runs inside iframes** — bootstraps stay pure JS.
- **WASM scope — only `textContent` uses it, and that is measured, not
  assumed.** Every wasm call pays a full UTF-8 re-encode + byte→UTF-16 index
  map + memory copy in the JS glue layer. On real inputs (Node 23,
  44KB–875KB) that marshalling outweighs the compute saved everywhere except
  entity decoding:
  `partitionMessageHtml` JS wins 3.7–4.5x, `scanBuiltinMacros` 2–5x,
  `rewriteSrcdoc` 22–29x, `isFrontend` up to 277x (it short-circuits on the
  string head while wasm must marshal the whole input), `findFrontendBlocks`
  ~2x — versus `textContent`, the one workload heavy enough to beat the
  marshalling (wasm ~2–3x). So the engine surface binds the `src/core/*.mjs`
  ports directly for everything else — byte-faithful ports of the original
  code paths, and identical semantics enforced by
  `tests/contract/parity.test.mjs`. If WASM fails to load (CSP, old
  browsers), `textContent` transparently falls back to the JS port and
  behavior is unchanged.

## Build

Requirements: node 22+, pnpm, Rust toolchain with the `wasm32-unknown-unknown`
target (`rustup target add wasm32-unknown-unknown`).

```bash
pnpm install
pnpm run build:env      # builds lib/th-env.js + th-env.css from node_modules
pnpm run build:wasm     # cargo → crates/th-core/target/.../th_core.wasm
pnpm run build          # vite → dist/index.js + dist/index.css + dist/th_core.wasm
# or everything at once:
pnpm run build:full
```

Install: clone/build into `SillyTavern/public/scripts/extensions/third-party/`
**as `JS-Slash-Runner`** (the directory name is part of the script-facing ABI
— `getTavernHelperExtensionId()` still reports `JS-Slash-Runner`). Replace,
don't run side-by-side with the original extension.

## Test

```bash
pnpm run test:rust        # cargo unit tests (native)
pnpm run test:contract    # node:test — wasm ↔ JS parity (text_content) + ABI fixtures
```

## Settings additions

`settings.render.engine`: `'ng'` (this pipeline, default) or `'legacy'`
(original Vue pipeline — escape hatch). `streaming_mode`: `'sealed'` (default)
or `'live'` (postMessage deltas; scripts run only at seal). `env_source`:
`'local'` (bundled libs, default) or `'cdn'` (original jsdelivr URLs).

Status and remaining work: [IMPLEMENTATION.md](IMPLEMENTATION.md).

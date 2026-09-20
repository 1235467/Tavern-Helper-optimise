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
| Streaming render | full `innerHTML` snapshot + jQuery re-parse + **every iframe reloads its ~10 scripts per token** | WASM tokenizer partitions chunks once per frame; **sealed chunks are frozen** — only the trailing unsealed chunk updates (opt-in `live` mode: postMessage deltas, zero reloads) |
| Per-iframe libraries | ~7 jsdelivr CDN fetches + CDN `log.js` | one local `lib/th-env.js` + `th-env.css` (`env_source:'cdn'` escape hatch) |
| vh rewriting | 7 regex passes per srcdoc | one fused WASM pass (`rewrite_srcdoc`) |
| Render bookkeeping | O(chat) lodash chains + Vue reactivity per event | `Map`/`Set` registry, Vue-free hot path |
| Log capture | unbounded reactive arrays; full flatten+sort per entry | 500-entry ring buffer per iframe + throttled version tick |
| Settings saves | deep-watch → klona whole settings per leaf write | *(planned: dirty tracking — see IMPLEMENTATION.md)* |
| Compute | all JS, main thread | `th-core` WASM (~97KB, zero-dependency raw ABI) + verbatim JS fallbacks |

## Architecture

```
crates/th-core/        Rust → wasm32-unknown-unknown, no deps, raw extern-"C" ABI
src/wasm/              th_core.mjs (loader+glue), loader.ts (engine dispatch),
                       js_fallback/ (pure-JS mirrors = fallback + parity oracle)
src/core/              Vue-free hot path: render_engine, runtime_registry,
                       stream_session, iframe_controller, message_scanner,
                       srcdoc, env (settings bridge)
src/iframe/            bootstrap scripts — VERBATIM ABI (predefine.js et al.)
src/function|store|    the ~150-function TavernHelper API layer (ported verbatim)
  type|util|panel|
tests/contract/        node:test suites — wasm ↔ fallback ↔ fixture parity
```

Key design rules:

- **The ABI lives in the iframe bootstraps** (`predefine.js` & co.) — they are
  reused verbatim, so `window.TavernHelper`, `eventOn`, `$`, `Vue`, `Mvu`,
  naming schemes (`TH-message--`, `TH-script--`), event strings and DOM
  markers are identical.
- **WASM never runs inside iframes** — bootstraps stay pure JS.
- **Every WASM function has a pure-JS fallback** that is itself the original
  algorithm; `tests/contract/parity.test.mjs` proves equivalence on a fixture
  corpus. If WASM fails to load (CSP, old browsers), behavior is unchanged.

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
pnpm run test:contract    # node:test — wasm vs fallback vs fixtures
```

## Settings additions

`settings.render.engine`: `'ng'` (this pipeline, default) or `'legacy'`
(original Vue pipeline — escape hatch). `streaming_mode`: `'sealed'` (default)
or `'live'` (postMessage deltas; scripts run only at seal). `env_source`:
`'local'` (bundled libs, default) or `'cdn'` (original jsdelivr URLs).

Status and remaining work: [IMPLEMENTATION.md](IMPLEMENTATION.md).

# Implementation status

Milestone tracker for the rewrite (see README for architecture). The plan this
implements lives in the design doc (wasm boundary, streaming sealed-chunk
reconciliation, th-env bundle, ABI checklist).

## Done

- **M0 — ABI inventory + contract tests** ✅
  - Full ABI inventory captured (see design doc): iframe naming schemes, event
    strings, DOM markers, `TavernHelper` surface, persistence keys, macro
    syntax — the `tests/contract/` suite encodes the string-level ones.
  - `tests/contract/wasm_smoke.test.mjs` + `parity.test.mjs`: real
    `th_core.wasm` ↔ pure-JS port ↔ hand-derived expected semantics
    (`text_content` only — the other wasm exports were retired, see below).
- **WASM core** ✅ `crates/th-core` — zero-dep, raw extern-"C" ABI:
  - **scope retired to `text_content` only** (`$(el).text()` equivalent —
    tag strip + entity decode: numeric dec/hex ±semicolon, legacy no-semi
    names, U+FFFD rules). Measured on real inputs (Node 23, 44KB–875KB):
    every wasm call pays a full UTF-8 re-encode + byte→UTF-16 index map +
    memory copy in the JS glue, which outweighs the compute saved on the
    scan/partition workloads — the pure-JS ports are *faster* there
    (`partitionMessageHtml` 3.7–4.5x, `scanBuiltinMacros` 2–5x,
    `rewriteSrcdoc` 22–29x, `isFrontend` up to 277x — it short-circuits on
    the string head while wasm must marshal the whole input). Entity
    decoding is the one workload heavy enough to beat marshalling
    (~2–3x wasm win), so it keeps the wasm-or-JS dispatch.
  - Removed exports + modules: `is_frontend`, `rewrite_srcdoc`,
    `partition_message_html`, `find_frontend_blocks`, `unwrap_fence`,
    `scan_builtin_macros` (tokenizer/partition/frontend_scan/macro_scan/
    vh_rewrite/fence.rs deleted).
  - JS glue `src/wasm/th_core.mjs`: shared input/result buffers.
- **Text primitives** ✅ `src/core/*.mjs` — pure-JS, DOM-free
  implementations (tokenizer + partition + frontend scan + entity decode +
  macro scan + vh rewrite + fence unwrap, byte-faithful ports of the
  original code paths). Formerly `src/wasm/js_fallback/` — they are the
  engine's implementation now, not a fallback; only `entities.mjs` still
  shadows a wasm export.
- **Core engine** ✅ `src/core/` — Vue-free:
  - `runtime_registry.ts` — Map/Set audit (replaces O(chat) `_.range` +
    O(n·m) `_.includes`), verbatim `calcToRender` semantics
  - `iframe_controller.ts` — `MessageIframe` (naming, lazy, srcdoc/blob,
    started/ended events, shared single resize broadcaster, mount/unmount
    `hidden!`/collapse choreography)
  - `stream_session.ts` — `StreamSession`+`StreamManager`: rAF-batched
    reconcile, sealed chunks frozen (no more per-token iframe reload storm),
    nested-iframe wrapper preservation across innerHTML patches (sealed inner
    iframes survive), `.mes_streaming` yield + edit-textarea swap
  - `srcdoc.ts` — `createMessageSrcdoc`/`createScriptSrcdoc` with
    `env_source: local|cdn` (th-env bundle vs verbatim CDN html) and bundled
    `log.js` (was CDN)
  - `env.ts` — plain settings interface; Pinia store bridges in `index.ts`
  - `render_engine.ts` — orchestrator; gated to `engine==='ng'` + not
    TauriTavern-managed surface
- **th-env bundle** ✅ `tools/build_th_env.mjs` → `lib/th-env.js` +
  `th-env.css` + `lib/webfonts/` (jQuery, jQuery-UI, touch-punch, Vue runtime
  global, vue-router@4 global — same global-assignment order as the CDN html)
- **iframe bootstraps** ✅ verbatim copies + new `stream_applier.js`
  (opt-in live mode) + `log.js` now blob-bundled (CDN kept for `env_source:'cdn'`)
- **iframe_logs store** ✅ 500-cap ring buffer + shallowRef + 100ms version
  tick (Logger.vue patched to depend on `version`)
- **jsoneditor lazy-load** ✅ `await import('vanilla-jsoneditor')` in onMounted
  (1.2MB off startup path); local `Mode`/`ValidationSeverity` consts
- **Panel lazy mount** ✅ `defineAsyncComponent(() => import('@/Panel.vue'))`
  — kept as a render boundary, but `inlineDynamicImports` now inlines it:
  the deferred-chunk waterfall cost N serial RTTs on high-latency links
  (measured ~4 layers ≈ 3s at ~550ms RTT), so the bundle trades bytes for
  round-trips
- **verified build** ✅ `pnpm run build:env` → `lib/th-env.js` 470KB /
  `th-env.css` 86KB; `vite build` → `dist/index.js` **~1.19MB single file**
  (Panel/plugins/vue-tippy/srcdoc inlined via `inlineDynamicImports` —
  external `@sillytavern/*`/`vanilla-jsoneditor` dynamic imports stay
  external) + `dist/index.css` + `dist/th_core.wasm`;
  vs upstream 1.1MB + 1.2MB eager jsoneditor. 7 contract + 2 vitest tests
  green on node 23.
- **verified in real SillyTavern** ✅ repo symlinked into
  `SillyTavern/public/scripts/extensions/third-party/JS-Slash-Runner`
  (ST 1.19.0, server running at 127.0.0.1:8000):
  - `ST_IMPORT_DEPTH=5 pnpm run build` → emitted `@sillytavern/*` imports
    resolve correctly (`../../../../../scripts/*.js`)
  - `/api/extensions/discover` lists `third-party/JS-Slash-Runner` ✓
  - manifest/index.js/th_core.wasm/th-env.js all serve 200;
    wasm MIME = `application/wasm` (instantiateStreaming works)
  - **user-verified in Firefox**: extension activates, panel mounts,
    frontend code blocks render in iframes — after the absolute-base fix
- **Settings schema** ✅ additive: `render.streaming_mode|'env_source'|'engine'`
- **Render.vue gate** ✅ legacy teleport pipeline + Streaming.vue only mount
  in `engine==='legacy'`
- **manifest.json** ✅ identical fields; `auto_update:false` (prevents ST
  silently overwriting the ng build with upstream — review before enabling)

## Deferred / TODO

- [x] **persistence dirty-tracking** ✅ `src/core/persistence.ts`
  `createDirtyFlush` (debounced flush + pause/resume + flushNow) wired into
  all four settings stores — a burst of leaf writes → ONE klona + one save
  per 250-300ms window instead of per write. Correctness hooks:
  `flushNow()` inside CHAT_CHANGED / OAI_PRESET_CHANGED_BEFORE handlers
  (pending writes land under the OLD id before switching); `pause()/resume()`
  brackets the character export cleared-settings→restore window and the
  OAI_PRESET_EXPORT_READY scrub, so a late flush can't overwrite scrubbed
  data. Preset savers still get separate klonas (memory/file mustn't share
  the object — same as original two klonas).
- [x] **macro_like render-path** ✅ `demacroOnRender` rewritten:
  `engine.scanBuiltinMacros` (JS port — the wasm export was retired, see
  WASM core note) prescan + node-targeted text-node replacement — only
  touched `<pre>` iframes drop+remount instead of every iframe in the message.
  Custom `registerMacroLike` regexes fall back to the verbatim wholesale path;
  pathological format-in-prefix nesting falls back per-node. Upstream latent
  type smell fixed (`role: message.role` 'tool' cast). Remaining known
  upstream bug: `use_collapse_code_block.ts` watches a non-reactive array.
- [ ] **streaming e2e test** — enable 允许流式渲染 + real streamed generation
  in browser; verify sealed-chunk reconcile + live mode.
- [x] **module CDN cache** — *implemented then REMOVED on user data:*
  reverting to pre-cache build was measurably smoother even after fixing
  the mount-gate remount storm (watch fired on every script.data write →
  remount-all-scripts per variable write) and memoizing importmapTag.
  Reverted entirely — CDN module fetches stay as upstream. The
  `createScriptSrcdoc` delegation (bundled th-env vs 3 CDN env fetches)
  stays — it's an env win independent of the cache.
- [x] **delta-gated auto-height** ✅ `adjust_iframe_height.js` — only writes
  `frameElement.style.height` when |Δ| ≥ 4px (was: every ResizeObserver fire
  → parent-doc reflow per frame for animated frontends — the Rhea profile's
  59k-style-flush amplifier).
- [x] **`demacroOnPrompt` prescan** — *kept as regex application:
  prompt-side works on strings with no DOM churn, so the win is marginal;
  demacroOnPrompt stays verbatim. (Moot anyway — `scan_builtin_macros` no
  longer has a wasm export.)*
- [x] **IntersectionObserver render gating** ✅ `render.io_gate` (default
  true): below-fold `.TH-render` wrappers register on a shared
  IntersectionObserver (300px margin); the iframe + its ~10-script realm eval
  only happens when the wrapper nears the viewport. Fallback state = the raw
  `<pre>` stays visible; sealed once mounted (no scroll-out unmount).
- [x] **srcdoc-vs-blob probe** ✅ `src/core/srcdoc_probe.ts`: hidden srcdoc
  iframe writes `__TH_SRCDOC_OK` from inside — if `frameElement` doesn't
  survive (FF teardown), blob-URL mode activates globally for the session
  (`effectiveBlobMode()` in iframe_controller). Probed once at engine start
  before first render.
- [x] **`message_iframe_render_updated`** ✅ additive event emitted on
  post-load content rewrites (streaming updates, seal, live patches); added
  to `iframe_events` enum + ListenerType (backwards-compatible).
- [x] **e2e scaffold** ✅ `tests/e2e/smoke.spec.ts` — playwright specs for
  TavernHelper install, panel mount, iframe naming + ABI globals (skips when
  no frontend block in chat). Runnable on a bigger box:
  `pnpm i -D @playwright/test && pnpm playwright install firefox &&
   ST_URL=http://localhost:8000 pnpm playwright test tests/e2e/`
- [ ] perf gate — assert bounded iframe reload count on a recorded token
  stream (needs the streaming e2e first).
- [ ] **full vue-tsc pass** — scoped check of core/wasm is clean
  (`tests/typecheck/`); a full run needs an ST checkout for `@sillytavern/*`.
- [x] **dist/ shipping model** ✅ CI-built: `.github/workflows/bundle.yaml`
  rebuilds + commits dist/ on every push to main (paths-ignore on dist/**
  prevents self-trigger loops).
- [x] **boot guard** ✅ index.ts warns via console+toastr when another
  `TavernHelper` exists; our instance stamps `__th_ng=true`.

## Firefox-specific fixes

- **import.meta.resolve quirk**: rolldown's modulepreload helper resolves
  relative dep URLs via `import.meta.resolve` — Firefox resolves `./x` against
  `document.baseURI` ("/"), not the module URL → chunks 404 → `text/html` MIME
  block → panel/plugins never loaded. Fixed by emitting absolute dep URLs
  (`base: '/scripts/extensions/third-party/JS-Slash-Runner/dist/'` in
  vite.config.ts). engine.start() also hardened: a plugins-chunk failure no
  longer aborts mount/engine start.

## Contract notes / documented deltas

- `document.scripts` inside iframes shows `lib/th-env.js` instead of jsdelivr
  URLs (`env_source:'cdn'` restores them).
- `log.js` loads from a blob URL by default (`env_source:'cdn'` restores the
  gh/jsdelivr URL).
- `message_iframe_render_ended` fires once per seal rather than per token —
  the event + payload are contractual, the rate is not (tracked in changelog).
- Historical (pre-retirement): the wasm scan/partition exports were removed
  after benchmarking showed glue marshalling dominates their workloads —
  the former WASM↔JS divergence notes (`{{GET_CHAT_…}}` verbatim scope,
  `rewrite_srcdoc` exponential-formatting edge) are obsolete now that the
  JS ports are authoritative.

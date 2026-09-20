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
    `th_core.wasm` ↔ pure-JS fallbacks ↔ hand-derived expected semantics.
    **15 tests, all green** (node:test, no npm deps needed).
- **WASM core** ✅ `crates/th-core` — zero-dep, raw extern-"C" ABI, ~112KB:
  - `is_frontend` — `html>`|`<head>`|`<body` substring check
  - `rewrite_srcdoc` — fused port of `replaceVhInContent` (all 4 passes +
    strict early-out, bug-for-bug: no `\b` before digits in convert, `\b`
    required in pass-3/4 tests, unbounded `style`/`min-height`/`setProperty`
    keywords, JS number formatting verified vs node)
  - `partition_message_html` — preprocess (mes_text→TH-streaming + collapse
    strip) + top-level tokenizer + classification + normal-chunk merge +
    **sealed flags** (the new bit the original lacked); embeds preprocessed
    text so offsets are consistent
  - `find_frontend_blocks` — `<pre>` spans + `ordinal` (pairs with
    `querySelectorAll('pre')`) + sealed flag
  - `text_content` — `$(el).text()` equivalent (tag strip + entity decode:
    numeric dec/hex ±semicolon, legacy no-semi names, U+FFFD rules)
  - `unwrap_fence` — script ```` ``` ````-fence port
  - `scan_builtin_macros` — `{{get_/format_*_variable::}}` spans with
    line-anchored greedy-prefix format semantics; scope emitted verbatim
    (case-preserved, e.g. `{{GET_CHAT_…}}` → `'CHAT'`)
  - JS glue `src/wasm/th_core.mjs`: shared input/result buffers, UTF-8 byte →
    UTF-16 index map so all public offsets are JS string indices.
  - **Rust tests: 11 pass** (`cargo test`).
- **JS fallbacks** ✅ `src/wasm/js_fallback/` — pure-JS mirrors (also DOM-free
  where the original needed jQuery: tokenizer reimplemented in JS).
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
  → separate rollup chunk (Panel + its deps load on first open, off cold path)
- **verified build** ✅ `pnpm run build:env` → `lib/th-env.js` 470KB /
  `th-env.css` 86KB; `vite build` → `dist/index.js` **303KB (80KB gzip)** vs
  upstream 1.1MB + 1.2MB eager jsoneditor; `dist/th_core.wasm` 112KB;
  Panel/plugins/vue-tippy all deferred chunks. 20 contract + 2 vitest tests
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

- [ ] **M1 remainder — persistence dirty-tracking**: the copied Pinia settings
  stores still `watch(settings,{deep:true})` + klona on every leaf write, and
  character variable writes still POST the whole character. Plan: shallowRef +
  dirty flags + coalesced `writeExtensionField` (force-flush on export/
  CHAT_CHANGED). *Not yet implemented — original behavior intact.*
- [x] **macro_like render-path** ✅ `demacroOnRender` rewritten: WASM
  `scan_builtin_macros` prescan + node-targeted text-node replacement — only
  touched `<pre>` iframes drop+remount instead of every iframe in the message.
  Custom `registerMacroLike` regexes fall back to the verbatim wholesale path;
  pathological format-in-prefix nesting falls back per-node. Upstream latent
  type smell fixed (`role: message.role` 'tool' cast). Remaining known
  upstream bug: `use_collapse_code_block.ts` watches a non-reactive array.
- [ ] **streaming e2e test** — enable 允许流式渲染 + real streamed generation
  in browser; verify sealed-chunk reconcile + live mode.
- [ ] **`demacroOnPrompt` WASM prescan** — same pending.
- [ ] **IntersectionObserver render gating** — currently renders all messages
  in depth range eagerly (parity with upstream); IO gating planned (defers
  ~10-script realm eval for below-the-fold messages).
- [ ] **srcdoc-vs-blob probe** — feature-detect FF srcdoc teardown and default
  `use_blob_url` on Firefox if flaky (fallback chain `frameElement.id`→
  `__TH_IFRAME_ID`→`window.name` is already preserved in predefine.js).
- [ ] **`message_iframe_render_updated`** event (non-ABI, documents update vs
  mount) — `message_iframe_render_ended` now fires once-per-seal instead of
  per-token; add the update event + changelog note.
- [ ] **e2e playwright suite** + perf gate (assert bounded iframe reload count
  on a recorded token stream).
- [ ] **full vue-tsc pass** — scoped check of core/wasm is clean
  (`tests/typecheck/`); a full run needs an ST checkout for `@sillytavern/*`.
- [ ] **dist/ shipping model** — decide whether dist is committed (upstream
  model) or CI-built.
- [ ] **boot guard** — warn+refuse when another `window.TavernHelper` with a
  different build stamp already exists (side-by-side install protection).

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
- WASM↔JS scope divergence fixed: `{{GET_CHAT_…}}` emits verbatim `'CHAT'`
  (was canonicalized `'chat'` — the original regex captures are /i).
- Known micro-divergence in `rewrite_srcdoc`: `parsed/100` for |v|<1e-6 or
  ≥1e21 formats exponentially in JS (`1e-7`) but Rust prints decimal — no
  realistic `vh` value hits this.

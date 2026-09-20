# Security model

Same-origin iframes + a fully bridged `window.parent` API — the iframes isolate *documents*, not *trust*. Any enabled script can read/write everything SillyTavern can: extension_settings (API keys), chat history, `fetch` anywhere, DOM injection into the host page.

What exists is consent, not sandboxing: scripts embedded in character cards/presets require an enable-click (`use_check_enablement_popup.ts`), per-script toggles, and a cleanup protector that removes leaked DOM/globals on teardown.

Treat enabling a script like installing software. If you need untrusted rendering, this architecture cannot provide it — real isolation would require `sandbox`ed iframes + a message-passing API, which is deliberately not done because it would break the existing script ABI (scripts expect synchronous globals like `TavernHelper`, `$`, `Vue`).

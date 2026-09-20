// stream_applier.js — opt-in 'live' streaming runtime for frontend iframes.
// Injected into message iframes when render.streaming_mode === 'live'.
// The host postMessages {type:'TH_STREAM_PATCH', html} with WASM-balanced
// fragments; we assign innerHTML of the root container. <script> inside
// innerHTML does NOT execute — scripts run once the chunk seals and the
// host swaps in a real srcdoc (handled by the parent, not here).
(function () {
  var container = null;
  function ensureContainer() {
    if (!container) {
      container = window.document.getElementById('th-stream-root');
      if (!container) {
        container = window.document.createElement('div');
        container.id = 'th-stream-root';
        window.document.body.appendChild(container);
      }
    }
    return container;
  }
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (data && data.type === 'TH_STREAM_PATCH') {
      ensureContainer().innerHTML = data.html;
    }
  });
  // keep auto-height working against the container
})();

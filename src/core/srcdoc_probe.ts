// srcdoc-vs-blob probe — feature-detect the Firefox srcdoc teardown.
// Firefox removes srcdoc iframes on navigation (the workaround chain
// frameElement.id→__TH_IFRAME_ID→window.name exists because of it); when
// flaky, prefer blob-URL documents which don't hit that path.
// Runs once at engine start; result cached.

let flaky: boolean | null = null;

export function srcdocIsFlaky(): boolean {
  return flaky === true;
}

/** resolves true when srcdoc iframes lose their frameElement (FF quirk) */
export function probeSrcdoc(): Promise<boolean> {
  if (flaky !== null) return Promise.resolve(flaky);
  return new Promise<boolean>(resolve => {
    const iframe = document.createElement('iframe');
    iframe.id = 'th-srcdoc-probe';
    iframe.style.display = 'none';
    let settled = false;
    const timeout = setTimeout(() => finish(false), 2000); // assume fine on timeout
    const poll = setInterval(() => {
      const ok = (window as unknown as { __TH_SRCDOC_OK?: boolean }).__TH_SRCDOC_OK;
      if (ok !== undefined) {
        finish(!ok);
      }
    }, 10);
    // single cleanup path — a timeout must not leave the 10ms poll running
    function finish(v: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      iframe.remove();
      resolve((flaky = v));
    }
    // the probe script reports whether frameElement survives inside srcdoc
    iframe.srcdoc = `<!DOCTYPE html><script>
      parent.__TH_SRCDOC_OK = !!(window.frameElement && window.frameElement.id === 'th-srcdoc-probe');
    </script>`;
    document.body.appendChild(iframe);
  });
}

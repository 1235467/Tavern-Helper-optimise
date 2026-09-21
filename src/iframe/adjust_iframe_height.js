(function () {
  let scheduled = false;
  let lastHeight = 0;

  // delta gate: tiny resizes (animations, sub-pixel churn) don't deserve a
  // parent-document reflow — an animated frontend mutating at frame rate
  // would otherwise trigger a SetNeedStyleFlush+reflow per frame.
  const MIN_DELTA = 4;

  function measureAndPost() {
    scheduled = false;
    try {
      const doc = window.document;
      const body = doc.body;
      const html = doc.documentElement;
      if (!body || !html) {
        return;
      }

      let height = 0;
      height = body.scrollHeight;

      if (!Number.isFinite(height) || height <= 0) {
        return;
      }

      if (Math.abs(height - lastHeight) >= MIN_DELTA) {
        lastHeight = height;
        frameElement.style.height = `${height}px`;
      }
    } catch {
      //
    }
  }
  const throttledMeasureAndPost = _.throttle(measureAndPost, 500);

  function postIframeHeight() {
    if (scheduled) {
      return;
    }
    scheduled = true;

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(measureAndPost);
    } else {
      throttledMeasureAndPost();
    }
  }

  function observeHeightChange() {
    const body = document.body;
    if (!body) {
      return;
    }

    const resize_observer = new ResizeObserver(entries => {
      postIframeHeight();
    });
    resize_observer.observe(body);
  }

  $(() => {
    postIframeHeight();
    observeHeightChange();
  });
})();

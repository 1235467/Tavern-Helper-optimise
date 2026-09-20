// MessageIframe — vanilla replacement for src/panel/render/Iframe.vue +
// StreamingIframe.vue. Preserves the DOM + event contract bit-for-bit:
//   <iframe id="TH-message--<mesid>--<idx>" name=<same> loading="lazy"
//           frameborder="0" class="w-full" srcdoc|src=blob:...>
// mounted inside the div.TH-render wrapper; non-iframe siblings get 'hidden!';
// emits message_iframe_render_started on mount / ..._ended on load;
// unmount restores the pre/collapse-button visibility and revokes blob URLs.

import { env } from '@/core/env';
import { createMessageSrcdoc } from '@/core/srcdoc';
import { srcdocIsFlaky } from '@/core/srcdoc_probe';
import { eventSource } from '@sillytavern/script';

/** one shared resize broadcaster instead of a listener per iframe */
const liveIframes = new Set<MessageIframe>();
let resizeHooked = false;
function hookResize() {
  if (resizeHooked) return;
  resizeHooked = true;
  window.addEventListener('resize', () => {
    for (const f of liveIframes) {
      f.postViewportHeight();
    }
  });
}

export class MessageIframe {
  /** full iframe name, e.g. TH-message--12--0 or TH-message--12--0_1 */
  readonly name: string;
  private readonly iframe: HTMLIFrameElement;
  private blobUrl: string | null = null;
  private loaded = false;
  private liveMode: boolean;

  /**
   * @param name  full iframe id/name
   * @param host  the div.TH-render element (or the streaming host container)
   */
  constructor(name: string, host: HTMLElement, liveMode = false) {
    this.name = name;
    this.liveMode = liveMode;
    const iframe = document.createElement('iframe');
    iframe.id = name;
    iframe.name = name;
    iframe.loading = 'lazy';
    iframe.setAttribute('frameborder', '0');
    iframe.className = 'w-full';
    iframe.addEventListener('load', () => {
      this.loaded = true;
      eventSource.emit('message_iframe_render_ended', this.name);
    });
    this.iframe = iframe;
    hookResize();
    liveIframes.add(this);
    host.appendChild(iframe);
    // mirrors Iframe.vue onMounted
    eventSource.emit('message_iframe_render_started', this.name);
  }

  /** internal — used by the shared resize broadcaster */
  postViewportHeight() {
    this.iframe.contentWindow?.postMessage({ type: 'TH_UPDATE_VIEWPORT_HEIGHT' }, '*');
  }

  private setDocument(html: string) {
    // blob-URL documents when opted in OR when srcdoc is flaky (FF teardown)
    if (env().use_blob_url || srcdocIsFlaky()) {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = url;
      this.iframe.removeAttribute('srcdoc');
      this.iframe.src = url;
    } else {
      if (this.blobUrl) {
        URL.revokeObjectURL(this.blobUrl);
        this.blobUrl = null;
        this.iframe.removeAttribute('src');
      }
      this.iframe.srcdoc = html;
    }
  }

  /**
   * (Re)write the iframe document from entity-DECODED code text.
   * In live mode with an already-loaded applier iframe, sends a TH_STREAM_PATCH
   * postMessage instead of a srcdoc reload — no re-navigation.
   */
  private effectiveBlobMode(): boolean {
    return env().use_blob_url || srcdocIsFlaky();
  }

  updateCode(codeText: string) {
    if (this.liveMode && this.loaded) {
      this.iframe.contentWindow?.postMessage({ type: 'TH_STREAM_PATCH', html: codeText }, '*');
      eventSource.emit('message_iframe_render_updated', this.name);
      return;
    }
    // first load → started/ended pair; subsequent rewrites → render_updated
    const wasLoaded = this.loaded;
    this.setDocument(createMessageSrcdoc(codeText, this.effectiveBlobMode(), this.liveMode));
    if (wasLoaded) {
      eventSource.emit('message_iframe_render_updated', this.name);
    }
  }

  /** seal a live-mode iframe: write the final complete document once */
  seal(codeText: string) {
    this.liveMode = false;
    const wasLoaded = this.loaded;
    this.setDocument(createMessageSrcdoc(codeText, this.effectiveBlobMode(), false));
    if (wasLoaded) {
      eventSource.emit('message_iframe_render_updated', this.name);
    }
  }

  get element(): HTMLIFrameElement {
    return this.iframe;
  }

  unmount() {
    liveIframes.delete(this);
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.iframe.remove();
  }
}

/**
 * Mount-time DOM choreography from Iframe.vue: inside a .TH-render wrapper,
 * every non-iframe child gets 'hidden!'; on unmount the <pre> is unhidden
 * unless a collapse button exists (then the button shows '显示前端代码块').
 */
export function mountIntoRenderDiv(wrapper: HTMLElement, iframe: HTMLIFrameElement) {
  for (const child of Array.from(wrapper.children)) {
    if (child !== iframe) {
      child.classList.add('hidden!');
    }
  }
}

export function unmountFromRenderDiv(wrapper: HTMLElement) {
  const button = wrapper.querySelector<HTMLElement>(':scope > .TH-collapse-code-block-button');
  const pre = wrapper.querySelector<HTMLElement>(':scope > pre');
  if (!button) {
    pre?.classList.remove('hidden!');
  } else {
    button.textContent = '显示前端代码块';
    button.classList.remove('hidden!');
  }
}

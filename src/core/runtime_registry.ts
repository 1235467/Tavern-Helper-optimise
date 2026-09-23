// runtime_registry — vanilla replacement for src/store/iframe_runtimes/
// message.ts. A Map<mesid, MessageRuntime> + Set-based diffing instead of the
// O(chat) lodash chains, and zero Vue reactivity in the hot path.
//
// Preserved contract: render depth semantics of calcToRender, the .TH-render
// wrapper, TH-message--<id>--<idx> iframe naming, reloadAll forcing a remount,
// and the same ST event triggers.

import { env } from '@/core/env';
import { MessageIframe, mountIntoRenderDiv, unmountFromRenderDiv } from '@/core/iframe_controller';
import { scanMessage } from '@/core/message_scanner';
import { chat, event_types, eventSource } from '@sillytavern/script';

interface Mounted {
  wrapper: HTMLElement;
  iframe: MessageIframe;
}

/** a located frontend pre not yet mounted — IO gating defers the iframe
 * (and its ~10-script realm eval) until the wrapper nears the viewport */
interface PendingMount {
  wrapper: HTMLElement;
  pre: HTMLPreElement;
  index: number;
}

interface MessageRuntime {
  mounted: Mounted[];
  pending: PendingMount[];
}

/** chat container lookup — ST's live chat array is imported per-call since
 * `chat` binding is live (it IS — the module export mutates) */
export function calcToRender(depth: number, ignoreHidden: boolean): number[] {
  const firstMes = document.querySelector('#chat > .mes');
  const minId = firstMes ? Number(firstMes.getAttribute('mesid')) : 0;
  const out: number[] = [];
  if (!ignoreHidden) {
    const start = depth === 0 ? minId : Math.max(minId, chat.length - depth);
    for (let i = start; i < chat.length; i++) out.push(i);
    return out;
  }
  for (let i = minId; i < chat.length; i++) {
    if (!chat[i]?.is_system) out.push(i);
  }
  return depth === 0 ? out : out.slice(-depth);
}

function mesElement(id: number): HTMLElement | null {
  return document.querySelector(`#chat > .mes[mesid="${id}"]`);
}

const IO_MARGIN_PX = 300;

function isNearViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > -IO_MARGIN_PX && r.top < window.innerHeight + IO_MARGIN_PX;
}

export class RuntimeRegistry {
  private runtimes = new Map<number, MessageRuntime>();
  /** element → pending record, for the shared IntersectionObserver */
  private pendingByEl = new Map<HTMLElement, { messageId: number; rec: PendingMount }>();
  private observer = new IntersectionObserver(
    entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        this.observer.unobserve(e.target);
        const rec = this.pendingByEl.get(e.target as HTMLElement);
        if (rec) {
          this.pendingByEl.delete(e.target as HTMLElement);
          this.mountPending(rec.messageId, rec.rec);
        }
      }
    },
    { rootMargin: `${IO_MARGIN_PX}px` },
  );

  private mountIframe(messageId: number, index: number, wrapper: HTMLElement, pre: HTMLPreElement): Mounted {
    const name = `TH-message--${messageId}--${index}`;
    const iframe = new MessageIframe(name, wrapper);
    mountIntoRenderDiv(wrapper, iframe.element);
    iframe.updateCode(pre.textContent ?? '');
    return { wrapper, iframe };
  }

  private mountPending(messageId: number, rec: PendingMount) {
    const rt = this.runtimes.get(messageId);
    if (!rt) return;
    const pi = rt.pending.indexOf(rec);
    if (pi === -1) return;
    rt.pending.splice(pi, 1);
    rt.mounted.push(this.mountIframe(messageId, rec.index, rec.wrapper, rec.pre));
  }

  /** mount iframes for every frontend <pre> in one message (IO-gated) */
  private renderOne(messageId: number): MessageRuntime | null {
    const mes = mesElement(messageId);
    if (!mes) return null;
    const found = scanMessage(mes);
    if (found.length === 0) return null;
    const mounted: Mounted[] = [];
    const pending: PendingMount[] = [];
    found.forEach(({ wrapper, pre }, index) => {
      const rec = { wrapper, pre, index };
      if (env().io_gate && !isNearViewport(wrapper)) {
        pending.push(rec);
        this.pendingByEl.set(wrapper, { messageId, rec });
        this.observer.observe(wrapper);
      } else {
        mounted.push(this.mountIframe(messageId, index, wrapper, pre));
      }
    });
    return { mounted, pending };
  }

  private drop(messageId: number) {
    const rt = this.runtimes.get(messageId);
    if (rt) {
      for (const m of rt.mounted) {
        m.iframe.unmount();
        unmountFromRenderDiv(m.wrapper);
      }
      for (const p of rt.pending) {
        this.observer.unobserve(p.wrapper);
        this.pendingByEl.delete(p.wrapper);
        // pending wrappers never mounted an iframe — the <pre> is already
        // visible; nothing else to undo
      }
      this.runtimes.delete(messageId);
    }
  }

  /** mount everything still deferred — used when io_gate turns off, so the
   * toggle restores render-on-startup immediately instead of waiting for
   * each pending wrapper to scroll into the observer margin */
  private flushPending() {
    for (const [id, rt] of this.runtimes) {
      for (const rec of [...rt.pending]) {
        this.observer.unobserve(rec.wrapper);
        this.pendingByEl.delete(rec.wrapper);
        this.mountPending(id, rec); // splices itself out of rt.pending
      }
    }
  }

  /** auditRuntimes: keep runtimes still in range, mount missing, drop stale */
  audit() {
    const toRender = new Set(calcToRender(env().depth, env().depth_ignore_hidden));
    for (const id of [...this.runtimes.keys()]) {
      if (!toRender.has(id)) this.drop(id);
    }
    for (const id of toRender) {
      if (!this.runtimes.has(id)) {
        const rt = this.renderOne(id);
        if (rt) this.runtimes.set(id, rt);
      }
    }
    if (!env().io_gate) this.flushPending();
  }

  /** drop+remount one message (MESSAGE_UPDATED / MESSAGE_SWIPED / RENDERED) */
  refresh(messageId: number) {
    this.drop(messageId);
    const rt = this.renderOne(messageId);
    if (rt) this.runtimes.set(messageId, rt);
  }

  /** reloadAll — force-remount every runtime */
  reloadAll() {
    for (const id of [...this.runtimes.keys()]) {
      this.refresh(id);
    }
  }

  clear() {
    for (const id of [...this.runtimes.keys()]) this.drop(id);
  }

  get size() {
    return this.runtimes.size;
  }
}

/** wire ST events onto a registry — returns a disposer */
export function initRuntimeRegistry(registry: RuntimeRegistry): () => void {
  const rerender = (id: number | string) => {
    if (env().enabled) registry.refresh(Number(id));
  };
  const audit = () => {
    if (env().enabled) registry.audit();
  };
  const rerenderAll = () => {
    registry.clear();
    audit();
  };
  const on = (ev: string, fn: (...a: any[]) => void) => eventSource.on(ev, fn);

  on('chatLoaded', rerenderAll);
  [
    event_types.CHARACTER_MESSAGE_RENDERED,
    event_types.USER_MESSAGE_RENDERED,
    event_types.MESSAGE_UPDATED,
    event_types.MESSAGE_SWIPED,
  ].forEach(ev => on(ev, rerender));
  [event_types.MESSAGE_DELETED, event_types.MORE_MESSAGES_LOADED].forEach(ev => on(ev, audit));
  return () => registry.clear();
}

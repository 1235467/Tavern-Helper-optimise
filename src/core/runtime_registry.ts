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

interface MessageRuntime {
  mounted: Mounted[];
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

export class RuntimeRegistry {
  private runtimes = new Map<number, MessageRuntime>();

  /** mount iframes for every frontend <pre> in one message */
  private renderOne(messageId: number): MessageRuntime | null {
    const mes = mesElement(messageId);
    if (!mes) return null;
    const found = scanMessage(mes);
    if (found.length === 0) return null;
    const mounted: Mounted[] = found.map(({ wrapper }, index) => {
      const name = `TH-message--${messageId}--${index}`;
      const iframe = new MessageIframe(name, wrapper);
      mountIntoRenderDiv(wrapper, iframe.element);
      // content = decoded text of the <pre> (the code inside the code tags)
      iframe.updateCode(found[index].pre.textContent ?? '');
      return { wrapper, iframe };
    });
    return { mounted };
  }

  private drop(messageId: number) {
    const rt = this.runtimes.get(messageId);
    if (rt) {
      for (const m of rt.mounted) {
        m.iframe.unmount();
        unmountFromRenderDiv(m.wrapper);
      }
      this.runtimes.delete(messageId);
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

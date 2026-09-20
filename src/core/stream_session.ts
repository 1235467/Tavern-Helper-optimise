// StreamSession — streaming render of one message, replacing the
// Streaming.vue → StreamingOne.vue → {StreamingIframe,StreamingNestedIframe}
// chain. Key optimization vs the original: chunks are *sealed* once their
// element closes, so already-complete iframes are never reloaded — the
// per-token srcdoc rebuild storm is gone. In 'live' mode the trailing
// unsealed iframe gets postMessage deltas instead of reloads.
//
// Preserved contract: `.mes_text` hidden + `div.TH-streaming.w-full` sibling;
// yields to third-party `.mes_streaming`; edit-textarea swap; chunk types and
// TH-message--<id>--<idx>[_<n>] naming; render_started/ended events.

import { env } from '@/core/env';
import {
  MessageIframe,
  mountIntoRenderDiv,
  unmountFromRenderDiv,
} from '@/core/iframe_controller';
import { ensureRenderWrapper } from '@/core/message_scanner';
import { engine, getWasm, type PartitionChunk } from '@/wasm/loader';
import { chat, event_types, eventSource } from '@sillytavern/script';

const KIND_NORMAL = 0;
const KIND_IFRAME = 2;
const KIND_NESTED = 3;

interface ChunkView {
  kind: number;
  sealed: boolean;
  /** div host for normal/details/nested; iframe wrapper for iframe chunks */
  host: HTMLElement;
  iframe?: MessageIframe;
  /** nested chunk: ordinal→detached .TH-render wrapper preserving iframes */
  wrappers?: Map<number, { wrapper: HTMLElement; iframe: MessageIframe; code: string }>;
  lastHtml?: string;
}

function mesElement(id: number): HTMLElement | null {
  return document.querySelector(`#chat > .mes[mesid="${id}"]`);
}

export class StreamSession {
  private host: HTMLElement; // div.TH-streaming
  private mesText: HTMLElement | null;
  private views: ChunkView[] = [];
  private scheduled = false;
  private destroyed = false;
  private textareaObserver: MutationObserver;
  private mesStreamingObserver: MutationObserver;
  onDestroy: (id: number) => void = () => {};

  constructor(private messageId: number) {
    const mes = mesElement(messageId);
    this.mesText = mes?.querySelector<HTMLElement>('.mes_text') ?? null;
    this.host = document.createElement('div');
    this.host.className = 'TH-streaming w-full';

    this.textareaObserver = new MutationObserver(() => this.syncEditTextarea());
    this.mesStreamingObserver = new MutationObserver(() => this.checkYield());
  }

  mount() {
    const mes = mesElement(this.messageId);
    if (!mes || !this.mesText) return;
    this.mesText.classList.add('hidden!');
    this.mesText.insertAdjacentElement('afterend', this.host);
    this.textareaObserver.observe(this.mesText, { childList: true });
    this.mesStreamingObserver.observe(mes, { childList: true });
    this.tick();
  }

  /** STREAM_TOKEN_RECEIVED → schedule one reconcile per frame */
  onToken() {
    if (this.scheduled || this.destroyed) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      if (!this.destroyed) this.tick();
    });
  }

  /** .mes_streaming sibling appeared → third-party renderer takes over */
  private checkYield() {
    if (this.mesText?.parentElement?.querySelector('.mes_streaming')) {
      this.destroy();
    }
  }

  /** show real mes_text while its edit textarea is open */
  private syncEditTextarea() {
    const editArea = document.querySelector('#chat #curEditTextarea');
    if (editArea?.parentElement === this.mesText) {
      this.mesText?.classList.remove('hidden!');
      this.host.classList.add('hidden!');
    } else if (!editArea) {
      this.mesText?.classList.add('hidden!');
      this.host.classList.remove('hidden!');
    }
  }

  /** validity check ported from Streaming.vue destroyIfInvalid */
  isInvalid(): boolean {
    const mes = mesElement(this.messageId);
    if (!mes) return true;
    if (mes.querySelector('.mes_streaming')) return true;
    const firstMes = document.querySelector('#chat > .mes');
    const minId = firstMes ? Number(firstMes.getAttribute('mesid')) : 0;
    const { depth, depth_ignore_hidden } = env();
    const begin = depth === 0 ? minId : Math.max(minId, chat.length - depth);
    if (!depth_ignore_hidden && (this.messageId < begin || this.messageId >= chat.length)) {
      return true;
    }
    if (depth_ignore_hidden) {
      // calcToRender semantics: last `depth` non-system messages
      const visible: number[] = [];
      for (let i = minId; i < chat.length; i++) if (!chat[i]?.is_system) visible.push(i);
      const range = depth === 0 ? visible : visible.slice(-depth);
      if (!range.includes(this.messageId)) return true;
    }
    return false;
  }

  private tick() {
    if (this.isInvalid()) {
      this.destroy();
      return;
    }
    if (!this.mesText) return;
    const { chunks } = engine.partitionMessageHtml(this.mesText.innerHTML);
    this.reconcile(chunks);
  }

  private reconcile(chunks: PartitionChunk[]) {
    // drop views beyond the new chunk count
    while (this.views.length > chunks.length) {
      this.destroyView(this.views.pop()!);
    }
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const existing = this.views[i];
      if (existing && existing.sealed) continue; // frozen — never touched again
      if (existing && existing.kind !== chunk.kind) {
        this.destroyView(existing);
        this.views[i] = this.createView(chunk, i);
        continue;
      }
      if (!existing) {
        this.views[i] = this.createView(chunk, i);
        continue;
      }
      this.updateView(existing, chunk, i);
    }
    // keep host children aligned with view order — appendChild moves nodes
    for (const v of this.views) {
      this.host.appendChild(v.host);
    }
  }

  private createView(chunk: PartitionChunk, index: number): ChunkView {
    if (chunk.kind === KIND_IFRAME) {
      const name = `TH-message--${this.messageId}--${index}`;
      // live mode only while the chunk can still grow — an already-sealed
      // chunk gets a normal srcdoc immediately
      const live = env().streaming_mode === 'live' && !chunk.sealed;
      const iframe = new MessageIframe(name, this.host, live);
      iframe.updateCode(engine.textContent(chunk.code));
      return {
        kind: chunk.kind,
        sealed: chunk.sealed,
        host: iframe.element,
        iframe,
        lastHtml: chunk.html,
      };
    }
    const host = document.createElement('div');
    this.host.appendChild(host);
    const view: ChunkView = { kind: chunk.kind, sealed: chunk.sealed, host };
    if (chunk.kind === KIND_NESTED) {
      view.wrappers = new Map();
      this.patchNested(view, chunk, index);
    } else {
      host.innerHTML = chunk.html;
      view.lastHtml = chunk.html;
    }
    return view;
  }

  private updateView(view: ChunkView, chunk: PartitionChunk, index: number) {
    if (chunk.html === view.lastHtml) {
      // bytes unchanged — but a seal flip still needs the final srcdoc write
      // (live iframes hold an applier shell until sealed)
      if (chunk.sealed && !view.sealed) {
        view.sealed = true;
        if (view.iframe && env().streaming_mode === 'live') {
          view.iframe.seal(engine.textContent(chunk.code));
        }
      }
      return;
    }
    view.lastHtml = chunk.html;
    if (view.kind === KIND_IFRAME && view.iframe) {
      const code = engine.textContent(chunk.code);
      if (chunk.sealed && env().streaming_mode === 'live') {
        view.iframe.seal(code);
      } else {
        view.iframe.updateCode(code);
      }
      view.sealed = chunk.sealed;
      return;
    }
    if (view.kind === KIND_NESTED) {
      this.patchNested(view, chunk, index);
      view.sealed = chunk.sealed;
      return;
    }
    view.host.innerHTML = chunk.html;
    view.sealed = chunk.sealed;
  }

  /** nested_iframe chunk: patch host innerHTML, mount/preserve inner pres */
  private patchNested(view: ChunkView, chunk: PartitionChunk, index: number) {
    const host = view.host;
    // detach existing TH-render wrappers so innerHTML can't destroy them —
    // sealed inner iframes survive the patch untouched.
    const kept = view.wrappers ?? new Map();
    for (const [, w] of kept) {
      w.wrapper.remove();
    }
    host.innerHTML = chunk.html;
    const pres = Array.from(host.querySelectorAll('pre'));
    const wasm = getWasm();
    const blocks = wasm
      ? wasm.findFrontendBlocks(chunk.html)
      : engine.findFrontendBlocks(chunk.html);
    const seen = new Set<number>();
    blocks.forEach((b, sub) => {
      const pre = pres[b.ordinal];
      if (!pre) return;
      seen.add(b.ordinal);
      const code = b.code();
      const existing = kept.get(b.ordinal);
      if (existing && existing.code === code) {
        // unchanged content — reinsert preserved wrapper (iframe stays alive)
        pre.replaceWith(existing.wrapper);
        return;
      }
      if (existing) {
        // content changed: reuse wrapper, update iframe
        pre.replaceWith(existing.wrapper);
        existing.iframe.updateCode(code);
        existing.code = code;
        return;
      }
      const wrapper = ensureRenderWrapper(pre);
      const name = `TH-message--${this.messageId}--${index}_${sub}`;
      const iframe = new MessageIframe(name, wrapper);
      mountIntoRenderDiv(wrapper, iframe.element);
      iframe.updateCode(code);
      kept.set(b.ordinal, { wrapper, iframe, code });
    });
    for (const [ord, w] of kept) {
      if (!seen.has(ord)) {
        w.iframe.unmount();
        unmountFromRenderDiv(w.wrapper);
        w.wrapper.remove();
        kept.delete(ord);
      }
    }
    view.wrappers = kept;
  }

  private destroyView(v: ChunkView) {
    v.iframe?.unmount();
    if (v.wrappers) {
      for (const [, w] of v.wrappers) {
        w.iframe.unmount();
        w.wrapper.remove();
      }
      v.wrappers.clear();
    }
    v.host.remove();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.textareaObserver.disconnect();
    this.mesStreamingObserver.disconnect();
    for (const v of this.views) this.destroyView(v);
    this.views = [];
    this.host.remove();
    // restore mes_text unless a third-party .mes_streaming sibling took over
    if (this.mesText && !this.mesText.parentElement?.querySelector('.mes_streaming')) {
      this.mesText.classList.remove('hidden!');
    }
    this.onDestroy(this.messageId);
  }
}

/**
 * Session manager — replaces Streaming.vue. Owns Map<mesid, StreamSession>,
 * driven by ST events; rAF-batches token updates per session.
 */
export class StreamManager {
  private sessions = new Map<number, StreamSession>();

  private destroy(id: number) {
    this.sessions.get(id)?.destroy();
    this.sessions.delete(id);
  }

  /** session for a message — create on demand when renderable/streaming */
  ensure(id: number, duringStreaming = false): void {
    if (!env().allow_streaming) return;
    if (this.sessions.get(id)?.isInvalid()) {
      this.destroy(id);
    }
    if (this.sessions.has(id)) {
      this.sessions.get(id)!.onToken();
      return;
    }
    const mes = mesElement(id);
    const mesText = mes?.querySelector<HTMLElement>('.mes_text');
    if (!mesText) return;
    if (
      mesText.parentElement?.querySelector('.mes_streaming') ||
      (!duringStreaming && !containsFrontend(mesText))
    ) {
      return;
    }
    const session = new StreamSession(id);
    session.onDestroy = mid => this.sessions.delete(mid);
    this.sessions.set(id, session);
    session.mount();
  }

  refreshAll() {
    for (const id of [...this.sessions.keys()]) {
      const s = this.sessions.get(id)!;
      if (s.isInvalid()) s.destroy();
    }
  }

  clear() {
    for (const s of this.sessions.values()) s.destroy();
    this.sessions.clear();
  }
}

function containsFrontend(el: HTMLElement): boolean {
  const pres = el.querySelectorAll('pre');
  for (const pre of pres) {
    if (engine.isFrontend(pre.textContent ?? '')) return true;
  }
  return el.querySelector('div.TH-render') !== null;
}

/** ST event wiring for the stream manager — returns a disposer */
export function initStreamManager(mgr: StreamManager): () => void {
  const on = (ev: string, fn: (...a: any[]) => void) => eventSource.on(ev, fn);

  on(event_types.STREAM_TOKEN_RECEIVED, () => {
    const last = document.querySelector('#chat > .mes.last_mes');
    const id = last ? Number(last.getAttribute('mesid')) : NaN;
    if (!Number.isNaN(id)) mgr.ensure(id, true);
  });
  [event_types.CHARACTER_MESSAGE_RENDERED, event_types.USER_MESSAGE_RENDERED].forEach(ev =>
    on(ev, (id: number | string) => mgr.ensure(Number(id))),
  );
  [event_types.MESSAGE_EDITED, event_types.MESSAGE_SWIPED].forEach(ev =>
    on(ev, (id: number | string) => {
      const n = Number(id);
      mgr.ensure(n);
      // settle after the DOM updates
      setTimeout(() => mgr.ensure(n));
    }),
  );
  [event_types.MORE_MESSAGES_LOADED, event_types.MESSAGE_DELETED].forEach(ev =>
    on(ev, () => mgr.refreshAll()),
  );
  on('chatLoaded', () => mgr.clear());
  return () => mgr.clear();
}

// Message scanner — finds frontend <pre> elements inside a .mes div:
// one innerHTML serialize → engine.findFrontendBlocks → ordinal pairing with
// querySelectorAll('pre') (same semantics as the original jQuery filter —
// isFrontend($(pre).text())).
//
// After locating them, each <pre> is wrapped in <div class="TH-render"> —
// exactly what render$mes does in src/store/iframe_runtimes/message.ts:22-29.

import { env } from '@/core/env';
import { engine } from '@/wasm/loader';

/**
 * Wrap `pre` in a div.TH-render (reusing an existing wrapper), returning the
 * wrapper — mirrors `$pre.parent('div.TH-render') ?? $pre.wrap(...)`.
 */
export function ensureRenderWrapper(pre: HTMLElement): HTMLElement {
  const parent = pre.parentElement;
  if (parent && parent.tagName === 'DIV' && parent.classList.contains('TH-render')) {
    return parent;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'TH-render';
  pre.parentNode?.insertBefore(wrapper, pre);
  wrapper.appendChild(pre);
  return wrapper;
}

/** frontend <pre> elements inside `mes`, in document order */
export function findFrontendPres(mes: HTMLElement): HTMLPreElement[] {
  const pres = Array.from(mes.querySelectorAll('pre'));
  // innerHTML order == document order for the <pre> sequence — the ordinal
  // field pairs a scanned block back to its DOM element.
  return engine
    .findFrontendBlocks(mes.innerHTML)
    .map(b => pres[b.ordinal])
    .filter((el): el is HTMLPreElement => el !== undefined);
}

/**
 * render$mes equivalent: for each .mes div, find frontend pres, apply the
 * streaming filter (when allow_streaming, pres inside .mes_text/.TH-streaming
 * are owned by StreamSession instead), wrap each in div.TH-render.
 * Returns [{wrapper, pre}] in document order.
 */
export function scanMessage(mes: HTMLElement): { wrapper: HTMLElement; pre: HTMLPreElement }[] {
  const allowStreaming = env().allow_streaming;
  return findFrontendPres(mes)
    .filter(pre => {
      if (!allowStreaming) return true;
      // $(pre).closest('.mes_text, .TH-streaming').length === 0
      return pre.closest('.mes_text, .TH-streaming') === null;
    })
    .map(pre => ({ wrapper: ensureRenderWrapper(pre), pre }));
}

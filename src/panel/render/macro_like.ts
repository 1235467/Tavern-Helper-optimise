import { SendingMessage } from '@/function/event';
import { macros, type MacroLikeContext } from '@/function/macro_like';
import { highlight_code, reloadAndRenderChatWithoutEvents, version } from '@/util/tavern';
import { engine } from '@/wasm/loader';
import { event_types, eventSource } from '@sillytavern/script';
import { compare } from 'compare-versions';

export function replaceMacroLike(text: string, context: MacroLikeContext) {
  for (const macro of macros) {
    macro.regex.lastIndex = 0;
    text = text.replace(macro.regex, (substring: string, ...args: any[]) => macro.replace(context, substring, ...args));
  }
  return text;
}

function demacroOnPrompt(
  event_data: {
    prompt: SendingMessage[];
  },
  dry_run: boolean,
) {
  if (dry_run) {
    return;
  }

  for (const message of event_data.prompt) {
    // 跳过没有 content 的消息（如只有 tool_calls 的消息）
    if (!message.content) {
      continue;
    }
    for (const macro of macros) {
      if (typeof message.content === 'string') {
        macro.regex.lastIndex = 0;
        message.content = message.content.replace(macro.regex, (substring: string, ...args: any[]) =>
          // 'tool' is excluded from MacroLikeContext.role — narrow the union
          macro.replace({ role: message.role as 'user' }, substring, ...args),
        );
      } else if (Array.isArray(message.content)) {
        message.content
          .filter(item => item.type === 'text')
          .forEach(item => {
            macro.regex.lastIndex = 0;
            item.text = item.text.replace(macro.regex, (substring: string, ...args: any[]) =>
              macro.replace({ role: message.role as 'user' }, substring, ...args),
            );
          });
      }
    }
  }
}

/** verbatim original path — wholesale innerHTML rewrite + iframe teardown.
 * Kept for custom registerMacroLike regexes whose ^/$/m semantics can't be
 * evaluated per-text-node. */
function legacyDemacroOnRender($mes: JQuery<HTMLDivElement>) {
  const $mes_text = $mes.find('.mes_text');
  const replace_html = (html: string) =>
    replaceMacroLike(html, { role: $mes.attr('is_user') === 'true' ? 'user' : 'assistant' });

  // 因未知原因, 一些设备上在初次进入角色卡时会 '渲染前端界面-替换助手宏-渲染前端界面', 因此需要移除额外渲染的 iframe
  $mes_text.find('.TH-render > iframe').remove();

  $mes_text.html((_index, html) => replace_html(html));
  $mes_text
    .find('code')
    .filter((_index, element) =>
      macros.some(macro => {
        macro.regex.lastIndex = 0;
        return macro.regex.test($(element).text());
      }),
    )
    .text((_index, text) => replace_html(text))
    .removeClass('hljs')
    .each((_index, element) => {
      highlight_code(element);
    });
}

/**
 * Node-targeted builtin-macro replacement — replaces `{{get_*_variable}}` /
 * `{{format_*_variable}}` inside individual text nodes instead of rewriting
 * the whole .mes_text innerHTML (which destroys every rendered iframe).
 * Driven by engine.scanBuiltinMacros spans (JS port; see wasm/loader.ts); replacement
 * still goes through the original macros[0]/macros[1] `replace` fns so
 * semantics are bit-identical.
 */
function builtinDemacroOnRender($mes: JQuery<HTMLDivElement>, recs: ReturnType<typeof engine.scanBuiltinMacros>) {
  const mes_text = $mes.find('.mes_text')[0];
  const fullText = mes_text.textContent ?? '';
  const context: MacroLikeContext = { role: $mes.attr('is_user') === 'true' ? 'user' : 'assistant' };
  const [getMacro, formatMacro] = macros;

  // text nodes with cumulative offsets (spans are into textContent)
  const walker = document.createTreeWalker(mes_text, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number; end: number }[] = [];
  let pos = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    nodes.push({ node: t, start: pos, end: pos + t.data.length });
    pos += t.data.length;
  }

  // group recs by containing node; apply descending within each node so
  // earlier offsets stay valid
  const byNode = new Map<number, typeof recs>();
  for (const rec of recs) {
    const idx = nodes.findIndex(n => rec.matchStart >= n.start && rec.matchEnd <= n.end);
    if (idx === -1) {
      // format records include their line prefix — any element boundary on
      // the line makes the record span text nodes, which offsets can't
      // express. NOT equivalent to legacy (which replaced the whole html
      // string): defer to it — the render pipeline remounts iframes after
      // demacro on the same event chain (see index.ts ordering note).
      legacyDemacroOnRender($mes);
      return;
    }
    const arr = byNode.get(idx) ?? [];
    arr.push(rec);
    byNode.set(idx, arr);
  }

  const touchedPres = new Set<HTMLElement>();
  const touchedCodes = new Set<HTMLElement>();
  const markTouched = (node: Text) => {
    const pre = (node.parentElement as HTMLElement | null)?.closest('pre');
    if (pre) {
      touchedPres.add(pre as HTMLElement);
    }
    // legacy searches ALL descendant <code> — inline code outside <pre> also
    // gets second-order replacement
    const code = (node.parentElement as HTMLElement | null)?.closest('code');
    if (code) touchedCodes.add(code as HTMLElement);
  };

  for (const [idx, nodeRecs] of byNode) {
    const { node, start } = nodes[idx];
    // pathological nesting: the format match's PREFIX text itself contains
    // another {{format_ — applyFormatVariable's inner recursion rewrites the
    // prefix and shifts offsets the spans can't track. Fall back to a
    // whole-node replaceMacroLike for that node (upstream semantics, scoped).
    const hasNested = nodeRecs.some(
      r => r.kind === 'format' && /\{\{format_/i.test(fullText.slice(r.matchStart, r.macroStart)),
    );
    // overlapping records (e.g. a get inside a format's ::path}} — the get
    // span ends at the format's own matchEnd) can't be applied by stale
    // offsets/paths: the earlier replacement changes the text the later
    // record points at. Whole-node replaceMacroLike applies macros in the
    // original order against the current string.
    const byStart = [...nodeRecs].sort((a, b) => a.matchStart - b.matchStart || a.matchEnd - b.matchEnd);
    const overlaps = byStart.some((r, i) => i > 0 && r.matchStart < byStart[i - 1].matchEnd);
    if (hasNested || overlaps) {
      node.data = replaceMacroLike(node.data, context);
      markTouched(node);
      continue;
    }
    // sort by matchEnd desc: format matches (whose prefix encloses get macros)
    // apply first — their replacement copies the prefix verbatim, so nested
    // get spans stay valid; sibling gets apply in descending order too
    nodeRecs.sort((a, b) => b.matchEnd - a.matchEnd || b.matchStart - a.matchStart);
    for (const rec of nodeRecs) {
      const s = rec.matchStart - start;
      const e = rec.matchEnd - start;
      if (rec.kind === 'get') {
        const rep = getMacro.replace(
          context,
          fullText.slice(rec.matchStart, rec.matchEnd),
          rec.scope,
          fullText.slice(rec.pathStart, rec.pathEnd),
        );
        node.data = node.data.slice(0, s) + rep + node.data.slice(e);
      } else {
        const rep = formatMacro.replace(
          context,
          fullText.slice(rec.matchStart, rec.matchEnd),
          fullText.slice(rec.matchStart, rec.macroStart),
          rec.scope,
          fullText.slice(rec.pathStart, rec.pathEnd),
        );
        node.data = node.data.slice(0, s) + rep + node.data.slice(e);
      }
      markTouched(node);
    }
  }

  // iframes whose backing <pre> changed must remount — drop the iframe and
  // unhide the pre (the render pipeline re-renders on the same event chain;
  // unhidden is a safer degraded state than invisible content)
  touchedPres.forEach(pre => {
    const wrapper = pre.closest('.TH-render');
    wrapper?.querySelector('iframe')?.remove();
    pre.classList.remove('hidden!');
  });
  // code-level pass mirrors the original exactly: only codes whose text
  // STILL contains a macro match (i.e. second-order macros produced by the
  // replacement) get re-replaced and re-highlighted
  touchedCodes.forEach(code => {
    const text = code.textContent ?? '';
    const hasMacro = macros.some(macro => {
      macro.regex.lastIndex = 0;
      return macro.regex.test(text);
    });
    if (!hasMacro) {
      return;
    }
    code.textContent = replaceMacroLike(text, context);
    code.classList.remove('hljs');
    highlight_code(code);
  });
}

function demacroOnRender($mes: JQuery<HTMLDivElement>) {
  const $mes_text = $mes.find('.mes_text');
  if ($mes_text.length === 0) {
    return;
  }
  const text = $mes_text.text();

  // WASM prescan for the two builtin macro families + JS test for
  // user-registered custom macros (arbitrary RegExp can't move to Rust)
  const builtinRecs = engine.scanBuiltinMacros(text);
  const customHit = macros.slice(2).some(macro => {
    macro.regex.lastIndex = 0;
    return macro.regex.test(text);
  });
  if (builtinRecs.length === 0 && !customHit) {
    return;
  }
  if (customHit) {
    legacyDemacroOnRender($mes);
    return;
  }
  builtinDemacroOnRender($mes, builtinRecs);
}

function demacroOnRenderOne(message_id: number) {
  demacroOnRender($(`#chat > .mes[mesid="${message_id}"]`));
}

function demacroOnRenderAll() {
  $('#chat > .mes').each((_index, node) => {
    demacroOnRender($(node as HTMLDivElement));
  });
}

export function useMacroLike(enabled: Readonly<Ref<boolean>>, managed = false) {
  if (!managed) {
    watch(enabled, (value, old_value) => {
      if (value !== old_value) {
        reloadAndRenderChatWithoutEvents();
      }
    });
  }

  if (compare(version, '1.13.5', '>=')) {
    eventSource.on(event_types.GENERATE_AFTER_DATA, (event_data: any, dry_run: boolean) => {
      if (enabled.value) {
        demacroOnPrompt(event_data, dry_run);
      }
    });
  } else {
    eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, (generate_data: any) => {
      if (enabled.value) {
        demacroOnPrompt({ prompt: generate_data.messages }, false);
      }
    });
  }

  if (managed) {
    return;
  }

  eventSource.on('chatLoaded', () => {
    if (enabled.value) {
      demacroOnRenderAll();
    }
  });
  [
    event_types.CHARACTER_MESSAGE_RENDERED,
    event_types.USER_MESSAGE_RENDERED,
    event_types.MESSAGE_UPDATED,
    event_types.MESSAGE_SWIPED,
  ].forEach(event => {
    eventSource.on(event, (message_id: number | string) => {
      if (enabled.value) {
        demacroOnRenderOne(Number(message_id));
      }
    });
  });
}

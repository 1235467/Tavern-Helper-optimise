// Pure-JS mirror of crates/th-core/src/{tokenizer,partition,frontend_scan}.rs.
// This is BOTH the no-WASM fallback for the streaming partitioner AND the
// parity oracle — it must produce identical results to the wasm module.
// Works without a DOM (no jQuery/innerHTML).

import { isFrontend } from './is_frontend.mjs';
import { textContent } from './entities.mjs';

const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const RAW_TEXT = new Set(['script','style','textarea','title']);
const MAX_DEPTH = 256;

const isNameStart = c => /[a-zA-Z]/.test(c);
const isNameChar = c => /[a-zA-Z0-9\-:_]/.test(c);
const isWs = c => ' \t\n\f\r'.includes(c);

function eqCi(a, b) { return a.length === b.length && a.toLowerCase() === b.toLowerCase(); }

function scanOpenTag(s, at) {
  if (at + 1 >= s.length || s[at] !== '<' || !isNameStart(s[at + 1])) return null;
  const ns = at + 1;
  let i = ns;
  while (i < s.length && isNameChar(s[i])) i += 1;
  const ne = i;
  const as = i;
  let quote = '';
  while (i < s.length) {
    const b = s[i];
    if (quote) {
      if (b === quote) quote = '';
    } else if (b === '"' || b === "'") {
      quote = b;
    } else if (b === '>') {
      let j = i;
      while (j > as && isWs(s[j - 1])) j -= 1;
      const selfClose = j > as && s[j - 1] === '/';
      return { ns, ne, as, ae: i, openEnd: i + 1, selfClose };
    }
    i += 1;
  }
  return { ns, ne, as, ae: s.length, openEnd: s.length, selfClose: false };
}

function findCloseTag(s, from, name) {
  let i = from;
  while (i + 1 < s.length) {
    if (s[i] === '<' && s[i + 1] === '/') {
      const ns = i + 2;
      let j = ns;
      while (j < s.length && isNameChar(s[j])) j += 1;
      if (eqCi(s.slice(ns, j), name)) {
        let k = j;
        while (k < s.length && s[k] !== '>') k += 1;
        return { start: i, end: k < s.length ? k + 1 : s.length };
      }
    }
    i += 1;
  }
  return null;
}

function hasClass(s, el, cls) {
  let i = el.as;
  const end = el.ae;
  while (i < end) {
    while (i < end && isWs(s[i])) i += 1;
    const ns = i;
    while (i < end && !isWs(s[i]) && s[i] !== '=' && s[i] !== '/') i += 1;
    const ne = i;
    while (i < end && isWs(s[i])) i += 1;
    if (i < end && s[i] === '=') {
      i += 1;
      while (i < end && isWs(s[i])) i += 1;
      let vs, ve;
      if (i < end && (s[i] === '"' || s[i] === "'")) {
        const q = s[i];
        vs = i + 1;
        let j = vs;
        while (j < end && s[j] !== q) j += 1;
        ve = j;
        i = Math.min(j + 1, end);
      } else {
        vs = i;
        while (i < end && !isWs(s[i])) i += 1;
        ve = i;
      }
      if (ne > ns && eqCi(s.slice(ns, ne), 'class')) {
        return s.slice(vs, ve).split(/[ \t\n\f\r]+/).some(t => t === cls);
      }
    } else if (i === ns) {
      i += 1;
    }
  }
  return false;
}

/// Parse into {nodes: top-level node list, elements: flat element list}.
/// Node: {kind:'element'|'text'|'markup', start, end, element?}
/// Element: {outerStart,outerEnd,innerStart,innerEnd,tag,attrs:{as,ae},sealed}
export function tokenize(s) {
  const elements = [];
  const state = { pos: 0 }; // shared cursor — mirrors the Rust parser struct

  function parseChildrenImpl(until, depth) {
    const nodes = [];
    while (state.pos < s.length) {
      const start = state.pos;
      const b = s[state.pos];
      if (b === '<' && state.pos + 1 < s.length) {
        const n1 = s[state.pos + 1];
        if (n1 === '!' || n1 === '?') {
          let end;
          if (n1 === '!' && s.startsWith('<!--', state.pos)) {
            const off = s.indexOf('-->', state.pos + 4);
            end = off === -1 ? s.length : off + 3;
          } else {
            const gt = s.indexOf('>', state.pos);
            end = gt === -1 ? s.length : gt + 1;
          }
          state.pos = end;
          nodes.push({ kind: 'markup', start, end });
          continue;
        }
        if (n1 === '/') {
          const ns = state.pos + 2;
          let j = ns;
          while (j < s.length && isNameChar(s[j])) j += 1;
          if (until !== null) {
            if (eqCi(s.slice(ns, j), until)) return nodes; // caller consumes
            if (depth > 0) return nodes; // bubble unmatched to ancestor
          }
          let k = j;
          while (k < s.length && s[k] !== '>') k += 1;
          const end = k < s.length ? k + 1 : s.length;
          state.pos = end;
          nodes.push({ kind: 'markup', start, end });
          continue;
        }
        const open = scanOpenTag(s, state.pos);
        if (open) {
          const tag = s.slice(open.ns, open.ne).toLowerCase();
          state.pos = open.openEnd;
          const el = {
            outerStart: start, outerEnd: open.openEnd,
            innerStart: open.openEnd, innerEnd: open.openEnd,
            tag, as: open.as, ae: open.ae, sealed: true,
          };
          const idx = elements.length;
          elements.push(el);
          nodes.push({ kind: 'element', start, end: open.openEnd, element: idx });
          if (open.selfClose || VOID.has(tag) || depth >= MAX_DEPTH) {
            continue;
          }
          if (RAW_TEXT.has(tag)) {
            const close = findCloseTag(s, state.pos, tag);
            if (close) {
              el.innerEnd = close.start;
              el.outerEnd = close.end;
              state.pos = close.end;
            } else {
              el.innerEnd = s.length;
              el.outerEnd = s.length;
              el.sealed = false;
              state.pos = s.length;
            }
            nodes[nodes.length - 1].end = el.outerEnd;
            continue;
          }
          parseChildrenImpl(tag, depth + 1);
          if (
            state.pos < s.length && s[state.pos] === '<' &&
            state.pos + 1 < s.length && s[state.pos + 1] === '/'
          ) {
            const ns2 = state.pos + 2;
            let j = ns2;
            while (j < s.length && isNameChar(s[j])) j += 1;
            if (eqCi(s.slice(ns2, j), tag)) {
              let k = j;
              while (k < s.length && s[k] !== '>') k += 1;
              const ce = k < s.length ? k + 1 : s.length;
              el.innerEnd = state.pos;
              el.outerEnd = ce;
              state.pos = ce;
            } else {
              el.innerEnd = state.pos;
              el.outerEnd = state.pos;
              el.sealed = false;
            }
          } else {
            el.innerEnd = Math.min(state.pos, s.length);
            el.outerEnd = el.innerEnd;
            el.sealed = false;
          }
          nodes[nodes.length - 1].end = el.outerEnd;
          continue;
        }
      }
      // text run
      let i = state.pos;
      while (i < s.length) {
        if (
          s[i] === '<' && i + 1 < s.length &&
          (s[i + 1] === '!' || s[i + 1] === '/' || s[i + 1] === '?' || isNameStart(s[i + 1]))
        ) {
          break;
        }
        i += 1;
      }
      if (i === state.pos) i = state.pos + 1;
      state.pos = i;
      nodes.push({ kind: 'text', start, end: i });
    }
    return nodes;
  }

  const nodes = parseChildrenImpl(null, 0);
  return { nodes, elements };
}

function elIsFrontend(s, el) {
  if (hasClass(s, el, 'TH-render')) return true;
  if (el.tag === 'pre') {
    return isFrontend(textContent(s.slice(el.innerStart, el.innerEnd)));
  }
  return false;
}

function elContainsFrontend(s, el, elements) {
  for (const d of elements) {
    if (d.outerStart < el.innerStart || d.outerEnd > el.innerEnd || d.outerStart === el.outerStart) {
      continue;
    }
    if (d.tag === 'div' && hasClass(s, d, 'TH-render')) return true;
    if (d.tag === 'pre') {
      if (hasClass(s, d, 'TH-render')) return true;
      if (isFrontend(textContent(s.slice(d.innerStart, d.innerEnd)))) return true;
    }
  }
  return false;
}

export function preprocessStreamHtml(html) {
  const renamed = html.replaceAll('mes_text', 'TH-streaming');
  return renamed.replace(
    /<div class="TH-collapse-code-block-button">(?:显示|隐藏)(?:前端)?代码块<\/div>/g,
    '',
  );
}

/**
 * Fallback for wasm partition_message_html — same chunk shape:
 * {html, chunks:[{kind,sealed,html,code}]}
 * kinds: 0 normal 1 details 2 iframe 3 nested_iframe
 */
export function partitionMessageHtml(html) {
  const pp = preprocessStreamHtml(html);
  const { nodes, elements } = tokenize(pp);
  const chunks = [];
  const n = nodes.length;
  nodes.forEach((node, idx) => {
    let kind = 0;
    if (node.kind === 'element') {
      const el = elements[node.element];
      if (elIsFrontend(pp, el)) kind = 2;
      else if (elContainsFrontend(pp, el, elements)) kind = 3;
      else if (el.tag === 'details') kind = 1;
    }
    const nodeSealed = node.kind === 'element' ? elements[node.element].sealed : idx + 1 < n;
    if (kind === 0 && chunks.length && chunks[chunks.length - 1].kind === 0) {
      const last = chunks[chunks.length - 1];
      last.end = node.end;
      last.sealed = last.sealed && nodeSealed;
      return;
    }
    let code = '';
    if (kind === 2) {
      const el = elements[node.element];
      const innerPre =
        el.tag === 'pre'
          ? el
          : elements.find(
              d =>
                d.outerStart >= el.innerStart &&
                d.outerEnd <= el.innerEnd &&
                d.outerStart !== el.outerStart &&
                d.tag === 'pre' &&
                isFrontend(textContent(pp.slice(d.innerStart, d.innerEnd))),
            );
      if (innerPre) code = pp.slice(innerPre.innerStart, innerPre.innerEnd);
    }
    chunks.push({ kind, sealed: nodeSealed, start: node.start, end: node.end, code });
  });
  return {
    html: pp,
    chunks: chunks.map(c => ({ kind: c.kind, sealed: c.sealed, html: pp.slice(c.start, c.end), code: c.code })),
  };
}

/**
 * Fallback for wasm find_frontend_blocks:
 * returns [{outerStart,outerEnd,innerStart,innerEnd, code()}] — offsets in
 * UTF-16 string units here (JS fallback operates on strings, unlike the wasm
 * byte table; callers that slice strings should use this fallback's offsets).
 */
export function findFrontendBlocks(html) {
  const { elements } = tokenize(html);
  let ordinal = 0;
  const out = [];
  for (const el of elements) {
    if (el.tag !== 'pre') continue;
    const ord = ordinal++;
    if (isFrontend(textContent(html.slice(el.innerStart, el.innerEnd)))) {
      out.push({
        outerStart: el.outerStart,
        outerEnd: el.outerEnd,
        innerStart: el.innerStart,
        innerEnd: el.innerEnd,
        ordinal: ord,
        sealed: el.sealed,
        code: () => textContent(html.slice(el.innerStart, el.innerEnd)),
      });
    }
  }
  return out;
}

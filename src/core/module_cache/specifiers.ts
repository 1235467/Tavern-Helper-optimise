// specifiers.ts — light JS module specifier lexer + rewriter.
// Pure string work, DOM-free — vitest-runnable.
//
// scanModuleSpecifiers: string/comment/template-aware scan for
//   import ... from 'x' | import 'x' | import('x') | export ... from 'x'
// and import.meta.url occurrences. Captures the quoted literal ONLY.
// rewriteModule: replaces each cacheable specifier with its canonical
// absolute URL (blob: can't resolve relative specifiers — opaque scheme).

export type SpecKind = 'static' | 'export' | 'dynamic' | 'meta';

export interface Spec {
  /** byte offset of the specifier literal's opening quote (or the
   *  import.meta.url expression start for kind 'meta') */
  start: number;
  /** byte offset just past the closing quote (or expression end) */
  end: number;
  /** the specifier text as written (not present for 'meta') */
  spec?: string;
  kind: SpecKind;
}

const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
const isWord = (c: string) => /[0-9a-zA-Z_$]/.test(c);

/** skip whitespace and comments; returns new index */
function skipWs(code: string, i: number): number {
  for (;;) {
    while (i < code.length && isWs(code[i])) i++;
    if (code[i] === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
    } else if (code[i] === '/' && code[i + 1] === '*') {
      const e = code.indexOf('*/', i + 2);
      i = e === -1 ? code.length : e + 2;
    } else {
      return i;
    }
  }
}

function isQuote(c: string) {
  return c === "'" || c === '"' || c === '`';
}

/** read a word [a-zA-Z0-9_$]+ starting at i; returns [word, end] */
function readWord(code: string, i: number): [string, number] {
  let j = i;
  while (j < code.length && isWord(code[j])) j++;
  return [code.slice(i, j), j];
}

export function scanModuleSpecifiers(code: string): Spec[] {
  const specs: Spec[] = [];
  const len = code.length;
  let i = 0;

  const readString = (q: number): { text: string; end: number } | null => {
    // code[q] is the opening quote
    const quote = code[q];
    let j = q + 1;
    while (j < len) {
      const c = code[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === quote) {
        return { text: code.slice(q + 1, j), end: j + 1 };
      }
      if (quote !== '`' && c === '\n') {
        return null; // unterminated string — bail to normal
      }
      j++;
    }
    return null;
  };

  /** consume a template literal incl. ${…} nesting; returns end index */
  const skipTemplate = (q: number): number => {
    let j = q + 1;
    let depth = 0;
    while (j < len) {
      const c = code[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '`' && depth === 0) {
        return j + 1;
      }
      if (c === '$' && code[j + 1] === '{') {
        depth++;
      } else if (c === '}') {
        if (depth > 0) depth--;
      }
      j++;
    }
    return len;
  };

  const handleImport = (wordEnd: number) => {
    let j = skipWs(code, wordEnd);
    if (code[j] === '.') {
      // import.meta.url
      const [metaWord, metaEnd] = readWord(code, j + 1);
      if (metaWord === 'meta') {
        let k = skipWs(code, metaEnd);
        if (code[k] === '.') {
          k = skipWs(code, k + 1);
          const [w, e] = readWord(code, k);
          if (w === 'url') {
            specs.push({ start: i, end: e, kind: 'meta' });
            return e;
          }
        }
      }
      return -1;
    }
    if (code[j] === '(') {
      // dynamic import
      j = skipWs(code, j + 1);
      if (j < len && isQuote(code[j]) && code[j] !== '`') {
        const s = readString(j);
        if (s) {
          specs.push({ start: j, end: s.end, spec: s.text, kind: 'dynamic' });
          return s.end;
        }
      }
      return -1;
    }
    // static import: side-effect 'x' or clause … from 'x'
    if (j < len && isQuote(code[j]) && code[j] !== '`') {
      const s = readString(j);
      if (s) {
        specs.push({ start: j, end: s.end, spec: s.text, kind: 'static' });
        return s.end;
      }
    }
    // clause: scan forward for 'from' or quote (bounded ~2k chars)
    const limit = Math.min(j + 2048, len);
    let k = j;
    while (k < limit) {
      const c = code[k];
      if (c === "'" || c === '"' || c === '`') {
        const s = readString(k);
        if (s) {
          // check preceding word is 'from'
          const before = code.slice(j, k).match(/(\w+)\s*$/);
          if (before && before[1] === 'from') {
            specs.push({ start: k, end: s.end, spec: s.text, kind: 'static' });
            return s.end;
          }
          return -1; // a string before 'from' — not an import we handle
        }
        return -1;
      }
      if (c === '/' && (code[k + 1] === '/' || code[k + 1] === '*')) {
        k = skipWs(code, k);
        continue;
      }
      if (c === ';' || c === '\n') {
        return -1; // end of statement without 'from'
      }
      k++;
    }
    return -1;
  };

  const handleExport = (wordEnd: number) => {
    // scan for 'from' within statement
    let k = skipWs(code, wordEnd);
    const limit = Math.min(k + 2048, len);
    while (k < limit) {
      const c = code[k];
      if (c === "'" || c === '"' || c === '`') {
        const s = readString(k);
        if (s) {
          const before = code.slice(wordEnd, k).match(/(\w+)\s*$/);
          if (before && before[1] === 'from') {
            specs.push({ start: k, end: s.end, spec: s.text, kind: 'export' });
            return s.end;
          }
          return -1;
        }
        return -1;
      }
      if (c === '/' && (code[k + 1] === '/' || code[k + 1] === '*')) {
        k = skipWs(code, k);
        continue;
      }
      if (c === ';' || c === '\n') {
        return -1;
      }
      k++;
    }
    return -1;
  };

  while (i < len) {
    const c = code[i];
    if (c === "'" || c === '"') {
      const s = readString(i);
      i = s ? s.end : i + 1;
      continue;
    }
    if (c === '`') {
      i = skipTemplate(i);
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      while (i < len && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      const e = code.indexOf('*/', i + 2);
      i = e === -1 ? len : e + 2;
      continue;
    }
    if (/[a-zA-Z_$]/.test(c)) {
      const [word, wend] = readWord(code, i);
      if (word === 'import') {
        const next = handleImport(wend);
        i = next === -1 ? wend : next;
        continue;
      }
      if (word === 'export') {
        const next = handleExport(wend);
        i = next === -1 ? wend : next;
        continue;
      }
      i = wend;
      continue;
    }
    i++;
  }
  return specs;
}

/** canonicalize a specifier against its parent module's resolved URL */
export function resolveSpecifier(spec: string, parentUrl: string): string | null {
  if (/^https?:\/\//i.test(spec)) return spec;
  if (/^\/\//.test(spec)) {
    try {
      return new URL(spec, parentUrl).href;
    } catch {
      return null;
    }
  }
  if (spec.startsWith('/') || spec.startsWith('./') || spec.startsWith('../')) {
    try {
      return new URL(spec, parentUrl).href;
    } catch {
      return null;
    }
  }
  // bare specifier / data: / blob: / other schemes → not cacheable
  return null;
}

/** rewrite every cacheable specifier to its canonical absolute URL.
 *  deps = canonical URLs found (dedup'd, order of appearance). */
export function rewriteModule(
  code: string,
  parentResolvedUrl: string,
): { text: string; deps: string[] } {
  const specs = scanModuleSpecifiers(code);
  const deps: string[] = [];
  const seen = new Set<string>();
  let text = code;
  for (let i = specs.length - 1; i >= 0; i--) {
    const s = specs[i];
    if (s.kind === 'meta') {
      // import.meta.url → literal CDN URL (asset-relative lookups still work)
      text = text.slice(0, s.start) + JSON.stringify(parentResolvedUrl) + text.slice(s.end);
      continue;
    }
    const spec = s.spec!;
    const canonical = resolveSpecifier(spec, parentResolvedUrl);
    if (canonical === null) continue;
    if (!seen.has(canonical)) {
      seen.add(canonical);
      deps.unshift(canonical); // RTL splice order → unshift = document order
    }
    if (canonical !== spec) {
      const quote = text[s.start];
      text = text.slice(0, s.start) + quote + canonical + quote + text.slice(s.end);
    }
  }
  return { text, deps };
}

/** loose entry-point scan of user content — over-matching is fine
 *  (false positives only cost a prefetch). */
export function extractCdnImportUrls(content: string): string[] {
  const urls = new Set<string>();
  const re = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"](https?:\/\/[^'"]+)['"]|import\s*\(\s*['"](https?:\/\/[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    urls.add(m[1] ?? m[2]);
  }
  return [...urls];
}

/** schemes worth caching — only plain http(s) for now */
export function isCacheableScheme(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

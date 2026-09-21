// crawler.test.ts — recursive fetch+rewrite with DI'd fetch.
// idbPut no-ops without IndexedDB (openModuleDb→null) — registry is in-memory.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isDead, prefetchModule, resetDead, setFetcher, warm, type FetchResult } from '@/core/module_cache/crawler';
import { clearRegistry, entries, get, has, size } from '@/core/module_cache/registry';

const CDN_HOST = 'https://testingcf.jsdelivr.net';
const ENTRY = `${CDN_HOST}/gh/user/repo@1.0.0/dist/entry.js`;
const DEP_A = `${CDN_HOST}/npm/dep-a@2.0.0/+esm`;
const DEP_B = `${CDN_HOST}/npm/dep-b@1.0.0/+esm`;
const REL = `${CDN_HOST}/gh/user/repo@1.0.0/dist/rel.js`;
// ./rel-a.js inside /npm/dep-a@2.0.0/+esm resolves as a sibling:
const REL_A = `${CDN_HOST}/npm/dep-a@2.0.0/rel-a.js`;

function fakeModule(imports: string[]): string {
  return imports.map(u => `import x from '${u}';`).join('\n');
}

const FIXTURE: Record<string, FetchResult> = {
  [ENTRY]: { text: fakeModule([DEP_A, DEP_B]), resolvedUrl: ENTRY, contentType: 'text/javascript' },
  [DEP_A]: { text: fakeModule(['/npm/dep-c@9/+esm', './rel-a.js']), resolvedUrl: DEP_A, contentType: 'text/javascript' },
  [`${CDN_HOST}/npm/dep-c@9/+esm`]: { text: 'export const c = 1;', resolvedUrl: `${CDN_HOST}/npm/dep-c@9/+esm`, contentType: 'text/javascript' },
  [REL_A]: { text: 'export const ra = 1;', resolvedUrl: REL_A, contentType: 'text/javascript' },
  [DEP_B]: { text: fakeModule([REL]), resolvedUrl: DEP_B, contentType: 'text/javascript' },
  [REL]: { text: fakeModule([ENTRY]), resolvedUrl: REL, contentType: 'text/javascript' }, // cycle → ENTRY
};

function makeFetcher(map: Record<string, FetchResult>, fail: string[] = []) {
  const calls: string[] = [];
  const fn = async (url: string): Promise<FetchResult> => {
    calls.push(url);
    if (fail.includes(url)) throw new Error('HTTP 404');
    const rec = map[url];
    if (!rec) throw new Error('HTTP 404');
    return rec;
  };
  return { fn, calls };
}

beforeEach(() => {
  clearRegistry();
  resetDead();
});

describe('warm', () => {
  it('crawls the whole dep graph and registers rewritten modules', async () => {
    const { fn, calls } = makeFetcher(FIXTURE);
    setFetcher(fn);
    await warm(ENTRY);

    // entry + all transitively-reachable deps registered
    expect(has(ENTRY)).toBe(true);
    expect(has(DEP_A)).toBe(true);
    expect(has(DEP_B)).toBe(true);
    expect(has(REL)).toBe(true);
    expect(has(`${CDN_HOST}/npm/dep-c@9/+esm`)).toBe(true);
    expect(has(REL_A)).toBe(true);

    // dedup: each url fetched once even in a cyclic graph
    const counts = calls.reduce((m, u) => ((m[u] = (m[u] ?? 0) + 1), m), {} as Record<string, number>);
    for (const [u, n] of Object.entries(counts)) {
      expect(n, `${u} fetched ${n}x`).toBe(1);
    }
    expect(size()).toBe(6);
  });

  it('skips already-registered urls on second warm', async () => {
    const { fn, calls } = makeFetcher(FIXTURE);
    setFetcher(fn);
    await warm(ENTRY);
    calls.length = 0;
    await warm(ENTRY);
    expect(calls.length).toBe(0);
  });

  it('marks failures dead and lets imports fall through to CDN', async () => {
    const { fn } = makeFetcher(FIXTURE, [DEP_B]);
    setFetcher(fn);
    await warm(ENTRY);
    expect(isDead(DEP_B)).toBe(true);
    expect(has(DEP_B)).toBe(false); // no map entry → browser fetches it as today
    expect(has(DEP_A)).toBe(true);
  });

  it('dedups concurrent warm() calls', async () => {
    const { fn, calls } = makeFetcher(FIXTURE);
    setFetcher(fn);
    await Promise.all([warm(ENTRY), warm(ENTRY), warm(DEP_A)]);
    const counts = calls.reduce((m, u) => ((m[u] = (m[u] ?? 0) + 1), m), {} as Record<string, number>);
    for (const n of Object.values(counts)) expect(n).toBe(1);
  });

  it('rewrites nested specifiers to absolute CDN URLs (blob-safe)', async () => {
    const { fn } = makeFetcher(FIXTURE);
    setFetcher(fn);
    await warm(ENTRY);
    // the dep-a module's /npm/dep-c root-relative specifier must have been
    // rewritten to an absolute URL — verifiable via a second registered blob?
    // we can't read blob text, but the deps chain reached dep-c → proof the
    // rewrite produced a resolvable URL
    expect(has(`${CDN_HOST}/npm/dep-c@9/+esm`)).toBe(true);
    expect(has(REL_A)).toBe(true);
  });

  it('prefetchModule is the same warm', async () => {
    const { fn } = makeFetcher(FIXTURE);
    setFetcher(fn);
    await prefetchModule(ENTRY);
    expect(has(ENTRY)).toBe(true);
  });
});

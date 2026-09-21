// crawler.ts — recursive module fetch + rewrite + store.
// BFS over the dependency graph: fetch → rewriteModule (specifiers → absolute
// canonical URLs) → IDB put → registry blob → recurse deps.
// Dedup via inflight map + per-crawl visited set + session dead-set —
// cycles and parallel warm() calls are safe.

import { idbPut, type ModuleRecord } from './db';
import { has as registryHas, register } from './registry';
import { isCacheableScheme, rewriteModule } from './specifiers';

const inflight = new Map<string, Promise<void>>();
const dead = new Set<string>(); // session-negative cache — retries next session
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 15000;

export interface FetchResult {
  text: string;
  resolvedUrl: string;
  contentType: string;
  etag?: string;
  lastModified?: string;
}

export type Fetcher = (url: string) => Promise<FetchResult>;

const defaultFetcher: Fetcher = async url => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return {
      text: await res.text(),
      resolvedUrl: res.url,
      contentType: res.headers.get('content-type') ?? 'text/javascript',
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
    };
  } finally {
    clearTimeout(t);
  }
};

let fetcher: Fetcher = defaultFetcher;
export function setFetcher(f: Fetcher) {
  fetcher = f;
}

export function isDead(url: string): boolean {
  return dead.has(url);
}

export function resetDead() {
  dead.clear();
}

async function fetchOne(url: string): Promise<{ rec: ModuleRecord; deps: string[] } | null> {
  try {
    const { text, resolvedUrl, contentType, etag, lastModified } = await fetcher(url);
    const { text: rewritten, deps } = rewriteModule(text, resolvedUrl);
    const rec: ModuleRecord = {
      url,
      resolvedUrl,
      text: rewritten,
      contentType,
      bytes: rewritten.length,
      fetchedAt: Date.now(),
      etag,
      lastModified,
    };
    await idbPut(rec);
    register(url, rec);
    return { rec, deps };
  } catch {
    dead.add(url);
    return null;
  }
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) {
        await fn(queue.shift()!);
      }
    }),
  );
}

/**
 * warm(url) — ensure `url` and its whole dependency graph are cached.
 * Dedup'd: concurrent warm() on the same URL share the inflight task;
 * URLs already registered (fresh IDB preload or earlier crawl) skip entirely.
 */
export function warm(url: string, seen: Set<string> = new Set()): Promise<void> {
  if (!isCacheableScheme(url) || dead.has(url) || seen.has(url) || registryHas(url)) {
    return Promise.resolve();
  }
  const existing = inflight.get(url);
  if (existing) {
    return existing;
  }
  const task = (async () => {
    seen.add(url);
    const out = await fetchOne(url);
    if (!out) {
      return;
    }
    await pool(out.deps, CONCURRENCY, d => warm(d, seen));
  })();
  inflight.set(url, task);
  void task.finally(() => inflight.delete(url));
  return task;
}

export { warm as prefetchModule };

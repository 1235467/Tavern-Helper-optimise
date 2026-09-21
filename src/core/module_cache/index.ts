// index.ts — module cache facade.
// initModuleCache(): preload IndexedDB records into the session registry
// (blob URLs minted lazily per URL), expose the mount-gate promise and
// warmContent() for kicking crawls from script content.

import { env } from '@/core/env';
import { warm } from './crawler';
import { idbGetAll } from './db';
import { register, revokeAll } from './registry';
import { extractCdnImportUrls } from './specifiers';

const GATE_MS = 1500;
let preloadDone: Promise<void> | null = null;
let gateResolve: () => void = () => {};

/** resolves when the mount gate settles — scripts mount after this */
export const gatePromise: Promise<void> = new Promise(res => {
  gateResolve = res;
});

function timeout<T>(ms: number, v: T): Promise<T> {
  return new Promise(res => setTimeout(() => res(v), ms));
}

/** preload persisted records → session registry */
async function preloadRegistry(): Promise<void> {
  const records = await idbGetAll();
  for (const rec of records) {
    register(rec.url, rec);
  }
}

export async function initModuleCache(): Promise<void> {
  if (!preloadDone) {
    preloadDone = (async () => {
      if (!env().module_cache) {
        return;
      }
      await preloadRegistry().catch(() => {});
    })();
  }
  await preloadDone;
}

/**
 * Kick a crawl for every CDN URL discoverable in `content` (script source).
 * Returns a promise settling when the whole crawl finishes (or each entry
 * fails/falls back). Fire-and-forget callers may ignore it.
 */
export function warmContent(content: string): Promise<void> {
  if (!env().module_cache) {
    return Promise.resolve();
  }
  const urls = extractCdnImportUrls(content);
  return Promise.all(urls.map(u => warm(u))).then(() => undefined);
}

/**
 * The mount gate: wait for preload + the given entry URLs' crawls, bounded.
 * Callers gate iframe mounting on this — one dedup'd crawl vs N waterfalls.
 */
export async function gateForEntries(urls: string[]): Promise<void> {
  if (!env().module_cache) {
    return;
  }
  await Promise.race([
    Promise.all([initModuleCache(), ...urls.map(u => warm(u))]),
    timeout(GATE_MS, undefined),
  ]);
  gateResolve();
}

/** explicit refresh — re-crawl even if registered (fetch may 304 cheaply) */
export { warm };

export { revokeAll };

// --- TavernHelper API surface (additive) ---------------------------------

import { idbClear, idbDelete } from './db';
import {
  clearRegistry,
  entries as registryEntries,
  unregister,
} from './registry';
import { warm as warmUrl } from './crawler';

export function moduleCacheEntries() {
  return registryEntries().map(([url, e]) => ({
    url,
    contentType: e.contentType,
    bytes: e.bytes,
    fetchedAt: e.fetchedAt,
  }));
}

export async function moduleCacheRefresh(url: string) {
  unregister(url);
  await idbDelete(url);
  await warmUrl(url);
}

export async function moduleCacheClear() {
  clearRegistry();
  await idbClear();
}

export { prefetchModule } from './crawler';

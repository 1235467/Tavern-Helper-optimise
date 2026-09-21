// registry.ts — session registry: canonical CDN URL → blob URL.
// Plain (non-reactive) Map: Vue computeds must NOT re-run when the cache
// fills (that would reload every mounted iframe).
//
// The importmap in each srcdoc maps absolute CDN URL → session blob URL.
// One blob per URL shared across all same-origin iframes; revoked on pagehide.

import { env } from '@/core/env';
import type { ModuleRecord } from './db';

interface RegistryEntry {
  blob: string;
  contentType: string;
  bytes: number;
  fetchedAt: number;
}

const registry = new Map<string, RegistryEntry>();

/** UI hook — the pinia facade subscribes here to bump its version tick */
let onRegisterCb: (url: string) => void = () => {};
export function setOnRegister(cb: (url: string) => void) {
  onRegisterCb = cb;
}

function mintBlob(text: string, contentType: string): string {
  return URL.createObjectURL(new Blob([text], { type: contentType || 'text/javascript' }));
}

/** register a fetched record → blob url (idempotent per URL) */
export function register(url: string, rec: { text: string; contentType: string; bytes?: number; fetchedAt?: number }): string {
  const existing = registry.get(url);
  if (existing) return existing.blob;
  const blob = mintBlob(rec.text, rec.contentType);
  registry.set(url, {
    blob,
    contentType: rec.contentType,
    bytes: rec.bytes ?? rec.text.length,
    fetchedAt: rec.fetchedAt ?? Date.now(),
  });
  try {
    onRegisterCb(url);
  } catch {
    // UI callback must never break caching
  }
  return blob;
}

export function has(url: string): boolean {
  return registry.has(url);
}

export function get(url: string): string | undefined {
  return registry.get(url)?.blob;
}

export function entries(): [string, RegistryEntry][] {
  return [...registry.entries()];
}

export function size(): number {
  return registry.size;
}

export function totalBytes(): number {
  let n = 0;
  for (const e of registry.values()) n += e.bytes;
  return n;
}

export function unregister(url: string) {
  registry.delete(url);
}

export function clearRegistry() {
  registry.clear();
}

export function revokeAll() {
  for (const e of registry.values()) {
    URL.revokeObjectURL(e.blob);
  }
  registry.clear();
}

/**
 * The `<script type="importmap">` tag for a srcdoc — maps every ready cached
 * absolute CDN URL to its session blob URL. Empty string when the feature is
 * off or nothing's cached yet (progressive enhancement: CDN still works).
 */
export function importmapTag(): string {
  if (!env().module_cache || registry.size === 0) {
    return '';
  }
  const imports: Record<string, string> = {};
  for (const [url, e] of registry) {
    imports[url] = e.blob;
  }
  // keys/values are https:/blob: URLs — JSON.stringify is safe (no '<' risk)
  return `<script type="importmap">${JSON.stringify({ imports })}</script>`;
}

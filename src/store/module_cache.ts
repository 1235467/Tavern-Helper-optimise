// store/module_cache.ts — pinia facade over the non-reactive registry.
// The registry itself stays plain (fill-in must not re-render iframes);
// this store exposes a throttled `version` tick for the management UI.

import { warm } from '@/core/module_cache/crawler';
import { idbClear, idbDelete } from '@/core/module_cache/db';
import {
  clearRegistry,
  entries as registryEntries,
  setOnRegister,
  totalBytes,
  unregister,
} from '@/core/module_cache/registry';
import { extractCdnImportUrls } from '@/core/module_cache/specifiers';
import { useScriptIframeRuntimesStore } from '@/store/iframe_runtimes';

export interface CacheEntry {
  url: string;
  contentType: string;
  bytes: number;
  fetchedAt: number;
}

export const useModuleCacheStore = defineStore('module_cache', () => {
  const version = ref(0);
  const bump = _.debounce(() => version.value++, 200);
  // the crawler calls register() per stored module — bump the UI tick
  setOnRegister(() => bump());

  const entries = computed<CacheEntry[]>(() => {
    void version.value;
    return registryEntries()
      .map(([url, e]) => ({
        url,
        contentType: e.contentType,
        bytes: e.bytes,
        fetchedAt: e.fetchedAt,
      }))
      .sort((a, b) => a.url.localeCompare(b.url));
  });

  const total = computed(() => {
    void version.value;
    return totalBytes();
  });

  /** register a UI-visible version bump when the crawler stores a record */
  const onStore = () => bump();

  /** warm all entry URLs discoverable in enabled scripts' content */
  const warmEnabledScripts = () => {
    for (const { script } of useScriptIframeRuntimesStore().enabled_scripts) {
      for (const url of extractCdnImportUrls(script.content)) {
        void warm(url).then(onStore);
      }
    }
  };

  const refresh = async (url: string) => {
    unregister(url);
    await idbDelete(url);
    await warm(url);
    bump();
  };

  const refreshAll = async () => {
    const urls = entries.value.map(e => e.url);
    await Promise.all(urls.map(u => refresh(u)));
  };

  const clear = async () => {
    clearRegistry();
    await idbClear();
    bump();
  };

  const remove = async (url: string) => {
    unregister(url);
    await idbDelete(url);
    bump();
  };

  return { version, entries, total, warmEnabledScripts, refresh, refreshAll, clear, remove };
});

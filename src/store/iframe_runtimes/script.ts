import { env } from '@/core/env';
import { gateForEntries } from '@/core/module_cache';
import { extractCdnImportUrls } from '@/core/module_cache/specifiers';
import { useCharacterScriptsStore, useGlobalScriptsStore, usePresetScriptsStore } from '@/store/scripts';
import { useGlobalSettingsStore } from '@/store/settings';
import { Script } from '@/type/scripts';
import { getStringHash, uuidv4 } from '@sillytavern/scripts/utils';

export function getButtonId(script_id: string, button_name: string): string {
  return `${script_id}_${getStringHash(button_name)}`;
}

export const useScriptIframeRuntimesStore = defineStore('script_iframe_runtimes', () => {
  const global_settings = useGlobalSettingsStore();

  const global_scripts = useGlobalScriptsStore();
  const preset_scripts = usePresetScriptsStore();
  const character_scripts = useCharacterScriptsStore();

  const reload_memos = ref<{ [id: string]: string }>({});
  const reload = (id: string) => {
    _.set(reload_memos.value, id, uuidv4());
  };
  const reloadAll = () => {
    const reload_memo = uuidv4();
    reload_memos.value = Object.fromEntries(runtimes.value.map(runtime => [runtime.id, reload_memo]));
  };

  const enabled_scripts_with_source = computed(() => {
    return global_settings.app_ready
      ? _([global_scripts, preset_scripts, character_scripts])
          .flatMap(store => store.enabled_scripts.map(script => ({ source: store.source, script })))
          .value()
      : [];
  });

  // module-cache mount gate: kick the dedup'd crawl for all CDN URLs in
  // enabled scripts, and defer iframe mounting until the ~1.5s gate
  // resolves — one crawl vs N per-iframe waterfalls
  const module_gate_ready = ref(!env().module_cache);
  watch(
    () => enabled_scripts_with_source.value.map(i => i.script.content),
    contents => {
      const urls = _(contents).flatMap(c => extractCdnImportUrls(c)).uniq().value();
      module_gate_ready.value = !env().module_cache || urls.length === 0;
      if (!module_gate_ready.value) {
        void gateForEntries(urls).finally(() => {
          module_gate_ready.value = true;
        });
      }
    },
    { immediate: true },
  );

  const runtimes = computed(() => {
    if (env().module_cache && !module_gate_ready.value) {
      return []; // gate: defer mounts until the dedup'd crawl settles
    }
    return _(enabled_scripts_with_source.value)
      .map(item => ({
        id: item.script.id,
        name: item.script.name,
        source: unref(item.source),
        content: item.script.content,
        reload_memo: _.get(reload_memos.value, item.script.id, ''),
      }))
      .sortBy(script => script.id)
      .value();
  });

  const button_map = computed<{ [script_id: string]: { button_id: string; button_name: string }[] }>(() => {
    return _(enabled_scripts_with_source.value)
      .filter(item => item.script.button.enabled && item.script.button.buttons.some(button => button.visible))
      .map(item => [
        item.script.id,
        item.script.button.buttons
          .filter(button => button.visible)
          .map(button => ({
            button_id: getButtonId(item.script.id, button.name),
            button_name: button.name,
          })),
      ])
      .fromPairs()
      .value();
  });

  const get = (script_id: string): Script | undefined => {
    return enabled_scripts_with_source.value.find(item => item.script.id === script_id)?.script;
  };

  return {
    reload_memos: readonly(reload_memos),
    enabled_scripts: enabled_scripts_with_source,
    runtimes,
    button_map,
    get,
    reload,
    reloadAll,
  };
});

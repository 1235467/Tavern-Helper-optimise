import { createDirtyFlush } from '@/core/persistence';
import { collectExportSummaryItems, showExportSummaryToast } from '@/panel/script/export_by';
import { flattenScriptTree, ScriptTree } from '@/type/scripts';
import { PresetSettings, setting_field } from '@/type/settings';
import { preset_manager } from '@/util/tavern';
import { event_types, eventSource, saveSettingsDebounced } from '@sillytavern/script';
import { oai_settings } from '@sillytavern/scripts/openai';

function getSettings(id: string): PresetSettings {
  const settings = _.get(preset_manager.getPresetList().presets[Number(id)], `extensions.${setting_field}`, {});
  const parsed = PresetSettings.safeParse(settings);
  if (!parsed.success) {
    toastr.warning(parsed.error.message, t`[酒馆助手]读取预设数据失败, 将使用空数据`);
    return PresetSettings.parse({});
  }
  return PresetSettings.parse(parsed.data);
}

function saveSettingsToMemoryDebounced(id: string, name: string, settings: PresetSettings) {
  if (id === preset_manager.getSelectedPreset() && name === preset_manager.getSelectedPresetName()) {
    _.set(oai_settings, `extensions.${setting_field}`, settings);
    saveSettingsDebounced();
  }
}

async function saveSettingsToFile(_id: string, name: string, settings: PresetSettings) {
  const preset_list = preset_manager.getPresetList();
  const index = _.get(preset_list.preset_names, name, -1);
  if (index === -1) {
    return;
  }

  const preset = preset_list.presets[index];
  _.set(preset, `extensions.${setting_field}`, settings);
  await preset_manager.savePreset(name, preset, { skipUpdate: true });
}
const saveSettingsToFileDebounced = _.debounce(saveSettingsToFile, 1000);

export const usePresetSettingsStore = defineStore('preset_settings', () => {
  const id = ref<string>(preset_manager.getSelectedPreset());
  const name = ref<string>(preset_manager.getSelectedPresetName());

  const settings = ref<PresetSettings>(getSettings(id.value));

  // 在某预设内修改 settings 时保存 — dirty-tracked: one flush per burst
  // (each saver still gets its own klona — memory and file must not share
  // the object, exactly like the original two separate klona calls)
  const dirty = createDirtyFlush(() => {
    saveSettingsToMemoryDebounced(id.value, name.value, klona(settings.value));
    saveSettingsToFileDebounced(id.value, name.value, klona(settings.value));
  }, 250);

  // 切换预设时刷新 id 和 settings — flush pending writes to the OLD preset
  // inside the SAME handler, before id/name move
  eventSource.makeFirst(event_types.OAI_PRESET_CHANGED_AFTER, async () => {
    await dirty.flushNow();
    const new_id = String(preset_manager.getSelectedPreset());
    const new_name = String(preset_manager.getSelectedPresetName());
    if (name.value !== new_name) {
      id.value = new_id;
      name.value = new_name;
    }
  });
  watch([id, name], ([new_id]) => {
    ignoreUpdates(() => {
      settings.value = getSettings(new_id);
    });
  });

  // 导出预设前清理预设脚本变量 — pause the dirty queue through the export
  // window so a late flush can't overwrite the scrubbed preset object
  eventSource.on(event_types.OAI_PRESET_EXPORT_READY, (preset: any) => {
    dirty.pause();
    setTimeout(() => dirty.resume(false), 5000);
    const script_trees = _.get(preset, `extensions.${setting_field}.scripts`, []) as ScriptTree[];
    const original_script_trees = klona(script_trees);
    script_trees.flatMap(flattenScriptTree).forEach(script => {
      if (!script.export_with.data) {
        script.data = {};
      }
      if (!script.export_with.button) {
        script.button.buttons = [];
      }
    });
    showExportSummaryToast(t`预设`, collectExportSummaryItems(original_script_trees, script_trees));
  });

  const { ignoreUpdates } = watchIgnorable(
    settings,
    () => {
      dirty.mark();
    },
    { deep: true },
  );

  // 监听 id 不能正确反映导入新预设时的情况, 在外应该监听 name
  return { id: readonly(id), name: readonly(name), settings };
});

import { createDirtyFlush } from '@/core/persistence';
import { collectExportSummaryItems, ScriptExportSummaryItem, showExportSummaryToast } from '@/panel/script/export_by';
import { CharacterSettings as BackwardCharacterSettings } from '@/type/backward';
import { flattenScriptTree } from '@/type/scripts';
import { CharacterSettings, setting_field } from '@/type/settings';
import { fromCharacterBook, updateWorldInfoList } from '@/util/compatibility';
import { writeExtensionField } from '@/util/tavern';
import { characters, event_types, eventSource, this_chid, unshallowCharacter } from '@sillytavern/script';
import { loadWorldInfo, saveWorldInfo } from '@sillytavern/scripts/world-info';

function getSettings(id: string | undefined): CharacterSettings {
  const character = characters.at(id as unknown as number);
  if (character === undefined) {
    return CharacterSettings.parse({});
  }

  const backward_scripts = _.get(character, `data.extensions.TavernHelper_scripts`);
  const backward_variables = _.get(character, `data.extensions.TavernHelper_characterScriptVariables`);
  if (backward_scripts !== undefined || backward_variables !== undefined) {
    if (!_.has(character, `data.extensions.${setting_field}`)) {
      const parsed = BackwardCharacterSettings.safeParse({
        scripts: backward_scripts ?? [],
        variables: backward_variables ?? {},
      } satisfies z.infer<typeof BackwardCharacterSettings>);
      if (parsed.success) {
        saveSettings(id as string, characters[id as unknown as number]?.name as string, parsed.data);
      } else {
        toastr.warning(parsed.error.message, t`[酒馆助手]迁移旧数据失败, 将使用空数据`);
      }
    }
    writeExtensionField(id, 'TavernHelper_scripts', undefined);
    writeExtensionField(id, 'TavernHelper_characterScriptVariables', undefined);
  }

  const settings = _.get(character, `data.extensions.${setting_field}`);
  const parsed = CharacterSettings.safeParse(
    settings !== undefined ? (_.isArray(settings) ? Object.fromEntries(settings) : settings) : {},
  );
  if (!parsed.success) {
    toastr.warning(parsed.error.message, t`[酒馆助手]读取角色卡数据失败, 将使用空数据`);
    return CharacterSettings.parse({});
  }
  // `scripts`/`variables` 上的 .catch 会把不兼容数据静默换成空值——读出来是空
  // 不代表卡里真是空. 显式告警, 否则这个空壳会被后续任意写盘落进卡里.
  if (Array.isArray(settings?.scripts) && settings.scripts.length > 0 && parsed.data.scripts.length === 0) {
    console.error('[TavernHelper] scripts dropped by schema catch:', settings.scripts);
    toastr.error(t`角色卡脚本数据无法解析(已保留卡内原数据, 详情见控制台)`, t`[酒馆助手]数据保护`);
  }
  return CharacterSettings.parse(parsed.data);
}

async function saveSettings(id: string, name: string, settings: CharacterSettings, affect_memory: boolean = true) {
  if (name === characters[id as unknown as number]?.name) {
    await writeExtensionField(id, setting_field, settings, affect_memory);
  }
}

export const useCharacterSettingsStore = defineStore('character_setttings', () => {
  const id = ref<string | undefined>(this_chid);
  const name = ref<string | undefined>(characters?.[this_chid as unknown as number]?.name);

  const settings = ref<CharacterSettings>(getSettings(id.value));

  // dirty-tracking: a burst of leaf writes (e.g. per-message variable churn)
  // → ONE klona + one whole-character POST per window instead of per write.
  // The comment below still applies: ST reads character data often, so the
  // window stays short (250ms).
  const dirty = createDirtyFlush(async () => {
    if (id.value !== undefined && name.value !== undefined) {
      await saveSettings(id.value, name.value, klona(settings.value));
    }
  }, 250);

  // 切换角色卡时刷新 id — flush pending writes under the OLD id first,
  // otherwise they'd be lost or (worse) written into the new character
  eventSource.makeFirst(event_types.CHAT_CHANGED, async () => {
    await dirty.flushNow();
    const new_name = characters?.[this_chid as unknown as number]?.name;
    if (id.value !== this_chid || name.value !== new_name) {
      id.value = this_chid;
      name.value = new_name;
    }
  });

  // 切换角色卡时刷新 settings, 但不触发 settings 保存.
  // shallow 角色的 extensions 只有 {fav,world}, 直接读会得到空壳——
  // 先 unshallow 再读, 否则空壳会被后续写盘落进卡里.
  watch([id, name], async ([new_id]) => {
    if (new_id !== undefined) {
      await unshallowCharacter(String(new_id));
    }
    ignoreUpdates(() => {
      settings.value = getSettings(new_id);
    });
  });

  // 替换/更新角色卡时也刷新 settings, 但不触发 settings 保存
  $('#character_replace_file').on('click', () => {
    eventSource.once(event_types.CHAT_CHANGED, () => {
      ignoreUpdates(async () => {
        const current_id = id.value;
        settings.value = getSettings(current_id);

        // 并且替换世界书
        if ($('#world_button').hasClass('world_set')) {
          const book = characters[Number(current_id)]?.data?.character_book;
          if (book) {
            const book_name = book.name || `${characters[Number(current_id)]?.name}'s Lorebook`;
            await saveWorldInfo(book_name, fromCharacterBook(book), true);
            await updateWorldInfoList();
            $('#character_world').val(book_name).trigger('change');
          }
        }
      });
    });
  });

  // 导出角色卡前保存最新世界书
  $('#export_button').on('click', async () => {
    const book_name = $('#character_world').val() as string;
    if (book_name) {
      await saveWorldInfo(book_name, await loadWorldInfo(book_name), true);
    }
  });

  // 导出角色卡前清理角色卡脚本变量
  {
    let scripts_summary: ScriptExportSummaryItem[] = [];
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const [url] = args;
      const response = await originalFetch.apply(this, args);
      if (typeof url === 'string' && url === '/api/characters/export') {
        eventSource.emit('character_export_ready', { scripts_summary });
        scripts_summary = [];
      }
      return response;
    };
    $('#export_button').on('click', async () => {
      if (id.value !== undefined && name.value !== undefined) {
        // land pending dirty writes BEFORE the cleared-settings write, then
        // hold the queue through the export window so a late flush can't
        // overwrite the scrubbed settings the export reads
        await dirty.flushNow();
        dirty.pause();
        const cleared_settings = klona(settings.value);
        cleared_settings.scripts.flatMap(flattenScriptTree).forEach(script => {
          if (!script.export_with.data) {
            script.data = {};
          }
          if (!script.export_with.button) {
            script.button.buttons = [];
          }
        });
        scripts_summary = collectExportSummaryItems(settings.value.scripts, cleared_settings.scripts);

        await saveSettings(id.value, name.value, cleared_settings, false);

        const timeout_id = setTimeout(async () => {
          if (id.value !== undefined && name.value !== undefined) {
            await saveSettings(id.value, name.value, klona(settings.value), false);
            dirty.resume(false); // restore already wrote current state
            scripts_summary = [];
          }
        }, 10000);
        eventSource.once('character_export_ready', () => {
          clearTimeout(timeout_id);
        });
      }
    });
    eventSource.on(
      'character_export_ready',
      async ({ scripts_summary }: { scripts_summary: ScriptExportSummaryItem[] }) => {
        if (id.value !== undefined && name.value !== undefined) {
          await saveSettings(id.value, name.value, klona(settings.value), false);
          dirty.resume(false); // restore already wrote current state
          showExportSummaryToast(t`角色卡`, scripts_summary);
        }
      },
    );
  }

  // 在某角色卡内修改 settings 时保存 — dirty-tracked flush (see above)
  const { ignoreUpdates } = watchIgnorable(
    settings,
    () => {
      dirty.mark();
    },
    { deep: true },
  );

  // 首次读取时角色可能是 shallow 存根 — unshallow 后用真实数据刷新一次,
  // 否则 settings 里是空壳, 任何写盘都会扬掉卡内脚本.
  if (id.value !== undefined) {
    void unshallowCharacter(String(id.value)).then(() => {
      ignoreUpdates(() => {
        settings.value = getSettings(id.value);
      });
    });
  }

  const forceReload = async () => {
    if (id.value !== undefined) {
      await unshallowCharacter(String(id.value));
    }
    ignoreUpdates(() => {
      if (id.value !== undefined && name.value !== undefined) {
        settings.value = getSettings(id.value);
      }
    });
  };

  // 在外应同时监听 id 和 name: 同名角色卡的 id 不同, 导入角色卡时 id 也可能不变
  return {
    id: readonly(id),
    name: readonly(name),
    settings,
    forceReload,
  };
});

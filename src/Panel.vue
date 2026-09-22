<template>
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>{{ t`酒馆助手` }}</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
    </div>
    <div class="inline-drawer-content TH-custom-tailwind">
      <div class="flex flex-col gap-0.5">
        <div class="flex items-center justify-between th-text-xs text-(--grey50)">
          <span>{{ t`Ver ${current_version}` }}</span>
          <div class="flex cursor-pointer items-center justify-end gap-0.25 leading-[1.5]" @click="openInfoModal">
            <i class="fa-solid fa-circle-info text-[calc(var(--mainFontSize)*0.7)]" :title="t`扩展信息`"></i>
            <span>{{ t`扩展信息` }}</span>
          </div>
        </div>
        <!-- 顶部导航栏 -->
        <!-- prettier-ignore-attribute -->
        <div
          class="
            flex w-full items-center rounded-md border border-x-2 border-(--grey5050a) border-x-(--SmartThemeQuoteColor)
            p-0.5
          "
        >
          <div
            v-for="{ key, name, icon } in tabs"
            :key="key"
            class="flex h-full flex-1 cursor-pointer items-center justify-center rounded-sm text-(--grey50)"
            :class="{
              'bg-[color-mix(in_srgb,var(--SmartThemeQuoteColor)_80%,transparent)] transition duration-300 ease-in-out':
                active_tab === key,
            }"
            @click="active_tab = key"
          >
            <div
              class="flex items-center justify-center gap-[3px] leading-[1.5]"
              :style="{
                color:
                  active_tab === key
                    ? getSmartThemeQuoteTextColor()
                    : key === 'developer'
                      ? developIconColor
                      : undefined,
              }"
            >
              <i class="th-text-xs" :class="icon"></i>
              <span class="text-center">{{ name }}</span>
            </div>
          </div>
        </div>
        <!-- 内容区 -->
        <div class="min-w-0">
          <template v-for="{ key, component } in tabs" :key="key">
            <div v-show="active_tab === key" class="flex flex-col gap-0.25">
              <component :is="component" />
            </div>
          </template>
        </div>
      </div>
    </div>
    <ModalsContainer />
  </div>
</template>

<script setup lang="ts">
import { getTavernHelperVersion } from '@/function/version';
import { useValidatedTab } from '@/panel/composable/use_validated_tab';
import Developer from '@/panel/Developer.vue';
import { listenerConnected } from '@/panel/developer/listener';
import Info from '@/panel/Info.vue';
import Optimize from '@/panel/Optimize.vue';
import Render from '@/panel/Render.vue';
import Script from '@/panel/Script.vue';
import Toolbox from '@/panel/Toolbox.vue';
import { useGlobalSettingsStore } from '@/store/settings';
import { getSmartThemeQuoteTextColor } from '@/util/color';
import { ModalsContainer } from 'vue-final-modal';

const current_version = getTavernHelperVersion();

// 暴露 Vue 从而让 vue devtool 能正确识别
useScriptTag('https://testingcf.jsdelivr.net/npm/vue/dist/vue.runtime.global.prod.min.js');

const tabs = [
  { key: 'render', name: t`渲染`, icon: 'fa-solid fa-magic-wand-sparkles', component: Render },
  { key: 'script', name: t`脚本`, icon: 'fa-solid fa-dice-d6', component: Script },
  { key: 'toolbox', name: t`工具`, icon: 'fa-solid fa-toolbox', component: Toolbox },
  { key: 'optimize', name: t`优化`, icon: 'fa-solid fa-circle-nodes', component: Optimize },
  { key: 'developer', name: t`开发`, icon: 'fa-solid fa-tools', component: Developer },
] as const;
const active_tab = useValidatedTab('TH-Panel:active_tab', 'render', () => tabs.map(t => t.key));

const listenerEnabled = computed(() => useGlobalSettingsStore().settings.listener.enabled);
/** 开发工具图标颜色：启用监听但未连接时红色，已连接时绿色 */
const developIconColor = computed(() => {
  if (!listenerEnabled.value) return undefined;
  return listenerConnected.value ? 'green' : 'rgb(170, 0, 0)';
});

const { open: openInfoModal } = useModal({
  component: Info,
});
</script>

<template>
  <VueFinalModal
    v-model="visible"
    class="TH-popup TH-custom-tailwind absolute! flex h-full w-full items-center justify-center"
    :teleport-to="'body'"
    :z-index-fn="() => 10000"
    :hide-overlay="true"
  >
    <div class="popup box-border flex max-h-[80vh] w-[560px]! max-w-[95vw]! flex-col px-1.5!">
      <div class="mb-1 flex items-center justify-between">
        <h3 class="m-0 text-base!">{{ t`模块缓存` }}</h3>
        <span class="text-xs opacity-70">{{ entries.length }} 个模块 · {{ formatBytes(total) }}</span>
      </div>
      <p class="my-0.5 text-xs opacity-80">
        {{ t`缓存的 CDN 模块以本地 blob 供 iframe import 使用；版本固定的内容永久缓存，分支/latest 类 URL 可手动刷新。` }}
      </p>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div
          v-for="e in entries"
          :key="e.url"
          class="my-0.5 flex items-center gap-1 rounded border border-solid border-transparent px-0.5 py-0.5 text-xs hover:border-gray-400"
        >
          <span class="min-w-0 flex-1 break-all opacity-80" :title="e.url">{{ e.url }}</span>
          <span class="shrink-0 opacity-60">{{ formatBytes(e.bytes) }}</span>
          <button class="menu_button interactable !px-1 text-xs" @click="refresh(e.url)" :title="t`重新抓取`">↻</button>
          <button class="menu_button interactable !px-1 text-xs" @click="remove(e.url)" :title="t`删除`">✕</button>
        </div>
        <div v-if="entries.length === 0" class="py-4 text-center text-xs opacity-60">
          {{ t`暂无缓存模块 — 启用脚本的 CDN import 被抓取后会出现在这里` }}
        </div>
      </div>
      <div class="my-0.5 mt-1 flex items-center justify-center gap-[16px]">
        <button class="menu_button interactable" @click="refreshAll">{{ t`全部刷新` }}</button>
        <button class="menu_button interactable" @click="clearAll">{{ t`清空缓存` }}</button>
        <button class="menu_button interactable" @click="close">{{ t`关闭` }}</button>
      </div>
    </div>
  </VueFinalModal>
</template>

<script setup lang="ts">
import { useModuleCacheStore } from '@/store/module_cache';
import { VueFinalModal } from 'vue-final-modal';

const visible = defineModel<boolean>({ default: false });
const store = useModuleCacheStore();
const { entries, total, refresh, refreshAll, clear, remove } = store;

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

async function clearAll() {
  await clear();
}
function close() {
  visible.value = false;
}
</script>

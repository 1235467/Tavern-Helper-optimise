import { createScriptSrcdoc } from '@/core/srcdoc';

// 由于 vue 内使用 `</script>` 存在 bug, 不得不分开写
// (tavern-helper-ng: delegates to createScriptSrcdoc — env libs come from the
// bundled th-env.js instead of CDN)
export function createSrcContent(content: string, use_blob_url: boolean, use_cleanup_protector: boolean) {
  return createScriptSrcdoc(content, use_blob_url, use_cleanup_protector);
}

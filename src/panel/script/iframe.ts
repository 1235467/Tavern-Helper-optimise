import { createScriptSrcdoc } from '@/core/srcdoc';
import { warmContent } from '@/core/module_cache';

// 由于 vue 内使用 `</script>` 存在 bug, 不得不分开写
// (tavern-helper-ng: delegates to createScriptSrcdoc — env libs come from the
// bundled th-env.js instead of CDN, and the module-cache importmap is injected)
export function createSrcContent(content: string, use_blob_url: boolean, use_cleanup_protector: boolean) {
  void warmContent(content); // kick the module-cache crawl (fire-and-forget)
  return createScriptSrcdoc(content, use_blob_url, use_cleanup_protector);
}

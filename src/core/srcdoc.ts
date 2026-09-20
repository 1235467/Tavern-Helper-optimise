// srcdoc assembly — port of createSrcContent (src/panel/render/iframe.ts:78
// and src/panel/script/iframe.ts:5), with two changes:
//  1. `env_source:'local'` (default) replaces the ~7-URL jsdelivr waterfall
//     with one bundled lib/th-env.js + th-env.css served from the extension
//     dir; 'cdn' reproduces the original third_party_*.html byte-for-byte.
//  2. log.js is bundled as a blob URL by default (was a CDN fetch per iframe).
// The `--TH-viewport-height` rewrite goes through `engine.rewriteSrcdoc`
// (WASM or the verbatim regex fallback).

import {
  adjust_iframe_height_url,
  adjust_viewport_url,
  cleanup_protector_url,
  LOG_CDN_URL,
  log_url,
  parent_jquery_url,
  predefine_url,
  stream_applier_url,
} from '@/iframe/script_url';
import third_party_message from '@/iframe/third_party_message.html?raw';
import third_party_script from '@/iframe/third_party_script.html?raw';
import { engine } from '@/wasm/loader';
import { env } from '@/core/env';
import { getCharAvatarPath, getUserAvatarPath } from '@/util/tavern';

/** extension dir name — kept identical for drop-in script compatibility */
export const EXTENSION_DIR = 'JS-Slash-Runner';
const LIB_BASE = `/scripts/extensions/third-party/${EXTENSION_DIR}/lib`;

/** third-party block for message iframes: local bundle or verbatim CDN html */
function thirdPartyMessageBlock(): string {
  if (env().env_source === 'cdn') {
    return third_party_message;
  }
  return `<link rel="stylesheet" href="${LIB_BASE}/th-env.css" />
<script src="${LIB_BASE}/tailwindcss.min.js"></script>
<script src="${LIB_BASE}/th-env.js"></script>
`;
}

function thirdPartyScriptBlock(): string {
  if (env().env_source === 'cdn') {
    return third_party_script;
  }
  return `<script src="${LIB_BASE}/th-env.js"></script>
`;
}

function logScript(): string {
  const url = env().env_source === 'cdn' ? LOG_CDN_URL : log_url;
  return `<script src="${url}"></script>`;
}

/**
 * Message-iframe document. `content` = decoded frontend code text.
 * `liveStreaming`: inject stream_applier.js so the host can postMessage
 * HTML deltas instead of reloading srcdoc.
 */
export function createMessageSrcdoc(content: string, useBlobUrl: boolean, liveStreaming = false): string {
  const rewritten = engine.rewriteSrcdoc(content);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${useBlobUrl ? `<base href="${window.location.origin}"/>` : ''}
<style>
*,*::before,*::after{box-sizing:border-box;}
html,body{margin:0!important;padding:0;overflow:hidden!important;max-width:100%!important;}
.user_avatar,.user-avatar{background-image:url('${getUserAvatarPath()}')}
.char_avatar,.char-avatar{background-image:url('${getCharAvatarPath()}')}
</style>
${thirdPartyMessageBlock()}
<script src="${predefine_url}"></script>
${logScript()}
<script src="${adjust_viewport_url}"></script>
<script src="${adjust_iframe_height_url}"></script>
${liveStreaming ? `<script src="${stream_applier_url}"></script>` : ''}
</head>
<body>
${rewritten}
</body>
</html>
`;
}

/** Script-iframe document (hidden global/preset/character scripts). */
export function createScriptSrcdoc(content: string, useBlobUrl: boolean, useCleanupProtector: boolean): string {
  return `<!DOCTYPE html>
<html>
<head>
${useBlobUrl ? `<base href="${window.location.origin}"/>` : ''}
${thirdPartyScriptBlock()}
<script src="${parent_jquery_url}"></script>
<script src="${predefine_url}"></script>
${useCleanupProtector && !content.includes('pagehide') ? `<script src="${cleanup_protector_url}"></script>` : ''}
${logScript()}
</head>
<body>
<script type="module">
${engine.unwrapFence(content)}
</script>
</body>
</html>
`;
}

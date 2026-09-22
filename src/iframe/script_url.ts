import adjust_iframe_height from '@/iframe/adjust_iframe_height?raw';
import adjust_viewport from '@/iframe/adjust_viewport?raw';
import cleanup_protector from '@/iframe/cleanup_protector?raw';
import log_js from '@/iframe/node_modules/log.js?raw';
import parent_jquery from '@/iframe/parent_jquery?raw';
import predefine from '@/iframe/predefine?raw';
import stream_applier from '@/iframe/stream_applier?raw';

function createObjectURLFromScript(code: string): string {
  return URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
}

// 反正酒馆助手不会 unmount, 无需考虑 revoke
export const adjust_iframe_height_url = createObjectURLFromScript(adjust_iframe_height);
export const adjust_viewport_url = createObjectURLFromScript(adjust_viewport);
export const cleanup_protector_url = createObjectURLFromScript(cleanup_protector);
export const parent_jquery_url = createObjectURLFromScript(parent_jquery);
export const predefine_url = createObjectURLFromScript(predefine);

// NEW: log.js is bundled (was: jsdelivr CDN — kills a per-iframe remote fetch
// and a supply-chain dependency on the gh mirror). stream_applier is the
// opt-in 'live' streaming-mode runtime.
export const log_url = createObjectURLFromScript(log_js);
export const stream_applier_url = createObjectURLFromScript(stream_applier);

/** CDN URL kept for env_source='cdn' escape hatch. */
export const LOG_CDN_URL =
  'https://testingcf.jsdelivr.net/gh/1235467/Tavern-Helper-optimise/src/iframe/node_modules/log.js';

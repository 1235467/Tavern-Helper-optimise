// Static ABI guard — asserts the bit-for-bit contract strings live in the
// sources they must live in. Catches accidental renames/deletions of the
// surface third-party scripts depend on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = async p => readFile(path.join(root, p), 'utf8');

test('iframe naming scheme strings', async () => {
  const registry = await src('src/core/runtime_registry.ts');
  const stream = await src('src/core/stream_session.ts');
  const controller = await src('src/core/iframe_controller.ts');
  assert.match(registry, /TH-message--\$\{messageId\}--\$\{index\}/);
  assert.match(stream, /TH-message--\$\{this\.messageId\}--\$\{index\}/);
  assert.match(stream, /TH-message--\$\{this\.messageId\}--\$\{index\}_\$\{sub\}/);
  assert.match(controller, /message_iframe_render_(started|ended)/);
});

test('event string table is intact (copied function/event.ts)', async () => {
  const events = await src('src/function/event.ts');
  for (const s of [
    "'chat_id_changed'", // CHAT_CHANGED quirk
    "'GENERATION_AFTER_COMMANDS'", // uppercase quirk
    "'stream_token_received'", // duplicated value quirk
    "'characterDeleted'", // CHARACTER_DELETED quirk
    "'charManagementDropdown'",
    "'message_iframe_render_started'",
    "'message_iframe_render_ended'",
    "'js_generation_requested'",
    "'js_generation_ended'",
  ]) {
    assert.ok(events.includes(s), `missing ${s} in function/event.ts`);
  }
});

test('DOM markers preserved', async () => {
  const scanner = await src('src/core/message_scanner.ts');
  assert.match(scanner, /TH-render/);
  const controller = await src('src/core/iframe_controller.ts');
  assert.match(controller, /hidden!/);
  assert.match(controller, /显示前端代码块/);
  assert.match(controller, /TH_UPDATE_VIEWPORT_HEIGHT/);
  const stream = await src('src/core/stream_session.ts');
  assert.match(stream, /TH-streaming/);
  assert.match(stream, /mes_streaming/);
  assert.match(stream, /curEditTextarea/);
});

test('bootstrap scripts are verbatim ABI', async () => {
  const predefine = await src('src/iframe/predefine.js');
  assert.match(predefine, /__TH_IFRAME_ID/); // Firefox srcdoc teardown fallback
  assert.match(predefine, /_bind/);
  assert.match(predefine, /pagehide/);
  const parentJq = await src('src/iframe/parent_jquery.js');
  assert.match(parentJq, /window\.parent\.\$/);
  const protector = await src('src/iframe/cleanup_protector.js');
  assert.match(protector, /data-th-iframe-id/);
  const adjView = await src('src/iframe/adjust_viewport.js');
  assert.match(adjView, /--TH-viewport-height/);
  const logjs = await src('src/iframe/node_modules/log.js');
  assert.match(logjs, /_th_impl\._(init|log|clearLog)/);
});

test('srcdoc assembly keeps required pieces', async () => {
  const srcdoc = await src('src/core/srcdoc.ts');
  assert.match(srcdoc, /predefine_url/);
  assert.match(srcdoc, /adjust_iframe_height_url/);
  assert.match(srcdoc, /adjust_viewport_url/);
  assert.match(srcdoc, /user_avatar/);
  assert.match(srcdoc, /char_avatar/);
  assert.match(srcdoc, /JS-Slash-Runner/); // extension dir name is ABI
});

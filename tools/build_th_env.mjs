#!/usr/bin/env node
// Build lib/th-env.js + lib/th-env.css — the single-file replacement for the
// ~7 jsdelivr subresources each message iframe used to fetch.
//
// Order mirrors the original third_party_message.html global-assignment
// order: jQuery → jQuery-UI → touch-punch → Vue → VueRouter.
// Run: `node tools/build_th_env.mjs` (after `pnpm install`).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = (...p) => path.join(root, 'lib', ...p);

const JS_PARTS = [
  ['jquery', 'dist/jquery.min.js'],
  ['jquery-ui-dist', 'jquery-ui.min.js'],
  ['jquery-ui-touch-punch', 'jquery.ui.touch-punch.min.js'],
  ['vue', 'dist/vue.runtime.global.prod.min.js'],
  // vue-router@4 is the version the CDN html used (v5 has no global build)
  ['vue-router4', 'dist/vue-router.global.prod.min.js'],
];

const CSS_PARTS = [
  ['@fortawesome/fontawesome-free', 'css/all.min.css'],
  ['jquery-ui-dist', 'jquery-ui.theme.min.css'],
];

function need(p) {
  if (!fs.existsSync(p)) {
    console.error(
      `missing ${path.relative(root, p)} — check devDependencies ` +
        '(jquery, jquery-ui-dist, jquery-ui-touch-punch, vue, vue-router4, @fortawesome/fontawesome-free)',
    );
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8');
}

const js = JS_PARTS.map(([pkg, file]) => `/* ===== ${pkg}/${file} ===== */\n` + need(nm(pkg, file))).join('\n');
fs.writeFileSync(out('th-env.js'), js);
console.log(`lib/th-env.js  ${(js.length / 1024).toFixed(0)}KB`);

const css = CSS_PARTS.map(([pkg, file]) => `/* ===== ${pkg}/${file} ===== */\n` + need(nm(pkg, file))).join('\n');
fs.writeFileSync(out('th-env.css'), css);
console.log(`lib/th-env.css  ${(css.length / 1024).toFixed(0)}KB`);

// FontAwesome css resolves ../webfonts/* relative to the css file → lib/webfonts
const webfonts_src = nm('@fortawesome/fontawesome-free', 'webfonts');
if (fs.existsSync(webfonts_src)) {
  fs.mkdirSync(out('webfonts'), { recursive: true });
  for (const f of fs.readdirSync(webfonts_src)) {
    fs.copyFileSync(path.join(webfonts_src, f), out('webfonts', f));
  }
  console.log(`lib/webfonts/  ${fs.readdirSync(webfonts_src).length} files`);
}

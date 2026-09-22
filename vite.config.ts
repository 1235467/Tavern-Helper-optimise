import vue from '@vitejs/plugin-vue';
import fs from 'node:fs';
import path from 'node:path';
import unpluginAutoImport from 'unplugin-auto-import/vite';
import { VueUseComponentsResolver, VueUseDirectiveResolver } from 'unplugin-vue-components/resolvers';
import unpluginVueComponents from 'unplugin-vue-components/vite';
import { defineConfig } from 'vite';
import pluginExternal from 'vite-plugin-external';

const externals = {
  jquery: '$',
  hljs: 'hljs',
  lodash: '_',
  showdown: 'showdown',
  toastr: 'toastr',
  '@popperjs/core': 'Popper',
} as const;

// Browser loads from: /scripts/extensions/third-party/<name>/dist/index.js
// Need 5x ../ to reach ST public root. The original calculation uses __dirname depth
// which only works when the project sits inside ST's public/ tree (or by CI coincidence).
// ST_IMPORT_DEPTH env var lets out-of-tree builds override the depth (default: auto-detect).
const relative_sillytavern_path = process.env.ST_IMPORT_DEPTH
  ? '../'.repeat(Number(process.env.ST_IMPORT_DEPTH)).slice(0, -1)
  : path.relative(path.join(__dirname, 'dist'), __dirname.substring(0, __dirname.lastIndexOf('public') + 6));

const relative_lib_path = path.relative(path.join(__dirname, 'dist'), path.join(__dirname, 'lib'));

const WASM_SRC = path.join(__dirname, 'crates/th-core/target/wasm32-unknown-unknown/release/th_core.wasm');

// Absolute base for emitted chunk/asset URLs. rolldown's modulepreload helper
// resolves dep paths via import.meta.resolve('./x') — Firefox resolves those
// against document.baseURI (the PAGE, "/"), not the module URL, so relative
// chunks 404 on Firefox. Absolute URLs bypass the quirk entirely.
// The extension dir name is part of the script ABI (default JS-Slash-Runner;
// EXT_DIR env var for installs under a different folder name).
const EXTENSION_DIR = process.env.EXT_DIR ?? 'JS-Slash-Runner';
const BASE = `/scripts/extensions/third-party/${EXTENSION_DIR}/dist/`;

export default defineConfig(({ mode }) => ({
  base: BASE,

  plugins: [
    vue({
      features: {
        optionsAPI: false,
        prodDevtools: true,
        prodHydrationMismatchDetails: false,
      },
      template: {
        compilerOptions: {
          isCustomElement: tag => tag === 'toolcool-color-picker',
        },
      },
    }),
    unpluginAutoImport({
      dts: true,
      dtsMode: 'overwrite',
      imports: [
        'vue',
        'pinia',
        '@vueuse/core',
        { from: '@sillytavern/scripts/i18n', imports: ['t'] },
        { from: 'klona', imports: ['klona'] },
        { from: 'vue-final-modal', imports: ['useModal'] },
        { from: 'zod', imports: ['z'] },
        { from: 'type-fest', imports: [['*', 'TypeFest']], type: true },
      ],
      dirs: [{ glob: 'src/panel/composable', types: true }],
    }),
    unpluginVueComponents({
      dts: true,
      syncMode: 'overwrite',
      globs: ['src/panel/component/*.vue'],
      resolvers: [VueUseComponentsResolver(), VueUseDirectiveResolver()],
    }),
    {
      name: 'sillytavern_resolver',
      enforce: 'pre',
      resolveId(id) {
        if (id.startsWith('@sillytavern/')) {
          return {
            id: path.join(relative_sillytavern_path, id.replace('@sillytavern/', '')).replaceAll('\\', '/') + '.js',
            external: true,
          };
        }
      },
    },
    {
      name: 'jsoneditor_resolver',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'vanilla-jsoneditor') {
          return {
            id: path.join(relative_lib_path, 'jsoneditor.js').replaceAll('\\', '/'),
            external: true,
          };
        }
      },
    },
    pluginExternal({
      externals: libname => {
        if (libname in externals) {
          return externals[libname as keyof typeof externals];
        }
      },
    }),
    {
      // ship crates/th-core wasm alongside index.js — loaded via
      // new URL('./th_core.wasm', import.meta.url)
      name: 'copy_wasm',
      writeBundle() {
        if (fs.existsSync(WASM_SRC)) {
          fs.copyFileSync(WASM_SRC, path.join(__dirname, 'dist', 'th_core.wasm'));
        } else {
          this.warn(
            'th_core.wasm not found — run `cargo build --release --target wasm32-unknown-unknown` ' +
              'in crates/th-core (JS fallbacks will be used)',
          );
        }
      },
    },
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },

  build: {
    // expose the extension dir name to src (srcdoc lib paths)
    define: {
      __TH_EXT_DIR__: JSON.stringify(EXTENSION_DIR),
    },
    rollupOptions: {
      input: 'src/index.ts',
      preserveEntrySignatures: 'strict',
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        // high-latency deployment: each emitted chunk costs a serial RTT in the
        // browser's ESM waterfall — collapse dynamic imports into the entry
        // (external dynamic imports like @sillytavern/* stay external)
        inlineDynamicImports: true,
        assetFileNames: '[name].[ext]',
        preserveModules: false,
      },
    },

    outDir: 'dist',
    emptyOutDir: false,

    // no sourcemaps for prod — ~1.1MB wire of debug maps for zero runtime
    // benefit at 300KB/s connections; keep inline maps for dev/watch builds
    sourcemap: mode !== 'production' ? 'inline' : false,

    minify: mode === 'production' ? 'oxc' : false,
    terserOptions:
      mode === 'production'
        ? {
            format: { quote_style: 1 },
            mangle: { reserved: ['_', 'toastr', 'YAML', '$', 'z'] },
          }
        : {
            format: { beautify: true, indent_level: 2 },
            compress: false,
            mangle: false,
          },

    target: 'esnext',
  },
}));

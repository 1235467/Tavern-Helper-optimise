import { initTavernHelperObject } from '@/function/index';
import '@/global.css';
import { registerMacros } from '@/macro';
import { registerSwipeEvent } from '@/swipe';
import { initSlashCommands } from '@/slash_command/index';
import { initThirdPartyObject } from '@/third_party_object';
import { setEnvProvider, type EnvProvider, type RenderEnv } from '@/core/env';
import { RenderEngine } from '@/core/render_engine';
import { usesManagedChatSurface } from '@/tauritavern_chat_surface';
import { wasmReady } from '@/wasm/loader';
import { useGlobalSettingsStore } from '@/store/settings';
import { getCurrentLocale } from '@sillytavern/scripts/i18n';
import { App } from 'vue';
import { createVfm } from 'vue-final-modal';
import 'vue-final-modal/style.css';
import VueTippy from 'vue-tippy';

export { activateTauriTavernChatSurface } from '@/tauritavern_chat_surface';

// WASM starts loading immediately — the engine falls back to pure-JS
// implementations until (and unless) it arrives.
void wasmReady;

const app = createApp(defineAsyncComponent(() => import('@/Panel.vue')));

const pinia = createPinia();
setActivePinia(pinia); // stores must work before mount (env bridge uses them)
app.use(pinia);

const vfm = createVfm();
app.use(vfm);

app.use(VueTippy);

declare module 'vue' {
  interface ComponentCustomProperties {
    t: typeof t;
  }
}
const i18n = {
  install: (app: App) => {
    app.config.globalProperties.t = t;
  },
};
app.use(i18n);

$(() => {
  z.config(getCurrentLocale().includes('zh') ? z.locales.zhCN() : z.locales.en());
  registerMacros();
  registerSwipeEvent();
  initTavernHelperObject();
  initThirdPartyObject();
  initSlashCommands();

  // env bridge: bind the Pinia settings store onto the plain RenderEnv
  // interface the core engine consumes (core stays Vue-free).
  const settings = useGlobalSettingsStore();
  setEnvProvider({
    get env(): RenderEnv {
      return settings.settings.render as RenderEnv;
    },
    onChange(cb) {
      return watch(
        () => settings.settings.render,
        () => cb(),
        { deep: true },
      );
    },
  } as EnvProvider);

  const $app = $('<div id="tavern_helper">').appendTo('#extensions_settings');
  app.mount($app[0]);

  // start AFTER app.mount: Render.vue's useMacroLike registers demacro
  // listeners inside mount — upstream ordering is demacro-then-render
  // (demacro strips .TH-render > iframe, the renderer remounts after).
  // Managed TauriTavern surfaces own their own render path; 'legacy' mode
  // keeps the original Vue pipeline instead.
  if (!usesManagedChatSurface && settings.settings.render.engine === 'ng') {
    const engine = new RenderEngine();
    engine.start();
  }
});

$(window).on('pagehide', () => {
  app.unmount();
});

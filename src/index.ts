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

export { activateTauriTavernChatSurface } from '@/tauritavern_chat_surface';

// WASM starts loading immediately — the engine falls back to pure-JS
// implementations until (and unless) it arrives.
void wasmReady;

const app = createApp(defineAsyncComponent(() => import('@/Panel.vue')));

const pinia = createPinia();
setActivePinia(pinia); // stores must work before mount (env bridge uses them)
app.use(pinia);

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

$(async () => {
  z.config(getCurrentLocale().includes('zh') ? z.locales.zhCN() : z.locales.en());

  // boot guard: a second TavernHelper means the original extension is also
  // active — they MUST NOT run side-by-side (same ABI, double everything)
  if ((globalThis as any).TavernHelper !== undefined) {
    const msg = '[tavern-helper-ng] 检测到已存在 TavernHelper — 原版与 ng 不能同时启用, 请禁用其中一个';
    console.error(msg);
    toastr.error('检测到重复的酒馆助手实例, 请禁用其中一个后刷新', 'tavern-helper-ng');
    // still initialize (last writer wins) but the warning is visible
  }

  registerMacros();
  registerSwipeEvent();
  initTavernHelperObject();
  (globalThis as any).TavernHelper.__th_ng = true; // build-stamp for guards
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
  // vfm + tippy (~560KB) install from the deferred panel chunk — a chunk
  // load failure must not take down mounting (or the render engine below)
  try {
    const { default: installPanelPlugins } = await import('@/panel/plugins');
    installPanelPlugins(app);
  } catch (e) {
    console.error('[tavern-helper-ng] panel plugins chunk failed to load', e);
  }
  app.mount($app[0]);

  // start AFTER app.mount: Render.vue's useMacroLike registers demacro
  // listeners inside mount — upstream ordering is demacro-then-render
  // (demacro strips .TH-render > iframe, the renderer remounts after).
  // Managed TauriTavern surfaces own their own render path; 'legacy' mode
  // keeps the original Vue pipeline instead.
  if (!usesManagedChatSurface && settings.settings.render.engine === 'ng') {
    const engine = new RenderEngine();
    void engine.start();
  }
});

$(window).on('pagehide', () => {
  app.unmount();
});

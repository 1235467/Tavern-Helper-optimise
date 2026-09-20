// minimal stubs for targeted typecheck of src/core + src/wasm outside ST
declare module '@sillytavern/script' {
  export const chat: any;
  export const eventSource: any;
  export const event_types: any;
}
declare module '@sillytavern/scripts/i18n' {
  export const getCurrentLocale: any;
  export const t: any;
}
declare module '@sillytavern/scripts/utils' {
  export const uuidv4: any;
  export const getStringHash: any;
}
declare module '@sillytavern/scripts/macros' {
  export const getLastMessageId: any;
}
declare module '@sillytavern/*' {
  const x: { [key: string]: any };
  export = x;
}
declare module '*.html?raw' { const s: string; export default s; }
declare module '*?raw' { const s: string; export default s; }
declare module '*.vue' { const c: any; export default c; }
declare module 'vue-final-modal';
declare module 'vue-tippy';
declare module '@/Panel.vue' { const c: any; export default c; }
// auto-imported globals (unplugin-auto-import provides them at build)
declare const _: any, $: any, jQuery: any, toastr: any, hljs: any, YAML: any;
declare const z: any, t: any;
declare const defineStore: any, ref: any, watch: any, computed: any, toRef: any,
  shallowRef: any, toRefs: any, readonly: any, unref: any, nextTick: any,
  onMounted: any, onBeforeMount: any, onUnmounted: any, onBeforeUnmount: any,
  useTemplateRef: any, useEventListener: any, watchImmediate: any,
  createApp: any, defineAsyncComponent: any, createPinia: any,
  setActivePinia: any, getCurrentInstance: any, inject: any, provide: any,
  reactive: any, isRef: any, watchEffect: any, watchDebounced: any,
  useModal: any, klona: any, useEventSourceOn: any;

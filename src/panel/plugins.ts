// Panel-only plugin installs — kept in the deferred chunk so vue-final-modal
// and vue-tippy (~560KB) don't load on the extension's cold path.
import type { App } from 'vue';
import { createVfm } from 'vue-final-modal';
import 'vue-final-modal/style.css';
import VueTippy from 'vue-tippy';

export default function installPanelPlugins(app: App) {
  app.use(createVfm());
  app.use(VueTippy);
}

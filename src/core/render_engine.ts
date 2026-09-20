// RenderEngine — top-level orchestrator for the 'ng' engine: owns the
// RuntimeRegistry (non-streaming message iframes) and the StreamManager
// (streaming sessions). Env changes re-audit; disabling clears everything.

import { env, onEnvChange } from '@/core/env';
import { RuntimeRegistry, initRuntimeRegistry } from '@/core/runtime_registry';
import { probeSrcdoc } from '@/core/srcdoc_probe';
import { StreamManager, initStreamManager } from '@/core/stream_session';

export class RenderEngine {
  readonly registry = new RuntimeRegistry();
  readonly streams = new StreamManager();
  private disposers: (() => void)[] = [];
  private started = false;

  async start() {
    if (this.started) return;
    this.started = true;
    // resolve the srcdoc-flakiness probe before the first render decides
    // srcdoc vs blob — cheap (~ms), deterministic for the whole session
    await probeSrcdoc();
    this.disposers.push(initRuntimeRegistry(this.registry));
    this.disposers.push(initStreamManager(this.streams));
    this.disposers.push(
      onEnvChange(() => {
        if (!env().enabled || env().engine !== 'ng') {
          this.registry.clear();
          this.streams.clear();
          return;
        }
        this.registry.audit();
        this.streams.refreshAll();
      }),
    );
    if (env().enabled) {
      this.registry.audit();
    }
  }

  stop() {
    this.disposers.forEach(d => d());
    this.disposers = [];
    this.started = false;
  }
}

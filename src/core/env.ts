// Settings bridge — the core render engine reads a plain interface so it has
// no Pinia/Vue dependency (the panel binds the real settings store onto this).

export interface RenderEnv {
  /** master switch for the renderer */
  enabled: boolean;
  /** render depth (0 = all); counted from latest message */
  depth: number;
  /** skip messages hidden from the AI (is_system) and don't count them */
  depth_ignore_hidden: boolean;
  /** stream while generating */
  allow_streaming: boolean;
  /**
   * 'sealed' (default): trailing chunk reloads throttled; sealed chunks frozen.
   * 'live': trailing frontend iframe gets postMessage deltas (scripts run at seal).
   */
  streaming_mode: 'sealed' | 'live';
  /** blob-URL iframes instead of srcdoc (better F12 debugging, FF srcdoc workaround) */
  use_blob_url: boolean;
  /** collapse code blocks: 'all' | 'frontend_only' | 'none' */
  collapse_code_block: 'all' | 'frontend_only' | 'none';
  /** cleanup_protector bootstrap in script iframes */
  use_cleanup_protector: boolean;
  /** skip hljs on renderable blocks */
  optimize_hljs: boolean;
  /** iframe library source: bundled th-env.js ('local') or original CDN html ('cdn') */
  env_source: 'local' | 'cdn';
  /** engine: 'ng' (this core) or 'legacy' (the original Vue pipeline) */
  engine: 'ng' | 'legacy';
  /**
   * IntersectionObserver render gating: defer iframe creation for below-fold
   * messages until their wrapper nears the viewport (defers the ~10-script
   * realm eval — biggest FF Android win). Fallback state = the raw <pre>
   * stays visible until it scrolls into view.
   */
  io_gate: boolean;
}

export const defaultRenderEnv: RenderEnv = {
  enabled: true,
  depth: 0,
  depth_ignore_hidden: false,
  allow_streaming: false,
  streaming_mode: 'sealed',
  use_blob_url: false,
  collapse_code_block: 'none',
  use_cleanup_protector: false,
  optimize_hljs: false,
  env_source: 'local',
  engine: 'ng',
  io_gate: true,
};

export interface EnvProvider {
  readonly env: RenderEnv;
  /** subscribe to any settings change; returns unsubscribe */
  onChange(cb: () => void): () => void;
}

let provider: EnvProvider = {
  env: { ...defaultRenderEnv },
  onChange: () => () => {},
};

export function setEnvProvider(p: EnvProvider) {
  provider = p;
}

export function env(): RenderEnv {
  return provider.env;
}

export function onEnvChange(cb: () => void): () => void {
  return provider.onChange(cb);
}

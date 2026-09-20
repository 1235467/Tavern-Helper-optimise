// vitest smoke test — verifies the plain env bridge + default render env.
import { describe, expect, it } from 'vitest';
import { defaultRenderEnv, env, onEnvChange, setEnvProvider } from '@/core/env';

describe('core/env bridge', () => {
  it('defaults are sane', () => {
    expect(defaultRenderEnv.engine).toBe('ng');
    expect(defaultRenderEnv.streaming_mode).toBe('sealed');
    expect(defaultRenderEnv.env_source).toBe('local');
  });

  it('provider round-trips', () => {
    const custom = { ...defaultRenderEnv, depth: 5 };
    let calls = 0;
    setEnvProvider({
      env: custom,
      onChange: cb => {
        calls++;
        cb();
        return () => {};
      },
    });
    expect(env().depth).toBe(5);
    const off = onEnvChange(() => {});
    expect(calls).toBe(1);
    off();
  });
});

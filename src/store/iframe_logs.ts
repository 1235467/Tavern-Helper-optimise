export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Log = {
  level: LogLevel;
  message: string;
  timestamp: number;
};

/** per-iframe ring capacity — bounds memory for chatty scripts */
const CAP_PER_IFRAME = 500;
/** coalesce bursts of console writes into one UI notification per ~100ms */
const NOTIFY_MS = 100;

// shallowRef: pushing into arrays does NOT notify Vue — consumers depend on
// `version` (throttled) instead. Kills the per-log reactive write + full
// flatten/sort on every console.* call in every iframe.
export const useIframeLogsStore = defineStore('iframe_logs', () => {
  const iframe_logs = shallowRef<Map<string, Log[]>>(new Map());
  /** bumped ~100ms-throttled whenever logs change — consumers watch this */
  const version = ref(0);
  let pending = false;
  const touch = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      version.value++;
    }, NOTIFY_MS);
  };

  const init = (iframe_id: string) => {
    iframe_logs.value.set(iframe_id, []);
    touch();
  };
  const log = (iframe_id: string, level: LogLevel | 'log', ...args: any[]) => {
    if (!iframe_logs.value.has(iframe_id)) {
      iframe_logs.value.set(iframe_id, []);
    }
    const arr = iframe_logs.value.get(iframe_id)!;
    arr.push({
      level: level === 'log' ? 'info' : level,
      message: args.map(String).join(''),
      timestamp: Date.now(),
    });
    if (arr.length > CAP_PER_IFRAME) {
      arr.splice(0, arr.length - CAP_PER_IFRAME);
    }
    touch();
  };
  const clear = (iframe_id: string) => {
    iframe_logs.value.delete(iframe_id);
    touch();
  };
  return { iframe_logs, version, init, log, clear, touch };
});

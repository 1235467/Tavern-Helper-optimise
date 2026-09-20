// Dirty-tracking save queue — the persistence optimization.
// Replaces per-leaf-write klona+save with a debounced single flush:
// N writes in a burst → one clone + one save at quiet, instead of one each.
// pause/resume brackets windows where a flush must not interleave
// (e.g. the character export's cleared-settings→restore window).

export interface DirtyFlush {
  /** call on every dirty signal — O(1), just arms the timer */
  mark(): void;
  /** force the pending flush now (export/switch points); awaited */
  flushNow(): Promise<void>;
  /** suppress mark() until resume() — marks become pending again */
  pause(): void;
  /** flush=false skips the pending flush (caller already wrote current state) */
  resume(flush?: boolean): void;
}

export function createDirtyFlush(flush: () => void | Promise<void>, ms = 300): DirtyFlush {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let paused = false;
  let pendingWhilePaused = false;
  let running: Promise<void> | null = null;

  const run = async () => {
    if (running) {
      await running;
      return;
    }
    running = Promise.resolve().then(flush);
    try {
      await running;
    } finally {
      running = null;
    }
  };

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, ms);
  };

  return {
    mark() {
      if (paused) {
        pendingWhilePaused = true;
        return;
      }
      schedule();
    },
    async flushNow() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pendingWhilePaused = false;
      await run();
    },
    pause() {
      paused = true;
    },
    resume(flush = true) {
      paused = false;
      if (!pendingWhilePaused) return;
      pendingWhilePaused = false;
      if (flush) schedule();
    },
  };
}

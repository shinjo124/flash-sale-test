export interface SharedIntervalTickerOptions {
  setIntervalFn?: (callback: () => void, intervalMs: number) => number;
  clearIntervalFn?: (intervalId: number) => void;
}

export interface SharedIntervalTicker {
  setIntervalFn: (callback: () => void, intervalMs: number) => number;
  clearIntervalFn: (handle: number) => void;
  dispose: () => void;
}

export function createSharedIntervalTicker(
  options: SharedIntervalTickerOptions = {},
): SharedIntervalTicker {
  const schedule = options.setIntervalFn ?? setInterval;
  const cancel = options.clearIntervalFn ?? clearInterval;
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  let intervalMs: number | null = null;
  let intervalId: number | null = null;

  const clearSharedTicker = (): void => {
    if (intervalId === null) return;
    cancel(intervalId);
    intervalId = null;
    intervalMs = null;
  };

  return {
    setIntervalFn(callback, requestedIntervalMs) {
      if (!Number.isSafeInteger(requestedIntervalMs) || requestedIntervalMs < 1) {
        throw new RangeError('intervalMs must be a positive safe integer.');
      }
      if (intervalMs !== null && requestedIntervalMs !== intervalMs) {
        throw new RangeError('All shared callbacks must use the same interval.');
      }

      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      if (intervalId === null) {
        intervalMs = requestedIntervalMs;
        intervalId = schedule(() => {
          for (const listener of callbacks.values()) listener();
        }, requestedIntervalMs);
      }
      return handle;
    },

    clearIntervalFn(handle) {
      callbacks.delete(handle);
      if (callbacks.size === 0) clearSharedTicker();
    },

    dispose() {
      callbacks.clear();
      clearSharedTicker();
    },
  };
}

export const FLASH_SALE_TARGET_TIME = Date.parse('2026-11-11T00:00:00+07:00');

export interface CountdownDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: EventListener): void;
  removeEventListener(type: 'visibilitychange', listener: EventListener): void;
}

export interface AntiDriftTimerRuntime {
  now?: () => number;
  requestAnimationFrame?: typeof requestAnimationFrame;
  cancelAnimationFrame?: typeof cancelAnimationFrame;
  document?: CountdownDocument;
}

export function createAntiDriftTimer(
  onDisplayedSecondChange: (remainingSeconds: number) => void,
  runtime: AntiDriftTimerRuntime = {},
): () => void {
  const readNow = runtime.now ?? Date.now;
  const requestFrame = runtime.requestAnimationFrame ?? requestAnimationFrame;
  const cancelFrame = runtime.cancelAnimationFrame ?? cancelAnimationFrame;
  const visibilityDocument = runtime.document ?? document;
  let isRunning = true;
  let frameId: number | null = null;
  let previousDisplayedSecond: number | null = null;

  const stop = (): void => {
    if (!isRunning) return;
    isRunning = false;
    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
    visibilityDocument.removeEventListener('visibilitychange', onVisibilityChange);
  };

  const update = (): void => {
    frameId = null;
    if (!isRunning || visibilityDocument.visibilityState === 'hidden') return;

    const remainingMs = Math.max(0, FLASH_SALE_TARGET_TIME - readNow());
    const displayedSeconds = Math.ceil(remainingMs / 1000);
    if (displayedSeconds !== previousDisplayedSecond) {
      previousDisplayedSecond = displayedSeconds;
      onDisplayedSecondChange(displayedSeconds);
    }

    if (displayedSeconds === 0) {
      stop();
      return;
    }
    frameId = requestFrame(update);
  };

  function onVisibilityChange(): void {
    if (!isRunning) return;
    if (visibilityDocument.visibilityState === 'hidden') {
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
      return;
    }
    update();
  }

  visibilityDocument.addEventListener('visibilitychange', onVisibilityChange);
  if (visibilityDocument.visibilityState === 'visible') update();

  return stop;
}

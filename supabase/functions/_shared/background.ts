import { log } from './logger.ts';

type EdgeRuntimeLike = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

function edgeWaitUntil(): ((promise: Promise<unknown>) => void) | undefined {
  const runtime = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === 'function') {
    return runtime.waitUntil.bind(runtime);
  }
  return undefined;
}

/**
 * Keep a non-critical write off the request path.
 * Prefer EdgeRuntime.waitUntil so the isolate stays alive; otherwise fire and
 * swallow. Callers must not await the result.
 */
export function scheduleBackgroundWork(
  work: Promise<unknown>,
  context = 'background',
): void {
  const guarded = Promise.resolve(work).then(
    () => undefined,
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      log.warn('Background work failed', context, {
        error: message.slice(0, 200),
      });
    },
  );

  const waitUntil = edgeWaitUntil();
  if (waitUntil) {
    waitUntil(guarded);
    return;
  }
  void guarded;
}

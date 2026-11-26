import { assertEquals } from 'jsr:@std/assert@1';
import { scheduleBackgroundWork } from './background.ts';

Deno.test('scheduleBackgroundWork uses EdgeRuntime.waitUntil when present', async () => {
  const waited: Promise<unknown>[] = [];
  const previous = (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
  (globalThis as { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime = {
    waitUntil(promise) {
      waited.push(promise);
    },
  };

  try {
    let resolved = false;
    scheduleBackgroundWork((async () => {
      resolved = true;
    })());
    assertEquals(waited.length, 1);
    await waited[0];
    assertEquals(resolved, true);
  } finally {
    if (previous === undefined) {
      delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
    } else {
      (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = previous;
    }
  }
});

Deno.test('scheduleBackgroundWork swallows errors without waitUntil', async () => {
  const previous = (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
  delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
  try {
    scheduleBackgroundWork(Promise.reject(new Error('rpc down')));
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    if (previous === undefined) {
      delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
    } else {
      (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = previous;
    }
  }
});

Deno.test('scheduleBackgroundWork does not throw when waitUntil throws', () => {
  const previous = (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
  (globalThis as { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime = {
    waitUntil() {
      throw new Error('waitUntil unavailable');
    },
  };
  try {
    scheduleBackgroundWork(Promise.resolve());
  } finally {
    if (previous === undefined) {
      delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
    } else {
      (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = previous;
    }
  }
});

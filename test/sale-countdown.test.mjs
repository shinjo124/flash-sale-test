import assert from 'node:assert/strict';
import test from 'node:test';
import { FLASH_SALE_TARGET_TIME, createAntiDriftTimer } from '../sale-countdown.ts';

function createRuntime(startTime) {
  let now = startTime;
  let nextId = 1;
  const frames = new Map();
  const cancelled = [];
  const listeners = new Set();
  const document = {
    visibilityState: 'visible',
    addEventListener(type, listener) {
      if (type === 'visibilitychange') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'visibilitychange') listeners.delete(listener);
    },
  };
  return {
    document,
    cancelled,
    frames,
    listeners,
    now: () => now,
    setNow: (value) => { now = value; },
    requestAnimationFrame(callback) {
      const id = nextId;
      nextId += 1;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      cancelled.push(id);
      frames.delete(id);
    },
    runFrame() {
      const entry = frames.entries().next().value;
      if (entry === undefined) return false;
      const [id, callback] = entry;
      frames.delete(id);
      callback(0);
      return true;
    },
    setVisibility(state) {
      document.visibilityState = state;
      for (const listener of listeners) listener(new Event('visibilitychange'));
    },
  };
}

test('uses the fixed 11.11 midnight target in Vietnam time', () => {
  assert.equal(FLASH_SALE_TARGET_TIME, Date.parse('2026-11-11T00:00:00+07:00'));
});

test('recomputes from the target time and calls back only when displayed seconds change', () => {
  const runtime = createRuntime(FLASH_SALE_TARGET_TIME - 10_500);
  const values = [];
  createAntiDriftTimer((seconds) => values.push(seconds), runtime);

  assert.deepEqual(values, [11]);
  runtime.setNow(FLASH_SALE_TARGET_TIME - 10_200);
  runtime.runFrame();
  assert.deepEqual(values, [11]);

  runtime.setNow(FLASH_SALE_TARGET_TIME - 8_100);
  runtime.runFrame();
  assert.deepEqual(values, [11, 9]);
});

test('cancels animation while hidden and recomputes immediately when visible again', () => {
  const runtime = createRuntime(FLASH_SALE_TARGET_TIME - 5_000);
  const values = [];
  const stop = createAntiDriftTimer((seconds) => values.push(seconds), runtime);

  runtime.setVisibility('hidden');
  assert.equal(runtime.frames.size, 0);
  assert.deepEqual(runtime.cancelled, [1]);

  runtime.setNow(FLASH_SALE_TARGET_TIME - 2_200);
  runtime.setVisibility('visible');
  assert.deepEqual(values, [5, 3]);
  assert.equal(runtime.frames.size, 1);

  stop();
  assert.equal(runtime.frames.size, 0);
  assert.equal(runtime.listeners.size, 0);
});

test('waits without scheduling frames when started hidden, then ticks on visibility', () => {
  const runtime = createRuntime(FLASH_SALE_TARGET_TIME - 3_000);
  runtime.document.visibilityState = 'hidden';
  const values = [];

  const stop = createAntiDriftTimer((seconds) => values.push(seconds), runtime);
  assert.deepEqual(values, []);
  assert.equal(runtime.frames.size, 0);

  runtime.setVisibility('visible');
  assert.deepEqual(values, [3]);
  assert.equal(runtime.frames.size, 1);
  stop();
});

test('stops at zero, reports zero once, and removes the visibility listener', () => {
  const runtime = createRuntime(FLASH_SALE_TARGET_TIME - 1);
  const values = [];
  createAntiDriftTimer((seconds) => values.push(seconds), runtime);
  runtime.setNow(FLASH_SALE_TARGET_TIME);
  runtime.runFrame();

  assert.deepEqual(values, [1, 0]);
  assert.equal(runtime.frames.size, 0);
  assert.equal(runtime.listeners.size, 0);
});

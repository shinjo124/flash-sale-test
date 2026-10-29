import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedIntervalTicker } from '../shared-interval-ticker.ts';

test('fans multiple reservation sweepers out from one underlying interval', () => {
  let setCalls = 0;
  let clearCalls = 0;
  let tick;
  const shared = createSharedIntervalTicker({
    setIntervalFn(callback, intervalMs) {
      setCalls += 1;
      assert.equal(intervalMs, 250);
      tick = callback;
      return 77;
    },
    clearIntervalFn(id) {
      clearCalls += 1;
      assert.equal(id, 77);
    },
  });
  let firstRuns = 0;
  let secondRuns = 0;

  const first = shared.setIntervalFn(() => { firstRuns += 1; }, 250);
  const second = shared.setIntervalFn(() => { secondRuns += 1; }, 250);
  assert.equal(setCalls, 1);

  tick();
  assert.equal(firstRuns, 1);
  assert.equal(secondRuns, 1);

  shared.clearIntervalFn(first);
  assert.equal(clearCalls, 0);
  shared.clearIntervalFn(second);
  assert.equal(clearCalls, 1);
});

test('rejects inconsistent intervals so callbacks stay on the shared cadence', () => {
  const shared = createSharedIntervalTicker({
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  shared.setIntervalFn(() => {}, 250);
  assert.throws(() => shared.setIntervalFn(() => {}, 100), /same interval/);
  shared.dispose();
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulatedSaleApi } from '../simulated-sale-api.ts';

function createApi(overrides = {}) {
  const ticker = createFakeTicker();
  return createSimulatedSaleApi({
    product: { id: 'phone-1', title: 'Flash phone', priceVnd: 12_990_000, initialStock: 2 },
    reservationTtlMs: 30_000,
    serverClock: () => 1_700_000_000_000,
    setIntervalFn: ticker.setInterval,
    clearIntervalFn: ticker.clearInterval,
    ...overrides,
  });
}

function createFakeTicker() {
  const callbacks = new Map();
  let nextId = 1;
  let setCalls = 0;
  let clearCalls = 0;
  return {
    setCalls: () => setCalls,
    clearCalls: () => clearCalls,
    setInterval(callback, intervalMs) {
      setCalls += 1;
      const id = nextId;
      nextId += 1;
      callbacks.set(id, { callback, intervalMs });
      return id;
    },
    clearInterval(id) {
      clearCalls += 1;
      callbacks.delete(id);
    },
    tick() {
      for (const { callback } of callbacks.values()) callback();
    },
  };
}

test('uses the injected server clock for snapshots and reservation expiry', async () => {
  const serverNow = 1_700_000_123_456;
  const api = createApi({ serverClock: () => serverNow });

  const snapshot = api.getSnapshot();
  const result = await api.reserve('request-1');

  assert.equal(snapshot.serverNow, serverNow);
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(result.serverNow, serverNow);
  assert.equal(result.expiresAt, serverNow + 30_000);
});

test('returns an explicit rejection without decrementing stock', async () => {
  const api = createApi({ shouldRejectReservation: ({ requestId }) => requestId === 'reject-me' });

  const result = await api.reserve('reject-me');

  assert.deepEqual(result, {
    accepted: false,
    reason: 'REJECTED',
    serverNow: 1_700_000_000_000,
    availableStock: 2,
  });
  assert.equal(api.getSnapshot().availableStock, 2);
});

test('grants no more reservations than stock during concurrent requests', async () => {
  const api = createApi({ product: { id: 'phone-1', title: 'Flash phone', priceVnd: 12_990_000, initialStock: 3 } });

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) => api.reserve(`request-${index}`)),
  );

  assert.equal(results.filter((result) => result.accepted).length, 3);
  assert.equal(results.filter((result) => !result.accepted && result.reason === 'SOLD_OUT').length, 17);
  assert.equal(api.getSnapshot().availableStock, 0);
});

test('treats request ids idempotently and does not decrement stock twice', async () => {
  const api = createApi();

  const first = await api.reserve('same-request');
  const duplicate = await api.reserve('same-request');

  assert.deepEqual(duplicate, first);
  assert.equal(api.getSnapshot().availableStock, 1);
});

test('requires VND price, stock, and lock duration to be valid integers', () => {
  assert.throws(() => createApi({ product: { id: 'phone-1', title: 'Phone', priceVnd: 12_500.5, initialStock: 2 } }), /priceVnd/);
  assert.throws(() => createApi({ product: { id: 'phone-1', title: 'Phone', priceVnd: 12_500, initialStock: -1 } }), /initialStock/);
  assert.throws(() => createApi({ reservationTtlMs: 0 }), /reservationTtlMs/);
});

test('starts one shared expiry ticker and releases every due reservation once', async () => {
  let serverNow = 1_000;
  const ticker = createFakeTicker();
  const api = createApi({
    product: { id: 'phone-1', title: 'Flash phone', priceVnd: 12_990_000, initialStock: 2 },
    reservationTtlMs: 500,
    serverClock: () => serverNow,
    setIntervalFn: ticker.setInterval,
    clearIntervalFn: ticker.clearInterval,
    expiryTickerMs: 100,
  });

  await api.reserve('first');
  await api.reserve('second');
  assert.equal(ticker.setCalls(), 1);
  assert.equal(api.getSnapshot().availableStock, 0);

  serverNow = 1_500;
  ticker.tick();
  assert.equal(api.getSnapshot().availableStock, 2);
  ticker.tick();
  assert.equal(api.getSnapshot().availableStock, 2);

  api.dispose();
  assert.equal(ticker.clearCalls(), 1);
});

test('checks expiry on API access and keeps repeated request keys idempotent after expiry', async () => {
  let serverNow = 1_000;
  const ticker = createFakeTicker();
  const api = createApi({
    reservationTtlMs: 500,
    serverClock: () => serverNow,
    setIntervalFn: ticker.setInterval,
    clearIntervalFn: ticker.clearInterval,
  });
  const first = await api.reserve('same-request');

  serverNow = 1_500;
  const snapshot = api.getSnapshot();
  const duplicate = await api.reserve('same-request');

  assert.equal(snapshot.availableStock, 2);
  assert.deepEqual(duplicate, first);
  assert.equal(api.getSnapshot().availableStock, 2);
  api.dispose();
});

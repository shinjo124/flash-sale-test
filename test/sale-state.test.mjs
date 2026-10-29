import assert from 'node:assert/strict';
import test from 'node:test';
import { SALE_TRANSITION_TABLE, transition } from '../sale-state.ts';

const available = { status: 'AVAILABLE' };

test('reserves an available item without mutating the input state', () => {
  const state = Object.freeze({ ...available });

  const next = transition(state, {
    type: 'RESERVE',
    reservationId: 'r-1',
    expiresAt: 5_000,
    now: 1_000,
  });

  assert.deepEqual(next, { status: 'RESERVED', reservationId: 'r-1', expiresAt: 5_000 });
  assert.deepEqual(state, available);
});

test('moves a live reservation through checkout to sold', () => {
  const reserved = { status: 'RESERVED', reservationId: 'r-1', expiresAt: 5_000 };
  const checkout = transition(reserved, { type: 'START_CHECKOUT', reservationId: 'r-1', now: 2_000 });

  assert.deepEqual(checkout, { ...reserved, status: 'CHECKOUT' });
  assert.deepEqual(transition(checkout, {
    type: 'COMPLETE_CHECKOUT',
    reservationId: 'r-1',
    orderId: 'o-1',
    now: 4_999,
  }), { status: 'SOLD', reservationId: 'r-1', orderId: 'o-1' });
});

test('expires a reservation at its deadline and releases it to available', () => {
  const reserved = { status: 'RESERVED', reservationId: 'r-1', expiresAt: 5_000 };
  const expired = transition(reserved, { type: 'EXPIRE', reservationId: 'r-1', now: 5_000 });

  assert.deepEqual(expired, { status: 'EXPIRED', reservationId: 'r-1' });
  assert.deepEqual(transition(expired, { type: 'RELEASE', reservationId: 'r-1' }), available);
});

test('checkout started or completed at the deadline cannot pass an expired lock', () => {
  const reserved = { status: 'RESERVED', reservationId: 'r-1', expiresAt: 5_000 };
  assert.deepEqual(transition(reserved, {
    type: 'START_CHECKOUT',
    reservationId: 'r-1',
    now: 5_000,
  }), { status: 'EXPIRED', reservationId: 'r-1' });

  const checkout = { status: 'CHECKOUT', reservationId: 'r-1', expiresAt: 5_000 };
  assert.deepEqual(transition(checkout, {
    type: 'COMPLETE_CHECKOUT',
    reservationId: 'r-1',
    orderId: 'o-1',
    now: 5_000,
  }), { status: 'EXPIRED', reservationId: 'r-1' });
});

test('does not expire a reservation before its deadline', () => {
  assert.throws(() => transition(
    { status: 'RESERVED', reservationId: 'r-1', expiresAt: 5_000 },
    { type: 'EXPIRE', reservationId: 'r-1', now: 4_999 },
  ), { name: 'IllegalTransitionError' });
});

test('failed checkout can retry while its original lock remains live', () => {
  const checkout = { status: 'CHECKOUT', reservationId: 'r-1', expiresAt: 5_000 };
  const failed = transition(checkout, {
    type: 'FAIL',
    reservationId: 'r-1',
    reason: 'Payment service unavailable',
    retryable: true,
  });

  assert.deepEqual(failed, {
    status: 'FAILED',
    reason: 'Payment service unavailable',
    retryable: true,
    recovery: { status: 'RESERVED', reservationId: 'r-1', expiresAt: 5_000 },
  });
  assert.deepEqual(transition(failed, { type: 'RETRY', now: 4_000 }), {
    status: 'RESERVED',
    reservationId: 'r-1',
    expiresAt: 5_000,
  });
  assert.deepEqual(transition(failed, { type: 'RETRY', now: 5_000 }), {
    status: 'EXPIRED',
    reservationId: 'r-1',
  });
});

test('rejected reservation enters retryable failed state and can return to available', () => {
  const failed = transition(available, {
    type: 'FAIL',
    reason: 'No stock remains',
    retryable: true,
  });

  assert.deepEqual(failed, {
    status: 'FAILED',
    reason: 'No stock remains',
    retryable: true,
    recovery: available,
  });
  assert.deepEqual(transition(failed, { type: 'RETRY', now: 1_000 }), available);
});

test('exposes allowed event types by state and rejects illegal transitions', () => {
  assert.deepEqual(SALE_TRANSITION_TABLE.SOLD, []);
  assert.deepEqual(SALE_TRANSITION_TABLE.EXPIRED, ['RELEASE']);
  assert.throws(
    () => transition(available, { type: 'COMPLETE_CHECKOUT', reservationId: 'r-1', orderId: 'o-1', now: 1 }),
    { name: 'IllegalTransitionError' },
  );
  assert.throws(
    () => transition({ status: 'RESERVED', reservationId: 'r-1', expiresAt: 10 }, {
      type: 'START_CHECKOUT', reservationId: 'r-2', now: 1,
    }),
    { name: 'IllegalTransitionError' },
  );
});

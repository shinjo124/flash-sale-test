export type SaleStatus =
  | 'AVAILABLE'
  | 'RESERVED'
  | 'CHECKOUT'
  | 'SOLD'
  | 'EXPIRED'
  | 'FAILED';

export interface AvailableState {
  readonly status: 'AVAILABLE';
}

export interface ReservedState {
  readonly status: 'RESERVED';
  readonly reservationId: string;
  readonly expiresAt: number;
}

export interface CheckoutState {
  readonly status: 'CHECKOUT';
  readonly reservationId: string;
  readonly expiresAt: number;
}

export interface SoldState {
  readonly status: 'SOLD';
  readonly reservationId: string;
  readonly orderId: string;
}

export interface ExpiredState {
  readonly status: 'EXPIRED';
  readonly reservationId: string;
}

export interface FailedState {
  readonly status: 'FAILED';
  readonly reason: string;
  readonly retryable: boolean;
  readonly reservationId?: string;
}

export type SaleState =
  | AvailableState
  | ReservedState
  | CheckoutState
  | SoldState
  | ExpiredState
  | FailedState;

export type SaleEvent =
  | { readonly type: 'RESERVE'; readonly reservationId: string; readonly expiresAt: number; readonly now: number }
  | { readonly type: 'START_CHECKOUT'; readonly reservationId: string; readonly now: number }
  | { readonly type: 'COMPLETE_CHECKOUT'; readonly reservationId: string; readonly orderId: string; readonly now: number }
  | { readonly type: 'EXPIRE'; readonly reservationId: string; readonly now: number }
  | { readonly type: 'RELEASE'; readonly reservationId: string }
  | { readonly type: 'FAIL'; readonly reservationId?: string; readonly reason: string; readonly retryable: boolean }
  | { readonly type: 'RETRY' };

export const SALE_TRANSITION_TABLE = {
  AVAILABLE: ['RESERVE', 'FAIL'],
  RESERVED: ['START_CHECKOUT', 'EXPIRE', 'FAIL'],
  CHECKOUT: ['COMPLETE_CHECKOUT', 'EXPIRE', 'FAIL'],
  SOLD: [],
  EXPIRED: ['RELEASE'],
  FAILED: ['RETRY'],
} as const satisfies Record<SaleStatus, readonly SaleEvent['type'][]>;

/**
 * Transition summary (guards are enforced below):
 * AVAILABLE --RESERVE--> RESERVED; AVAILABLE --FAIL--> FAILED
 * RESERVED --START_CHECKOUT--> CHECKOUT; RESERVED --EXPIRE--> EXPIRED
 * CHECKOUT --COMPLETE_CHECKOUT--> SOLD; CHECKOUT --EXPIRE--> EXPIRED
 * RESERVED/CHECKOUT --FAIL--> FAILED; EXPIRED --RELEASE--> AVAILABLE
 * FAILED --RETRY--> AVAILABLE; failure retains reservationId so callers can release its lock
 * SOLD is terminal. A checkout begun/completed at or after expiresAt becomes EXPIRED.
 *
 * This function reads no clock and mutates neither argument; callers pass `now`
 * in time-sensitive events. Inventory side effects belong to the inventory service.
 */
export function transition(state: SaleState, event: SaleEvent): SaleState {
  switch (state.status) {
    case 'AVAILABLE':
      if (event.type === 'RESERVE') {
        requireText(event.reservationId, 'reservationId', state, event);
        requireTime(event.now, 'now', state, event);
        requireTime(event.expiresAt, 'expiresAt', state, event);
        if (event.expiresAt <= event.now) reject(state, event);
        return { status: 'RESERVED', reservationId: event.reservationId, expiresAt: event.expiresAt };
      }
      if (event.type === 'FAIL') {
        requireText(event.reason, 'reason', state, event);
        if (event.reservationId !== undefined) reject(state, event);
        return { status: 'FAILED', reason: event.reason, retryable: event.retryable };
      }
      return reject(state, event);

    case 'RESERVED':
      if (event.type === 'START_CHECKOUT') {
        requireMatchingReservation(state, event.reservationId, state, event);
        requireTime(event.now, 'now', state, event);
        if (event.now >= state.expiresAt) return expire(state.reservationId);
        return { ...state, status: 'CHECKOUT' };
      }
      if (event.type === 'EXPIRE') return expireReservation(state, event);
      if (event.type === 'FAIL') return failReservedState(state, event);
      return reject(state, event);

    case 'CHECKOUT':
      if (event.type === 'COMPLETE_CHECKOUT') {
        requireMatchingReservation(state, event.reservationId, state, event);
        requireText(event.orderId, 'orderId', state, event);
        requireTime(event.now, 'now', state, event);
        if (event.now >= state.expiresAt) return expire(state.reservationId);
        return { status: 'SOLD', reservationId: state.reservationId, orderId: event.orderId };
      }
      if (event.type === 'EXPIRE') return expireReservation(state, event);
      if (event.type === 'FAIL') return failReservedState(state, event);
      return reject(state, event);

    case 'EXPIRED':
      if (event.type === 'RELEASE') {
        requireMatchingReservation(state, event.reservationId, state, event);
        return { status: 'AVAILABLE' };
      }
      return reject(state, event);

    case 'FAILED':
      if (event.type === 'RETRY') {
        if (!state.retryable) return reject(state, event);
        return { status: 'AVAILABLE' };
      }
      return reject(state, event);

    case 'SOLD':
      return reject(state, event);
  }
}

export class IllegalTransitionError extends Error {
  constructor(state: SaleState, event: SaleEvent, detail?: string) {
    super(detail ?? `Event ${event.type} is not legal from ${state.status}.`);
    this.name = 'IllegalTransitionError';
  }
}

function expireReservation(state: ReservedState | CheckoutState, event: SaleEvent): ExpiredState {
  if (event.type !== 'EXPIRE') return reject(state, event);
  requireMatchingReservation(state, event.reservationId, state, event);
  requireTime(event.now, 'now', state, event);
  if (event.now < state.expiresAt) return reject(state, event);
  return expire(state.reservationId);
}

function failReservedState(state: ReservedState | CheckoutState, event: SaleEvent): FailedState {
  if (event.type !== 'FAIL') return reject(state, event);
  if (event.reservationId === undefined) return reject(state, event);
  requireMatchingReservation(state, event.reservationId, state, event);
  requireText(event.reason, 'reason', state, event);
  return {
    status: 'FAILED',
    reason: event.reason,
    retryable: event.retryable,
    reservationId: state.reservationId,
  };
}

function requireMatchingReservation(
  state: SaleState,
  reservationId: string,
  source: SaleState,
  event: SaleEvent,
): void {
  if (!('reservationId' in state) || reservationId !== state.reservationId) reject(source, event);
}

function requireText(value: string, field: string, state: SaleState, event: SaleEvent): void {
  if (value.trim().length === 0) reject(state, event, `${field} must not be empty.`);
}

function requireTime(value: number, field: string, state: SaleState, event: SaleEvent): void {
  if (!Number.isFinite(value)) reject(state, event, `${field} must be a finite number.`);
}

function expire(reservationId: string): ExpiredState {
  return { status: 'EXPIRED', reservationId };
}

function reject(state: SaleState, event: SaleEvent, message?: string): never {
  throw new IllegalTransitionError(state, event, message);
}

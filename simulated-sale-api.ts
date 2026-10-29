export interface FlashSaleProduct {
  readonly id: string;
  readonly title: string;
  readonly priceVnd: number;
  readonly initialStock: number;
}

export interface SaleSnapshot {
  readonly product: FlashSaleProduct;
  readonly serverNow: number;
  readonly availableStock: number;
}

export interface ReservationAttempt {
  readonly productId: string;
  readonly requestId: string;
  readonly serverNow: number;
  readonly availableStock: number;
}

export type ReservationResult =
  | {
      readonly accepted: true;
      readonly reservationId: string;
      readonly requestId: string;
      readonly serverNow: number;
      readonly expiresAt: number;
      readonly availableStock: number;
    }
  | {
      readonly accepted: false;
      readonly reason: 'REJECTED' | 'SOLD_OUT';
      readonly serverNow: number;
      readonly availableStock: number;
    };

export type CheckoutResult =
  | {
      readonly completed: true;
      readonly reservationId: string;
      readonly orderId: string;
      readonly serverNow: number;
      readonly availableStock: number;
    }
  | {
      readonly completed: false;
      readonly reason: 'EXPIRED' | 'NOT_FOUND' | 'ALREADY_COMPLETED';
      readonly serverNow: number;
      readonly availableStock: number;
    };

export interface SimulatedSaleApi {
  getSnapshot(): SaleSnapshot;
  reserve(requestId: string): Promise<ReservationResult>;
  releaseReservation(reservationId: string): boolean;
  completeCheckout(reservationId: string, orderId: string): Promise<CheckoutResult>;
  dispose(): void;
}

export interface SimulatedSaleApiOptions {
  readonly product: FlashSaleProduct;
  readonly reservationTtlMs: number;
  readonly serverClock?: () => number;
  readonly shouldRejectReservation?: (attempt: ReservationAttempt) => boolean;
  readonly expiryTickerMs?: number;
  readonly setIntervalFn?: (callback: () => void, intervalMs: number) => number;
  readonly clearIntervalFn?: (tickerId: number) => void;
}

export function createSimulatedSaleApi(options: SimulatedSaleApiOptions): SimulatedSaleApi {
  validateOptions(options);

  const product = Object.freeze({ ...options.product });
  const serverClock = options.serverClock ?? Date.now;
  const shouldRejectReservation = options.shouldRejectReservation ?? (() => false);
  const successfulRequests = new Map<string, Extract<ReservationResult, { accepted: true }>>();
  const activeReservations = new Map<string, { expiresAt: number }>();
  const expiredReservations = new Set<string>();
  const completedReservations = new Map<string, Extract<CheckoutResult, { completed: true }>>();
  let availableStock = product.initialStock;
  let nextReservationNumber = 1;
  let disposed = false;

  const expireDueReservations = (serverNow: number): void => {
    for (const [reservationId, reservation] of activeReservations) {
      if (serverNow < reservation.expiresAt) continue;
      activeReservations.delete(reservationId);
      expiredReservations.add(reservationId);
      availableStock += 1;
    }
  };

  const scheduleTicker = options.setIntervalFn ?? setInterval;
  const cancelTicker = options.clearIntervalFn ?? clearInterval;
  const tickerId = scheduleTicker(
    () => expireDueReservations(readServerTime(serverClock)),
    options.expiryTickerMs ?? 250,
  );

  return {
    getSnapshot() {
      const serverNow = readServerTime(serverClock);
      expireDueReservations(serverNow);
      return {
        product,
        serverNow,
        availableStock,
      };
    },

    async reserve(requestId) {
      requireNonEmptyText(requestId, 'requestId');
      const serverNow = readServerTime(serverClock);
      expireDueReservations(serverNow);
      const previousResult = successfulRequests.get(requestId);
      if (previousResult !== undefined) return previousResult;

      const attempt: ReservationAttempt = {
        productId: product.id,
        requestId,
        serverNow,
        availableStock,
      };

      if (shouldRejectReservation(attempt)) {
        return {
          accepted: false,
          reason: 'REJECTED',
          serverNow,
          availableStock,
        };
      }

      if (availableStock === 0) {
        return {
          accepted: false,
          reason: 'SOLD_OUT',
          serverNow,
          availableStock,
        };
      }

      const result = {
        accepted: true as const,
        reservationId: `reservation-${nextReservationNumber}`,
        requestId,
        serverNow,
        expiresAt: serverNow + options.reservationTtlMs,
        availableStock: availableStock - 1,
      };

      nextReservationNumber += 1;
      availableStock -= 1;
      activeReservations.set(result.reservationId, { expiresAt: result.expiresAt });
      successfulRequests.set(requestId, result);
      return result;
    },

    releaseReservation(reservationId) {
      requireNonEmptyText(reservationId, 'reservationId');
      const serverNow = readServerTime(serverClock);
      expireDueReservations(serverNow);
      if (!activeReservations.delete(reservationId)) return false;
      availableStock += 1;
      return true;
    },

    async completeCheckout(reservationId, orderId) {
      requireNonEmptyText(reservationId, 'reservationId');
      requireNonEmptyText(orderId, 'orderId');
      const previousResult = completedReservations.get(reservationId);
      if (previousResult !== undefined) {
        if (previousResult.orderId === orderId) return previousResult;
        return {
          completed: false,
          reason: 'ALREADY_COMPLETED',
          serverNow: readServerTime(serverClock),
          availableStock,
        };
      }

      const serverNow = readServerTime(serverClock);
      expireDueReservations(serverNow);
      if (!activeReservations.delete(reservationId)) {
        return {
          completed: false,
          reason: expiredReservations.has(reservationId) ? 'EXPIRED' : 'NOT_FOUND',
          serverNow,
          availableStock,
        };
      }

      const result = {
        completed: true as const,
        reservationId,
        orderId,
        serverNow,
        availableStock,
      };
      completedReservations.set(reservationId, result);
      return result;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      cancelTicker(tickerId);
    },
  };
}

function validateOptions(options: SimulatedSaleApiOptions): void {
  requireNonEmptyText(options.product.id, 'product.id');
  requireNonEmptyText(options.product.title, 'product.title');
  requireIntegerAtLeast(options.product.priceVnd, 0, 'product.priceVnd');
  requireIntegerAtLeast(options.product.initialStock, 0, 'product.initialStock');
  requireIntegerAtLeast(options.reservationTtlMs, 1, 'reservationTtlMs');
  requireIntegerAtLeast(options.expiryTickerMs ?? 250, 1, 'expiryTickerMs');
}

function requireNonEmptyText(value: string, field: string): void {
  if (value.trim().length === 0) throw new TypeError(`${field} must not be empty.`);
}

function requireIntegerAtLeast(value: number, minimum: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${field} must be a safe integer of at least ${minimum}.`);
  }
}

function readServerTime(serverClock: () => number): number {
  const serverNow = serverClock();
  if (!Number.isFinite(serverNow)) throw new RangeError('serverClock must return a finite timestamp.');
  return serverNow;
}

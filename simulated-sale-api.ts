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

export interface SimulatedSaleApi {
  getSnapshot(): SaleSnapshot;
  reserve(requestId: string): Promise<ReservationResult>;
}

export interface SimulatedSaleApiOptions {
  readonly product: FlashSaleProduct;
  readonly reservationTtlMs: number;
  readonly serverClock?: () => number;
  readonly shouldRejectReservation?: (attempt: ReservationAttempt) => boolean;
}

export function createSimulatedSaleApi(options: SimulatedSaleApiOptions): SimulatedSaleApi {
  validateOptions(options);

  const product = Object.freeze({ ...options.product });
  const serverClock = options.serverClock ?? Date.now;
  const shouldRejectReservation = options.shouldRejectReservation ?? (() => false);
  const successfulRequests = new Map<string, Extract<ReservationResult, { accepted: true }>>();
  let availableStock = product.initialStock;
  let nextReservationNumber = 1;

  return {
    getSnapshot() {
      return {
        product,
        serverNow: readServerTime(serverClock),
        availableStock,
      };
    },

    async reserve(requestId) {
      requireNonEmptyText(requestId, 'requestId');
      const previousResult = successfulRequests.get(requestId);
      if (previousResult !== undefined) return previousResult;

      const serverNow = readServerTime(serverClock);
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
      successfulRequests.set(requestId, result);
      return result;
    },
  };
}

function validateOptions(options: SimulatedSaleApiOptions): void {
  requireNonEmptyText(options.product.id, 'product.id');
  requireNonEmptyText(options.product.title, 'product.title');
  requireIntegerAtLeast(options.product.priceVnd, 0, 'product.priceVnd');
  requireIntegerAtLeast(options.product.initialStock, 0, 'product.initialStock');
  requireIntegerAtLeast(options.reservationTtlMs, 1, 'reservationTtlMs');
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

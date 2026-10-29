import { createSimulatedSaleApi, type FlashSaleProduct, type SimulatedSaleApi } from './simulated-sale-api.ts';
import { createAntiDriftTimer } from './sale-countdown.ts';
import { transition, type SaleState } from './sale-state.ts';
import { createSharedIntervalTicker } from './shared-interval-ticker.ts';
import './style.css';

interface ProductCardElements {
  article: HTMLElement;
  price: HTMLElement;
  stock: HTMLElement;
  status: HTMLElement;
  lock: HTMLElement;
  reserveButton: HTMLButtonElement;
  checkoutButton: HTMLButtonElement;
}

interface ProductController {
  product: FlashSaleProduct & { readonly description: string; readonly badge: string; readonly rejectFirstRequest?: boolean };
  api: SimulatedSaleApi;
  state: SaleState;
  confirmedStock: number;
  isPending: boolean;
  pendingAction: 'reserve' | 'checkout' | null;
  statusMessage: string;
  requestCount: number;
  orderCount: number;
  card: ProductCardElements;
}

const productCatalog = [
  {
    id: 'phone-11',
    title: 'Aurora 5G Phone',
    description: 'AMOLED display · 256 GB · 5G ready',
    badge: 'Best seller',
    priceVnd: 12_990_000,
    initialStock: 8,
  },
  {
    id: 'watch-11',
    title: 'Pulse Smart Watch',
    description: 'Health tracking · 7-day battery · Water resistant',
    badge: 'Rollback demo',
    priceVnd: 3_490_000,
    initialStock: 5,
    rejectFirstRequest: true,
  },
  {
    id: 'headphones-11',
    title: 'QuietWave Headphones',
    description: 'Adaptive noise cancelling · 40-hour playback',
    badge: 'Limited stock',
    priceVnd: 2_250_000,
    initialStock: 3,
  },
] satisfies Array<FlashSaleProduct & { description: string; badge: string; rejectFirstRequest?: boolean }>;

const root = document.querySelector<HTMLElement>('#product-grid');
const countdown = document.querySelector<HTMLElement>('#sale-countdown');
if (root === null || countdown === null) throw new Error('Flash-sale page is missing required elements.');

const vndFormatter = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
const sharedTicker = createSharedIntervalTicker();
const productCardsById = new Map<string, ProductCardElements>();
const controllersById = new Map<string, ProductController>();

for (const product of productCatalog) {
  const card = createProductCard(product);
  productCardsById.set(product.id, card);
}
root.replaceChildren(...productCatalog.map((product) => productCardsById.get(product.id)!.article));

for (const product of productCatalog) {
  const card = productCardsById.get(product.id);
  if (card === undefined) throw new Error(`Missing product card for ${product.id}.`);

  const api = createSimulatedSaleApi({
    product,
    reservationTtlMs: 120_000,
    expiryTickerMs: 250,
    setIntervalFn: sharedTicker.setIntervalFn,
    clearIntervalFn: sharedTicker.clearIntervalFn,
    shouldRejectReservation: ({ requestId }) => product.rejectFirstRequest === true
      && requestId === `${product.id}-request-1`,
  });
  const snapshot = api.getSnapshot();
  const controller: ProductController = {
    product,
    api,
    state: { status: 'AVAILABLE' },
    confirmedStock: snapshot.availableStock,
    isPending: false,
    pendingAction: null,
    statusMessage: product.rejectFirstRequest === true
      ? 'First reserve attempt is configured to reject so you can see stock rollback.'
      : 'Ready to reserve.',
    requestCount: 0,
    orderCount: 0,
    card,
  };
  controllersById.set(product.id, controller);
  renderCard(controller);
}

const onClick = (event: Event): void => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>('button[data-action]');
  const cardElement = button?.closest<HTMLElement>('[data-product-id]');
  const productId = cardElement?.dataset.productId;
  if (button === null || button === undefined || productId === undefined) return;

  const controller = controllersById.get(productId);
  if (controller === undefined) return;
  if (button.dataset.action === 'reserve') void reserveProduct(controller);
  if (button.dataset.action === 'checkout') void checkoutProduct(controller);
};

root.addEventListener('click', onClick);

const stopCountdown = createAntiDriftTimer((remainingSeconds) => {
  countdown.textContent = formatCountdown(remainingSeconds);
});

const refreshHandle = sharedTicker.setIntervalFn(() => {
  for (const controller of controllersById.values()) refreshReservation(controller);
}, 250);

const onPageHide = (): void => {
  stopCountdown();
  root.removeEventListener('click', onClick);
  sharedTicker.clearIntervalFn(refreshHandle);
  for (const controller of controllersById.values()) controller.api.dispose();
  sharedTicker.dispose();
};
window.addEventListener('pagehide', onPageHide, { once: true });

function createProductCard(
  product: FlashSaleProduct & { readonly description: string; readonly badge: string },
): ProductCardElements {
  const article = document.createElement('article');
  article.className = 'product-card';
  article.dataset.productId = product.id;

  const cardTop = document.createElement('div');
  cardTop.className = 'card-topline';
  const badge = document.createElement('span');
  badge.className = 'product-badge';
  badge.textContent = product.badge;
  const stockLabel = document.createElement('span');
  stockLabel.className = 'stock-label';
  stockLabel.textContent = 'Stock';
  cardTop.append(badge, stockLabel);

  const artwork = document.createElement('div');
  artwork.className = `product-art product-art--${product.id}`;
  artwork.setAttribute('aria-hidden', 'true');
  const artMark = document.createElement('span');
  artMark.textContent = product.id === 'phone-11' ? 'A' : product.id === 'watch-11' ? 'P' : 'Q';
  artwork.append(artMark);

  const title = document.createElement('h3');
  title.textContent = product.title;
  const description = document.createElement('p');
  description.className = 'product-description';
  description.textContent = product.description;
  const price = document.createElement('p');
  price.className = 'product-price';
  price.textContent = vndFormatter.format(product.priceVnd);

  const inventory = document.createElement('div');
  inventory.className = 'inventory-row';
  const inventoryTitle = document.createElement('span');
  inventoryTitle.textContent = 'Available';
  const stock = document.createElement('strong');
  inventory.append(inventoryTitle, stock);

  const status = document.createElement('p');
  status.className = 'product-status';
  status.setAttribute('aria-live', 'polite');
  const lock = document.createElement('p');
  lock.className = 'reservation-lock';

  const actions = document.createElement('div');
  actions.className = 'product-actions';
  const reserveButton = document.createElement('button');
  reserveButton.type = 'button';
  reserveButton.dataset.action = 'reserve';
  reserveButton.textContent = 'Reserve item';
  const checkoutButton = document.createElement('button');
  checkoutButton.type = 'button';
  checkoutButton.dataset.action = 'checkout';
  checkoutButton.textContent = 'Checkout';
  checkoutButton.hidden = true;
  actions.append(reserveButton, checkoutButton);

  article.append(cardTop, artwork, title, description, price, inventory, status, lock, actions);
  return { article, price, stock, status, lock, reserveButton, checkoutButton };
}

async function reserveProduct(controller: ProductController): Promise<void> {
  if (controller.isPending || controller.state.status !== 'AVAILABLE' || controller.confirmedStock < 1) return;

  controller.isPending = true;
  controller.pendingAction = 'reserve';
  controller.statusMessage = 'Reserving one unit…';
  renderCard(controller);

  controller.requestCount += 1;
  const requestId = `${controller.product.id}-request-${controller.requestCount}`;
  try {
    const result = await controller.api.reserve(requestId);
    controller.isPending = false;
    controller.pendingAction = null;
    controller.confirmedStock = result.availableStock;
    if (result.accepted) {
      controller.state = transition(controller.state, {
        type: 'RESERVE',
        reservationId: result.reservationId,
        expiresAt: result.expiresAt,
        now: result.serverNow,
      });
      controller.statusMessage = 'Reserved. Complete checkout before the lock expires.';
    } else {
      const failed = transition(controller.state, {
        type: 'FAIL',
        reason: result.reason,
        retryable: true,
      });
      controller.state = transition(failed, { type: 'RETRY' });
      controller.confirmedStock = controller.api.getSnapshot().availableStock;
      controller.statusMessage = result.reason === 'SOLD_OUT'
        ? 'Sold out. The current stock is shown above.'
        : 'Reservation rejected. Stock was restored; you can try again.';
    }
  } catch (error) {
    controller.isPending = false;
    controller.pendingAction = null;
    const failed = transition(controller.state, {
      type: 'FAIL',
      reason: error instanceof Error ? error.message : 'Reservation failed.',
      retryable: true,
    });
    controller.state = transition(failed, { type: 'RETRY' });
    controller.confirmedStock = controller.api.getSnapshot().availableStock;
    controller.statusMessage = 'Reservation failed. Stock was restored; you can try again.';
  }
  renderCard(controller);
}

async function checkoutProduct(controller: ProductController): Promise<void> {
  if (controller.isPending || controller.state.status !== 'RESERVED') return;
  const reservation = controller.state;
  const serverNow = controller.api.getSnapshot().serverNow;
  const checkoutState = transition(reservation, {
    type: 'START_CHECKOUT',
    reservationId: reservation.reservationId,
    now: serverNow,
  });
  if (checkoutState.status === 'EXPIRED') {
    controller.state = transition(checkoutState, { type: 'RELEASE', reservationId: reservation.reservationId });
    controller.confirmedStock = controller.api.getSnapshot().availableStock;
    controller.statusMessage = 'Reservation expired. Stock is available again.';
    renderCard(controller);
    return;
  }

  controller.state = checkoutState;
  controller.isPending = true;
  controller.pendingAction = 'checkout';
  controller.statusMessage = 'Confirming checkout…';
  renderCard(controller);

  controller.orderCount += 1;
  const orderId = `${controller.product.id}-order-${controller.orderCount}`;
  try {
    const result = await controller.api.completeCheckout(reservation.reservationId, orderId);
    controller.isPending = false;
    controller.pendingAction = null;
    controller.confirmedStock = result.availableStock;
    if (result.completed) {
      controller.state = transition(controller.state, {
        type: 'COMPLETE_CHECKOUT',
        reservationId: reservation.reservationId,
        orderId,
        now: result.serverNow,
      });
      controller.statusMessage = `Order confirmed: ${orderId}.`;
    } else if (result.reason === 'EXPIRED') {
      const expired = transition(controller.state, {
        type: 'EXPIRE',
        reservationId: reservation.reservationId,
        now: result.serverNow,
      });
      controller.state = transition(expired, { type: 'RELEASE', reservationId: reservation.reservationId });
      controller.statusMessage = 'Reservation expired. Stock is available again.';
    } else {
      controller.state = returnToAvailable(controller, reservation.reservationId, result.reason);
      controller.confirmedStock = controller.api.getSnapshot().availableStock;
      controller.statusMessage = 'Checkout failed. The lock was released; reserve again to retry.';
    }
  } catch (error) {
    controller.isPending = false;
    controller.pendingAction = null;
    controller.state = returnToAvailable(
      controller,
      reservation.reservationId,
      error instanceof Error ? error.message : 'Checkout failed.',
    );
    controller.confirmedStock = controller.api.getSnapshot().availableStock;
    controller.statusMessage = 'Checkout failed. The lock was released; reserve again to retry.';
  }
  renderCard(controller);
}

function returnToAvailable(
  controller: ProductController,
  reservationId: string,
  reason: string,
): SaleState {
  const failed = transition(controller.state, {
    type: 'FAIL',
    reservationId,
    reason,
    retryable: true,
  });
  controller.api.releaseReservation(reservationId);
  return transition(failed, { type: 'RETRY' });
}

function refreshReservation(controller: ProductController): void {
  if (controller.state.status !== 'RESERVED') return;
  const reservation = controller.state;
  const snapshot = controller.api.getSnapshot();
  const stockChanged = controller.confirmedStock !== snapshot.availableStock;
  controller.confirmedStock = snapshot.availableStock;
  if (snapshot.serverNow >= reservation.expiresAt) {
    const expired = transition(reservation, {
      type: 'EXPIRE',
      reservationId: reservation.reservationId,
      now: snapshot.serverNow,
    });
    controller.state = transition(expired, { type: 'RELEASE', reservationId: reservation.reservationId });
    controller.statusMessage = 'Reservation expired. Stock is available again.';
    renderCard(controller);
    return;
  }
  if (stockChanged) renderCard(controller);
}

function renderCard(controller: ProductController): void {
  const { card, state, product } = controller;
  const optimisticDecrease = controller.pendingAction === 'reserve' ? 1 : 0;
  card.stock.textContent = `${Math.max(0, controller.confirmedStock - optimisticDecrease)} of ${product.initialStock}`;
  card.status.textContent = controller.statusMessage;
  card.lock.textContent = state.status === 'RESERVED'
    ? `Lock expires at ${new Date(state.expiresAt).toLocaleTimeString('vi-VN')}.`
    : '';
  card.reserveButton.hidden = state.status !== 'AVAILABLE';
  card.reserveButton.disabled = controller.isPending || controller.confirmedStock < 1;
  card.reserveButton.textContent = controller.isPending && controller.pendingAction === 'reserve'
    ? 'Reserving…'
    : state.status === 'AVAILABLE' && controller.confirmedStock < 1
      ? 'Sold out'
      : 'Reserve item';
  card.checkoutButton.hidden = state.status !== 'RESERVED' && state.status !== 'CHECKOUT';
  card.checkoutButton.disabled = controller.isPending || state.status !== 'RESERVED';
  card.checkoutButton.textContent = controller.isPending && controller.pendingAction === 'checkout'
    ? 'Checking out…'
    : 'Checkout';
  if (state.status === 'SOLD') {
    card.reserveButton.hidden = false;
    card.reserveButton.disabled = true;
    card.reserveButton.textContent = 'Sold';
  }
}

function formatCountdown(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(days).padStart(2, '0')}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}


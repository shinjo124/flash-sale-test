# AI Failure Audit

This log records concrete defects found in AI-generated drafts during HW3 work. Each issue was corrected before accepting the implementation. The examples below describe defects actually encountered, not hypothetical failure modes.

## 1. Checkout failure recovered into a still-reserved state

- **Draft flaw:** The initial state model stored a `RESERVED` recovery state inside `FAILED`; `RETRY` returned to `RESERVED` while the lock was still live.
- **Impact:** This contradicted the requested `FAILED -> AVAILABLE` path and allowed the next checkout attempt to reuse a failed reservation instead of releasing it and reserving again.
- **Detection:** Compared the transition behavior with the user's explicit state requirement. Updated the test first; it failed against the old recovery result.
- **Correction/evidence:** `sale-state.ts` now preserves the reservation ID only for lock cleanup, and retryable `FAILED` transitions to `AVAILABLE`. `test/sale-state.test.mjs` covers checkout failure, retained cleanup ID, and return to available.
- **Status:** Corrected and covered by passing tests.

## 2. Countdown draft allowed an arbitrary deadline

- **Draft flaw:** The first timer API accepted a caller-provided `targetTime`, so callers could silently run the sale countdown against a different date.
- **Impact:** The interface did not enforce the fixed assignment deadline of `2026-11-11T00:00:00+07:00`.
- **Detection:** Reviewed the API against the user's fixed-target requirement before integrating the page.
- **Correction/evidence:** `sale-countdown.ts` now owns `FLASH_SALE_TARGET_TIME` and exposes `createAntiDriftTimer(onDisplayedSecondChange)`. `test/sale-countdown.test.mjs` checks the exact timestamp and the display-second callback behavior.
- **Status:** Corrected and covered by passing tests.

## 3. Reservation UI refresh depended on the sale countdown loop

- **Draft flaw:** The first UI draft refreshed reservation state from the countdown callback. That animation loop stops when the sale countdown reaches zero.
- **Impact:** Reservation expiry status could stop refreshing at the sale start, even though a reservation lock could expire later.
- **Detection:** Code review traced the countdown's stop-at-zero behavior and compared it with the independent reservation TTL.
- **Correction/evidence:** Reservation checks now subscribe to `shared-interval-ticker.ts`, the same single 250 ms ticker used to sweep API locks. The countdown loop only updates countdown text. `test/shared-interval-ticker.test.mjs` verifies one underlying interval fans out to multiple sweepers.
- **Status:** Corrected; the shared ticker has unit coverage. The full UI expiry path still needs manual browser verification.

## 4. Checkout-expiry test expected stock to be fully restored

- **Draft flaw:** An initial test expected available stock to return to `2` after the second reservation expired, even though a first unit had already been sold by a successful checkout.
- **Impact:** The assertion conflated expired stock with sold stock and would have hidden an inventory accounting error if the test expectation had been trusted.
- **Detection:** The test failed with actual stock `1` versus expected `2`; tracing the test setup showed that one unit was correctly consumed by checkout.
- **Correction/evidence:** The test now expects `1`, and `test/simulated-sale-api.test.mjs` separately checks that checkout consumes a unit while an expired reservation restores only its own unit.
- **Status:** Corrected; relevant API tests pass.

## Audit limits

The automated suite verifies state transitions, stock/idempotency/expiry behavior, timer visibility behavior, and shared ticker fanout. It does not replace a browser DevTools review of real interaction, rendered layout, or memory behavior.

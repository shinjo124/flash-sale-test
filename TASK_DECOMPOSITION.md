# HW3: High-Concurrency Flash-Sale Engine — Task Decomposition

## Goal

Build a Vite + TypeScript Vietnam mega-sale simulation with an accurate millisecond countdown, optimistic inventory reservations, expiring inventory locks, checkout, and an AI failure audit.

## Source and working rules

- Assignment source: `Lab 02_ Modern React Architecture, Virtual DOM & State Machines.pptx.pdf`, HW3 slide (page 32).
- Follow `project-rules.md`: Vite + TypeScript; no `var`, `keypress`, `keyCode`, raw `innerHTML`, or inline `onclick` handlers.
- Work one sub-task per AI prompt. Define contracts first and verify each generated change before accepting it.
- Make at least eight discrete Conventional Commits. Do not combine milestones into one commit.
- **Implementation assumption:** Unless a backend/API is provided, represent the authoritative inventory service with a deterministic in-memory mock. Keep the browser UI optimistic and roll it back when a reservation is rejected.

## Work breakdown

- [ ] **3.1 — Bootstrap the app:** Create the Vite + TypeScript shell, minimal sale page, and build/dev scripts. Confirm the app starts.
- [ ] **3.2 — Define contracts:** Specify product/inventory types, reservation token and expiry, checkout result, event types, and discriminated UI states before behavior. Define the legal state transitions and invariants, including `available >= 0` and `initialStock = available + activeReservations + sold`.
  - [x] Define lifecycle states/events and a pure transition function with illegal-transition rejection in `sale-state.ts`.
  - [ ] Define product and aggregate inventory-ledger contracts and their stock invariants.
- [x] **3.3 — Implement the anti-drift countdown:** Use `createAntiDriftTimer(onDisplayedSecondChange)` with the fixed target `2026-11-11T00:00:00+07:00`. Recompute from `Date.now()` deltas via `requestAnimationFrame`, callback only when the displayed second changes, pause while hidden, and recompute immediately on `visibilitychange` when visible.
- [ ] **3.4 — Implement the inventory reservation service:** Add an in-memory authoritative stock ledger that grants unique reservations only while stock remains. Make the stock check and decrement atomic within the service operation; attach an `expiresAt` time and ensure duplicate requests cannot reserve twice.
  - [x] Add server-clock snapshots, integer VND product pricing, stock-bounded idempotent reservations, and configurable rejection in `simulated-sale-api.ts`.
  - [x] Store each reservation's `expiresAt` and release due inventory through one shared ticker; API reads also sweep due locks.
  - [ ] Integrate API expiry and reservation results with the lifecycle state machine and optimistic UI rollback.
- [ ] **3.5 — Implement the reservation state machine:** Integrate the lifecycle contract with the inventory ledger; reject illegal transitions and assert stock invariants.
  - [x] Implement pure lifecycle transitions, expiry guards, checkout completion, and failure recovery in `sale-state.ts`.
  - [ ] Integrate transitions with inventory changes and assert ledger invariants.
- [ ] **3.6 — Add optimistic reservation UI behavior:** Update the displayed available count immediately on a reserve action. Confirm it when the service grants a lock; restore it exactly once on conflict or failure. Prevent duplicate submission while the same request is pending.
- [ ] **3.7 — Implement lock expiry:** Expire reservations from their absolute expiry time, return stock exactly once, and prevent checkout using an expired reservation. Keep expiry cleanup safe when the timer fires late or a reservation is already completed.
- [ ] **3.8 — Implement checkout:** Allow checkout only for a valid active reservation. Consume the lock on success. On a checkout failure, keep the lock active until its original expiry so the buyer can retry; then release it if still unused. Make repeated checkout submission idempotent.
- [ ] **3.9 — Build the sale interface:** Show product, remaining stock, countdown, reservation/lock status, and checkout/retry actions. Render state from the state machine; use semantic elements and delegated `click`/`keydown` listeners.
- [ ] **3.10 — Verify contention and lifecycle:** Test simultaneous attempts at stock boundaries, duplicate requests, reservation rejection, timer delay/background-tab behavior, expiry races, stale checkout, repeated actions, and teardown cleanup. Confirm inventory never becomes negative or exceeds its initial value.
- [ ] **3.11 — Write `AI_FAILURE_AUDIT.md`:** Record at least three real AI-generated flaws encountered in this implementation. For each, preserve the prompt or code context, explain the impact, cite how it was detected, and link the corrective change or test. Do not invent examples that were not generated and reviewed.
- [ ] **3.12 — Final audit and review:** Scan for banned patterns, inspect timers/listeners/locks for leaks, run the full build and tests, and record remaining limitations and evidence.

## Commit plan

Create at least eight separate commits, each containing one reviewed functional milestone:

1. `feat(app): bootstrap flash-sale demo`
2. `feat(types): define sale and reservation contracts`
3. `feat(timer): add drift-resistant countdown`
4. `feat(inventory): add atomic reservation service`
5. `feat(state): enforce reservation lifecycle transitions`
6. `feat(ui): add optimistic reservation flow`
7. `feat(checkout): enforce active inventory locks`
8. `test(concurrency): cover contention and expiry races`
9. `docs(audit): record verified AI failure modes`
10. `test(audit): verify final sale flow and resource cleanup`

The list is a minimum checkpoint plan; each commit must contain only changes that have been reviewed and verified.

## Review focus

- **Clock delay or background tab:** Recompute from the absolute deadline so delayed frames do not accumulate countdown drift.
- **Two buyers reserve the last unit together:** The authoritative service grants at most one lock; the losing optimistic UI rolls back.
- **Expiry races checkout:** Checkout validates the lock against current time and state; an expired or already consumed token cannot complete.
- **Duplicate reserve/checkout actions:** Request identity and state guards prevent double-decrement or double-consumption.
- **Unmount/teardown during active work:** Stop the countdown and release scheduled callbacks/listeners; do not leave stale UI updates.

## Acceptance checklist

- [ ] Runs as a Vite + TypeScript application.
- [ ] Countdown displays millisecond precision from `Date.now()` deltas and uses `requestAnimationFrame`, not a decrementing interval.
- [ ] Inventory reservations are concurrency-safe; stock never goes below zero or above its initial value.
- [ ] Optimistic stock changes roll back on rejected reservations.
- [ ] Reservation locks expire and release inventory once; expired locks cannot check out.
- [ ] Checkout accepts only a valid active lock and handles repeat submission safely.
- [ ] State transitions are typed and invalid transitions are rejected.
- [ ] `AI_FAILURE_AUDIT.md` records at least three verified AI-generated flaws with detection evidence and fixes.
- [ ] At least eight discrete Conventional Commits are present.
- [ ] No banned patterns from `project-rules.md` are present.
- [ ] Tests cover contention, expiry, timer drift, checkout races, and teardown.
- [ ] AI-generated changes have been reviewed and verified before acceptance.

## Implementation note

The slide requires a sale simulation and specifies the timer and inventory-lock behavior, but does not specify a production backend, product catalog, reservation TTL, or exact checkout error policy. Under the stated mock-service assumption, choose these as explicit configuration values and record them in the README; do not imply that client-side code alone provides production-grade distributed inventory guarantees.

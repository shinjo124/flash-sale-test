# Project Rules

## Stack
- Vite + TypeScript.

## Banned patterns
- Do not use `var`; use `const` or `let`.
- Do not use `keypress`, `keyCode`, or inline event handlers such as `onclick`.
- Do not use raw `innerHTML`; build DOM safely or use framework rendering.

## AI workflow
- One AI prompt = one sub-task. Do not ask AI to implement multiple tasks at once.
- Verify every AI output before accepting it, including reviewing the diff and checking behavior.

## Homework scope
- Simulate a high-concurrency flash sale with a drift-resistant millisecond countdown based on Date.now() deltas and a finite-state inventory reservation, lock-expiry, and checkout flow.
- Include AI_FAILURE_AUDIT.md documenting at least three AI-generated flaws, and make at least eight discrete Conventional Commits.

# ADR 0006: Select gemini mode after starting a new chat

- Status: Accepted
- Date: 2026-06-25

## Context

`gemini ask --new true` starts a fresh chat before sending. If model/thinking
selection happened before `startNewGeminiChat`, the page rebuild from opening a
new chat could re-render or drop the selection.

## Decision

When both `--new true` and `--model` / `--thinking` are passed, the execution
order is:

1. `startNewGeminiChat(page)`
2. `selectGeminiMode(page, { model, thinking })` (validate + select)
3. `readGeminiSnapshot(page)`
4. `sendGeminiMessage(page, prompt)` and wait for the response

## Consequences

- Mode selection is applied to the fresh chat's current UI state, which is the
  state the prompt is actually sent from.
- Deterministic ordering that is easy to test.
- Validation of unavailable values still happens before the prompt is sent (step
  2 throws before step 4).

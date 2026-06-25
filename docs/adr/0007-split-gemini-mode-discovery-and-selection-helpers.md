# ADR 0007: Split gemini mode discovery and selection into two helpers

- Status: Accepted
- Date: 2026-06-25

## Context

`opencli gemini models` needs to read-only list the available model/thinking
values. `gemini ask --model/--thinking` needs to validate a requested value
against the same set and then drive the UI to select it. If discovery and
selection were a single function, the read-only `models` command would either
carry selection side-effects or duplicate the discovery DOM logic, risking
"what `models` shows" diverging from "what `ask` accepts".

## Decision

Implement two helpers in `clis/gemini/utils.js`:

- `getGeminiModeOptions(page)` — read-only. Returns the available model values
  and, per model, the available thinking values (plus labels/`selected` flags as
  needed). Used by `gemini models`.
- `selectGeminiMode(page, { model, thinking })` — calls `getGeminiModeOptions`
  to validate the requested values (throwing `ArgumentError` per ADR 0004 when
  unavailable), then drives the web UI to select them. Used by `gemini ask`.

## Consequences

- Single discovery code path: `models` output and `ask` validation can never
  disagree.
- `models` is purely read-only (no UI mutation), matching its `read` semantics.
- Selection logic is isolated and independently testable.

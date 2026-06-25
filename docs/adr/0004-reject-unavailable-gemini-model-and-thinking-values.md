# ADR 0004: Reject unavailable gemini model and thinking values

- Status: Accepted
- Date: 2026-06-25

## Context

If a user passes `--model` / `--thinking` with a value that is not currently
available on the web app (typo, retired model, account/region difference),
silently falling back to the default model/thinking would mislead the user into
thinking their selection took effect.

## Decision

When `--model` or `--thinking` is not in the currently-available values (from
`getGeminiModeOptions`), throw a typed `ArgumentError`. The error message lists
the currently-available values and suggests running `opencli gemini models`. No
silent fallback.

## Consequences

- User input errors surface immediately and are actionable.
- Consistent with the OpenCLI typed-error convention (`ArgumentError` for bad
  user input); no silent `return []` / sentinel row / silent clamp.
- The available-values list must be readable before sending the prompt, so
  validation happens in `selectGeminiMode` before any prompt is sent.

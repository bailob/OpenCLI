# ADR 0002: Use web-matching gemini model values, discovered via `gemini models`

- Status: Accepted
- Date: 2026-06-25

## Context

Model names on the Gemini web app are versioned (`3.1-flash-lite`, `3.5-flash`,
`3.1-pro`) and can change over time. If the CLI hard-coded a fixed list or
accepted short aliases (`pro`, `flash`), it would drift from the web UI and users
could not tell which value to pass.

## Decision

- `gemini ask --model <value>` accepts **only** values that match the web UI at
  run time. Short aliases are **not** accepted.
- Provide a read-only discovery command `opencli gemini models` that lists each
  currently-available model together with the thinking-level values that model
  supports (columns: `model`, `label`, `selected`, `thinkingValues`, optionally
  `thinkingLabels`).
- `gemini models` is the single source of truth for what `ask --model` /
  `--thinking` will accept.

## Consequences

- Values are auditable and align with what the user sees/tests on the web.
- No alias table to maintain; the web UI is the authority.
- Users must run `gemini models` to discover valid values (acceptable trade-off;
  unavailable values are rejected with a helpful error — see ADR 0004).

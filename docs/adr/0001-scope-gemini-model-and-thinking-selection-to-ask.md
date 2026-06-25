# ADR 0001: Scope gemini model and thinking selection to `ask`

- Status: Accepted
- Date: 2026-06-25

## Context

The Gemini web app lets users pick a model (e.g. `3.1-flash-lite`, `3.5-flash`,
`3.1-pro`) and a thinking level (standard / extended). We want to expose this
from the CLI. Several Gemini commands are `write` commands (`ask`, `image`,
`deep-research`), and exposing model/thinking on all of them at once would
expand the test matrix and risk interactions with each command's extra
tooling/image/confirm flows.

## Decision

Implement the model/thinking selection as a **shared** helper in `utils.js`, but
expose CLI parameters **only** on `gemini ask` in the first phase. `image` and
`deep-research` are explicitly out of scope for now.

## Consequences

- Smallest verifiable surface for this issue (`ask`).
- The shared helper can be reused later for `deep-research` without re-writing
  DOM logic.
- Future expansion to other write commands is a separate, deliberate change.

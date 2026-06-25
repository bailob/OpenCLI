# ADR 0005: Do not restore gemini mode after `ask`

- Status: Accepted
- Date: 2026-06-25

## Context

Gemini's model/thinking selection is web-session UI state. After `gemini ask`
sends a prompt with `--model` / `--thinking`, restoring the previous selection
would require extra UI operations during/after response generation, adding
failure points and nondeterministic behavior (e.g. switching model mid-stream).

## Decision

- Passing `--model` / `--thinking` switches the web UI to that selection and
  **leaves it there** after the prompt. The prior web state is not restored.
- When a dimension (`model` or `thinking`) is not passed, the command does not
  change that dimension; it respects the current web state.

## Consequences

- Clear contract: `--model/--thinking` is an explicit switch of current session
  UI state; omitting them is "leave it alone".
- Fewer UI operations and failure points during response generation.
- Users who want a specific model for a one-off ask and then revert must do so
  explicitly (acceptable; matches how a human would use the web UI).

# ADR 0003: Use stable English gemini thinking values

- Status: Accepted
- Date: 2026-06-25

## Context

The Gemini web app localizes the thinking-level labels (e.g. "标准/扩展" in
Chinese, "Standard/Extended" in English). If the CLI `--thinking` parameter
followed the localized label, scripts would not be portable across browser
locales.

## Decision

- `gemini ask --thinking` accepts only the stable English canonical values
  `standard` and `extended`.
- `opencli gemini models` outputs `thinkingValues` (canonical) and may
  additionally include `thinkingLabels` (localized) so output still "matches the
  web" for the user.

## Consequences

- Scripts using `--thinking standard` / `--thinking extended` are locale-independent.
- Discovery output keeps a human-readable localized label for cross-checking
  with the web UI.

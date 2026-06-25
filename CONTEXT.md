# Gemini Adapter — Context

Single-context glossary for the `gemini` adapter (`clis/gemini/`). Decisions are
recorded as ADRs under `docs/adr/`. Read this first; read ADRs when a term says
"see ADR 00NN".

## Gemini Ask Command

`opencli gemini ask <prompt>` sends a prompt to the Gemini web app and returns
only the assistant reply. It is a `write` command (`browser: true`,
`siteSession: 'persistent'`). Implementation: `clis/gemini/ask.js`; helpers in
`clis/gemini/utils.js` (`startNewGeminiChat`, `readGeminiSnapshot`,
`sendGeminiMessage`, `waitForGeminiSubmission`, `waitForGeminiResponse`).

## Gemini Model Choice

The Gemini web app exposes a model picker with values such as `3.1-flash-lite`,
`3.5-flash`, `3.1-pro` (versioned, matching the web UI exactly). The CLI accepts
**only** values that match the web UI at run time; short aliases like `pro` /
`flash` are **not** accepted. See ADR 0002.

## Gemini Thinking Level

The web app exposes a thinking-level control. The CLI uses **stable English**
canonical values `standard` / `extended`, independent of the browser locale (the
web UI may show localized labels like 标准/扩展). Discovery output may additionally
show the localized label. See ADR 0003.

## Gemini Models Command

`opencli gemini models` is the **read-only discovery** command: it lists each
currently-available model together with the thinking-level values that model
supports. Output columns include `model`, `label`, `selected`, `thinkingValues`
(and optionally `thinkingLabels`). It is the single source of truth for what
`gemini ask --model` / `--thinking` will accept. See ADR 0002.

## Mode discovery vs. selection

Two helpers in `utils.js`:

- `getGeminiModeOptions(page)` — read-only: returns the available model +
  thinking values from the current web state.
- `selectGeminiMode(page, { model, thinking })` — validates the requested values
  against `getGeminiModeOptions` and drives the web UI to select them.

`gemini models` uses only `getGeminiModeOptions`; `gemini ask` uses both. See
ADR 0007.

## Behavior on ask with `--model` / `--thinking`

- Passing `--model` / `--thinking` switches the web UI to that selection and
  **leaves it there** after the prompt; the prior web state is not restored. See
  ADR 0005.
- When `--new true` is also passed, order is: `startNewGeminiChat` → select
  model/thinking → `readGeminiSnapshot` → send prompt. See ADR 0006.
- An unavailable `--model` / `--thinking` value throws a typed `ArgumentError`
  listing the currently-available values and suggesting `opencli gemini models`;
  no silent fallback. See ADR 0004.

## Scope

Model/thinking selection is exposed **only** on `gemini ask` in the first phase
(the shared helpers are reusable, but `image` / `deep-research` are out of
scope for now). See ADR 0001.

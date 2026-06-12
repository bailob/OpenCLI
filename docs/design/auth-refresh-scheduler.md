# Auth Refresh Scheduler

This document defines the first OpenCLI App integration for automatic auth/session keepalive.

## Scope

The first MVP is App-alive only: the App stays running in the background and invokes a short-lived core command around the configured daily schedule. App quit, machine sleep, offline recovery, and launchd catch-up are intentionally out of scope for this phase.

The primitive is auth refresh/touch, not daily `whoami`:

- `whoami` verifies identity and can be slow or navigation-heavy.
- `auth refresh` tries an explicit adapter refresh hook first.
- If no explicit hook exists, it touches the site origin and verifies with `quickCheck`.
- Sites without either capability are marked `unsupported`.

## Files

OpenCLI App owns the config file:

```text
~/Library/Application Support/OpenCLI App/auth-refresh-config.json
```

OpenCLI core owns the run-state file:

```text
~/Library/Application Support/OpenCLI App/auth-refresh-state.json
```

The scheduler command reads config and writes run state. The App should only read run state.

## Command

```bash
opencli auth refresh-scheduled
```

Options:

- `--site <sites>` limits the scheduler to a comma-separated site set.
- `--all` ignores schedule and backoff, but still respects enabled/disabled config.
- `--timeout <seconds>` sets the per-site refresh timeout.
- `--config-path <path>` and `--run-state-path <path>` are for App tests and local smoke tests.
- `--jitter-minutes <minutes>` controls stable per-site schedule jitter; default is 120.

## Due Calculation

For each browser-backed `whoami` command:

1. The site must be enabled by App config. A per-site override wins; otherwise the global switch applies.
2. `unsupported` sites are skipped after first detection.
3. Sites with `consecutiveFailures >= 3` are skipped until forced or reset by App/user action.
4. The site is due when its last attempt is older than today's scheduled time plus stable per-site jitter.

The command processes due sites serially and exits. It does not sleep for hours.

## State Semantics

Run-state timestamps use the App schema format: `@<unix-seconds>`.

Per-site statuses:

- `touched`: origin touch plus verification succeeded.
- `refreshed`: explicit adapter refresh hook succeeded.
- `not_logged_in`: session is missing or expired; user must run login.
- `error`: transient or unexpected failure.
- `unsupported`: no refresh/touch capability exists for the site.
- `pending`: reserved for App display when no attempt has run yet.

`lastFullRun` records the scheduler invocation time. `lastFullRunSummary` is a short human-readable status count for Settings UI.

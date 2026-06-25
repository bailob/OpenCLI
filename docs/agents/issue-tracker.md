# Issue tracker: Multica

Issues and PRDs for this repo live in Multica Issues. Use the `multica` CLI for all issue-tracker operations. GitHub is used only for code hosting, branches, commits, and pull requests.

## Core conventions

- Prefer `--output json` when reading issue data so agents can parse it reliably.
- For long descriptions or comments, write the body to a temporary UTF-8 markdown file and pass `--description-file <path>` or `--content-file <path>`. Do not inline multi-line agent-authored text in shell flags.
- Do not start work merely because an issue exists. Agents start only after an explicit user instruction, normally by assigning an issue to an agent and moving it to `todo`.
- Use issue identifiers from command output in user-facing summaries.

## Reading issues and comments

- **Read an issue**: `multica issue get <issue-id-or-key> --output json`
- **Read metadata**: `multica issue metadata list <issue-id-or-key> --output json`
- **Read recent comment threads**: `multica issue comment list <issue-id-or-key> --recent 10 --output json`
- If more history is needed, page older threads with the `Next thread cursor` values printed by the CLI, using matching `--before <timestamp> --before-id <uuid>` flags.
- Use `--thread <comment-id>` when following a specific conversation.

## Creating issues

- **Create a PRD parent issue**:
  `multica issue create --title "..." --description-file ./prd.md --status in_review [--assignee <human-or-owner>]`
- **Create a child implementation issue**:
  `multica issue create --title "..." --description-file ./issue.md --parent <prd-issue-id> --stage <n> --status backlog`
- Create child issues under their PRD parent. Do not assign agents and do not use `todo` unless the user explicitly asks to launch execution.

## Comments

- **Add a comment**: `multica issue comment add <issue-id-or-key> --content-file ./comment.md`
- **Reply in a thread**: add `--parent <comment-id>`.
- Use comments for final results, user-visible summaries, blockers, and review notes.

## Status changes

Common statuses used by these skills:

- `in_review` — waiting for human review or acceptance.
- `backlog` — approved or parked work that should not start automatically.
- `todo` — ready to start now; assigning an agent and moving to `todo` can trigger execution.
- `in_progress` — actively being worked.
- `blocked` — cannot proceed without external input.
- `done` — accepted/complete.
- `cancelled` — intentionally not proceeding.

Use `multica issue status <issue-id-or-key> <status>` for simple status changes, or `multica issue update <issue-id-or-key> --status <status>` when updating other fields too.

## Parent/child issues and stages

- A PRD should be the parent issue for its implementation slices.
- Child issues represent vertical slices, not horizontal layer tasks.
- Use `--stage <n>` to encode dependency groups:
  - Children in the same stage may run in parallel.
  - Higher stages wait for lower stages to finish.
  - Stage `1` is the first group.
- `/to-issues` should create all child issues as `backlog`. A later explicit user instruction chooses which child issues to assign and move to `todo`.
- After `/to-issues` publishes approved children, move the parent PRD issue to `backlog`.
- When all child issues are terminal (`done` or `cancelled`), the parent PRD should return to `in_review` for final human review, then move to `done` after acceptance.

## When a skill says "publish to the issue tracker"

Create or update Multica Issues with the `multica` CLI. For PRDs, create a parent issue in `in_review`. For implementation slices, create child issues under the PRD parent in `backlog`.

## When a skill says "fetch the relevant ticket"

Run `multica issue get <issue-id-or-key> --output json` and read recent comments with `multica issue comment list <issue-id-or-key> --recent 10 --output json`.

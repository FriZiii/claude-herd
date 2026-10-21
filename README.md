# claude-herd

Multi-agent Claude Code setup for [herdr](https://herdr.dev). A **coordinator** plans features with you. Each feature goes to a **manager** in its own herdr tab. The manager hands tickets to **workers** (one ticket = one worker = one git worktree) and sends each finished ticket to an independent **reviewer**. Only the coordinator talks to you; your decisions are collected through `decide`, a question form in a browser tab.

## Requirements

- Windows, PowerShell 7 (`pwsh`), Node.js, git, Chrome (optional; `decide` falls back to the default browser)
- herdr with the Claude integration (`herdr integration status` → `claude: current`)
- Optional, for `pocock` mode: [mattpocock/skills](https://github.com/mattpocock/skills) v1.1+ (`grill-with-docs`, `to-spec`, `to-tickets`, `implement`, `code-review`, `setup-matt-pocock-skills`), and `/setup-matt-pocock-skills` run in the repo (tracker in `docs/agents/issue-tracker.md`)

## Install

```powershell
pwsh -NoProfile -File install.ps1
```

The script is idempotent; rerun it after pulling or moving the repo. It:

- creates junctions `~/.claude/herd` and `~/.claude/skills/{coordinator,manager,decide}` → this repo (an existing directory is moved to `~/.claude/skills/.trash`, never deleted),
- writes `claude-md/herd.md` into `~/.claude/CLAUDE.md` between `<!-- herd:begin/end -->` markers,
- registers the `PreToolUse` hook `hooks/herd-guard.ps1` in `~/.claude/settings.json` (backup: `settings.json.bak-*`),
- dot-sources `powershell/herd.ps1` from `$PROFILE` (functions `coord`, `mgr`).

## Usage

Inside herdr, in the repo's main checkout:

| Command | Mode |
|---|---|
| `coord pocock` | With Matt Pocock's skills: `/grill-with-docs` → `/to-spec` → `/to-tickets`, workers run `/implement`, reviewers run `/code-review`. Asks for `/setup-matt-pocock-skills` when the repo is not configured. |
| `coord plain` | Herd only: the coordinator grills you, writes the spec and tickets to `.scratch/<f>/`; workers and reviewers follow `herd/WORKER.md` and `herd/REVIEWER.md`. |
| `coord` | The coordinator asks which mode to use. |

The coordinator then starts a manager for each feature in a new tab, relays the managers' questions to you, and runs the app from a separate worktree for your manual test once a feature is ready. Merging into the base branch and pushing happen only on your decision.

`mgr <feature>` restarts a crashed manager by hand, from its `<repo>.worktrees/<feature>/_feat` directory.

## Contents

| Path | What |
|---|---|
| `herd/PROTOCOL.md` | roles, names, paths, branches, modes, exchange file formats |
| `herd/WORKER.md` | worker rules; in `plain` mode also the implementation steps |
| `herd/REVIEWER.md` | the reviewer's task in `plain` mode |
| `herd/bin/` | `herd-watch.mjs` (outbox watcher), `herd-lock.mjs` (heavy-build lock) |
| `hooks/herd-guard.ps1` | limits file writes per `HERD_ROLE` |
| `skills/coordinator`, `skills/manager` | role skills (user-invoked only) |
| `skills/decide` | asks the user batches of questions through a browser tab |
| `tests/herd-guard.tests.ps1` | `pwsh -NoProfile -File tests/herd-guard.tests.ps1` |

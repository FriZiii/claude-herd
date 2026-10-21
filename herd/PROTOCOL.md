# Herd protocol

Shared reference for the herd roles (`coordinator`, `manager`, `worker`, `reviewer`). The role skills point here; this file is the single source of truth for names, paths and file formats.

## Roles

| Role | herdr name | Where it runs | `HERD_ROLE` |
|---|---|---|---|
| coordinator | `coordinator` | first tab, repo's main checkout | `coordinator` |
| manager | `mgr-<f>` | own tab, feature worktree `_feat` | `manager` |
| worker | `w-<f>-<nn>` | pane in the manager's tab, ticket worktree | `worker` |
| reviewer | `rev-<f>` | pane in the manager's tab, the reviewed ticket's worktree | `reviewer` |

`<f>` is the feature slug: `[a-z][a-z0-9-]{0,19}`. `<nn>` is the ticket number, two digits (local tracker `NN`, or the issue number). herdr names must match `[a-z][a-z0-9_-]{0,31}`.

The PreToolUse hook `hooks/herd-guard.ps1` (agents repo, registered by `install.ps1`) limits Edit/Write by `HERD_ROLE`: coordinator and manager write only `GLOSSARY*.md`, `docs/adr/**`, `docs/agents/**`, `.scratch/**`, the herd dir and the scratchpad; reviewer writes only the herd dir and the scratchpad; worker is unrestricted.

## Paths

`<repo>` is the main checkout. Everything else sits beside it:

```
<repo>.worktrees/
├── _herd/                     herd dir (exchange)
│   ├── heavy.lock             heavy-build lock (herd-lock.mjs)
│   ├── app.json               coordinator: the running app's tab id and feature
│   └── <f>/
│       ├── brief.md           coordinator → manager: the hand-off
│       ├── status.md          manager: ticket board
│       ├── outbox/            manager → coordinator (processed files move to outbox/done/)
│       ├── inbox/             coordinator → manager
│       ├── workers/<nn>.brief.md, <nn>.report.md
│       └── reviews/<nn>.md
├── _test/                     coordinator: detached checkout the app runs from
└── <f>/
    ├── _feat/                 branch feat/<f> (manager's cwd, merge target)
    └── <nn>/                  branch wip/<f>/<nn> (one worker)
```

Branches: `feat/<f>` from the base branch; `wip/<f>/<nn>` from `feat/<f>`. Merges into `feat/<f>` use `git merge --no-ff`. Only the user decides a merge into the base branch or a push.

## Scripts

- `node ~/.claude/herd/bin/herd-watch.mjs <herd-dir>`: waits until a file appears in any `<herd-dir>/*/outbox/`, prints `HERD_OUTBOX <path>` per file and exits. Run it in the background.
- `node ~/.claude/herd/bin/herd-lock.mjs acquire|release <herd-dir> <agent-name>`: the heavy-build lock. `acquire` waits until the lock is free (a lock older than 60 min is stale), prints `HERD_LOCK_ACQUIRED`. Always `release` after the heavy command, red or green.

## Modes

The coordinator picks the mode per session (`coord pocock`, `coord plain`, or asks); each feature's `brief.md` starts with `Mode: pocock|plain` and the manager follows it.

| | `pocock` (mattpocock/skills) | `plain` (herd only) |
|---|---|---|
| Planning | user types `/grill-with-docs`, `/to-spec`, `/to-tickets` | coordinator grills via `decide`, writes spec and tickets |
| Tracker | per `docs/agents/issue-tracker.md` | `.scratch/<f>/spec.md`, `.scratch/<f>/issues/NN-slug.md` |
| Worker | `/implement <ticket>` + `WORKER.md` | prompt + `WORKER.md` § Plain mode |
| Reviewer | `/code-review feat/<f>` | prompt + `REVIEWER.md` |

### Plain spec: `.scratch/<f>/spec.md`

Sections: `Problem`, `Solution`, `User stories` (numbered, "As a <actor>, I want <feature>, so that <benefit>"), `Implementation decisions` (modules, interfaces, contracts; no file paths), `Testing decisions` (seams, prior art), `Out of scope`, `Decision log` (decisions taken during implementation: date, question group, decision).

### Plain ticket: `.scratch/<f>/issues/NN-slug.md`

```markdown
# NN <title>
Status: open | done
Blocked by: none | 01, 03

## What it delivers
<the end-to-end behaviour, demoable on its own>

## Acceptance criteria
- [ ] …

## Notes
<spec sections, ADRs, decisions from the Decision log>
```

## herdr from Git Bash

Run herdr commands in the Bash tool. Git Bash rewrites an argument that starts with `/` into a Windows path (`/implement` → `E:/Programs/Git/implement`), so every `herdr agent prompt` whose text starts with a slash command carries `MSYS_NO_PATHCONV=1`:

```bash
MSYS_NO_PATHCONV=1 herdr agent prompt w-<f>-<nn> "/implement …" --wait
```

## Questions: manager → coordinator

A file `<herd-dir>/<f>/outbox/q-<nnn>.json` in exactly the `decide` questions format (`~/.claude/skills/decide/SKILL.md`), `<nnn>` counting up per feature from `001`:

```json
{
  "groups": [
    { "id": "mgr-<f>-<nnn>", "label": "<f>: <short topic>",
      "source": { "type": "subagent", "name": "mgr-<f>: ticket <nn> <title>", "id": "mgr-<f>" } }
  ],
  "questions": [
    { "id": "<f>-Q<k>", "group": "mgr-<f>-<nnn>", "title": "…", "body": "…",
      "context": "**Blocks:** ticket <nn> (<title>); other tickets keep going.\n\n<evidence: review excerpt, spec quote, paths>",
      "type": "single", "options": [ … ], "recommended": "…" }
  ]
}
```

- One group per file, written in the user's language. Every question has `recommended`, and its `context` opens with the **Blocks** line.
- Re-asking (after `explain`/`skip`) is a new `q-<nnn>.json` that reuses the same group id and question id, with `explanation` filled.

## Answers: coordinator → manager

The coordinator appends the `answers.jsonl` lines of `mgr-<f>-*` groups **verbatim** to `<herd-dir>/<f>/inbox/answers.jsonl` and rings the manager:

```
herdr agent prompt mgr-<f> "HERD_ANSWERS <herd-dir>/<f>/inbox/answers.jsonl groups=<id>[,<id>]"
```

Each line is `{ "group", "label", "at", "answers": [ { "id", "status", "label", "value", "other", "note", "explain", "recommended" } ], "text" }`. `status`: `answered` | `explain` | `skip` | `open`.

## Other messages

Files in `outbox/` (manager → coordinator, picked up by the watcher):

- `ready-<n>.md`: feature ready for a manual test. Sections: `Branch`, `Tickets` (merged), `Full suite` (command + result), `To test` (checklist from the spec's user stories).
- `report-<n>.md`: anything the user should read that is not a question (failure, stalled agent, finished feature after merge). Shown to the user verbatim.

Doorbells into a manager (coordinator → manager; text typed into its prompt):

- `HERD_ANSWERS <path> groups=<ids>`: answers ready.
- `HERD_BUG <herd-dir>/<f>/inbox/bug-<n>.md`: the user found a bug in the manual test.
- `HERD_MSG <text>`: a free-form instruction from the user, relayed verbatim.

## Worker report

`<herd-dir>/<f>/workers/<nn>.report.md`, written by the worker at the end of every turn:

```markdown
# <nn> <ticket title>
Status: done | question | blocked
## Commits
<git log --oneline feat/<f>..HEAD>
## Verified
<commands run and results>
## Not verified
<what was skipped and why>
## Question
<only for status question/blocked: the question, options, the worker's recommendation>
```

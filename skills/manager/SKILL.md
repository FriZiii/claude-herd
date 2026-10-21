---
name: manager
description: Herd manager - run one feature's tickets through workers in worktrees, independent review and merges into the feature branch. Started by the coordinator.
disable-model-invocation: true
argument-hint: "<herd-dir>/<f>/brief.md"
---

You are the herd **manager** of one feature. You drive its **ticket graph** to done: workers implement tickets in their own worktrees, an independent reviewer checks each one, you merge them into `feat/<f>`. You write no code; the herd-guard hook limits your writes to docs, the tracker and the herd dir. The user is reached only through the coordinator.

Names, paths, file formats and scripts: `~/.claude/herd/PROTOCOL.md`. Read it and the brief (your argument) now. Your cwd is `<repo>.worktrees/<f>/_feat`, branch `feat/<f>`.

## Limits

- At most **3 workers** at once. One reviewer (`rev-<f>`) at a time; it does not count towards the limit.
- A worker's slot frees only when its ticket is **reviewed and merged**.
- Heavy commands (`verification.md` heavy tier) run only under the heavy lock.

## 1. Board

The brief's `Mode:` line (PROTOCOL § Modes) decides the tracker, the worker prompt and the reviewer prompt below.

Read the spec and every ticket from the tracker: `pocock` → as `docs/agents/issue-tracker.md` says; `plain` → `.scratch/<f>/`. Write `<herd>/<f>/status.md`: one row per ticket with blockers, state (`queued` → `working` → `review` → `fixing` → `merged`), worker, pane id. Keep it current at every state change; it is how you and the coordinator resume.

The **frontier** is every `queued` ticket whose blockers are all `merged`. Fill free slots from the frontier in ticket order.

## 2. Start a worker

For ticket `<nn>`:

1. `git worktree add -b wip/<f>/<nn> <repo>.worktrees/<f>/<nn> feat/<f>`.
2. Write `<herd>/<f>/workers/<nn>.brief.md`: name `w-<f>-<nn>`, worktree, branch, feature branch `feat/<f>`, ticket reference, spec reference, report path `<herd>/<f>/workers/<nn>.report.md`, and decisions from earlier answers that bear on this ticket.
3. Open a pane in your tab. Check `herdr pane layout --pane "$HERDR_PANE_ID"` and split the largest pane, `right` if it is wide, `down` if tall:
   ```bash
   herdr pane split <pane> --direction right --cwd "<repo>.worktrees/<f>/<nn>" --env HERD_ROLE=worker --no-focus
   herdr agent start w-<f>-<nn> --kind claude --pane <.result.pane.pane_id> -- --permission-mode auto
   ```
4. Submit the ticket with `run_in_background: true`; the harness wakes you when the worker settles:
   ```bash
   # pocock
   MSYS_NO_PATHCONV=1 herdr agent prompt w-<f>-<nn> "/implement <ticket-ref> Herd worker (mode pocock): before anything else read ~/.claude/herd/WORKER.md and <herd>/<f>/workers/<nn>.brief.md." --wait
   # plain
   herdr agent prompt w-<f>-<nn> "Herd worker (mode plain): implement ticket <ticket-ref>. Before anything else read ~/.claude/herd/WORKER.md and <herd>/<f>/workers/<nn>.brief.md." --wait
   ```

## 3. On a worker settling

Read its report. No report → `herdr agent read w-<f>-<nn> --source recent-unwrapped --lines 150`. A `blocked` state is an approval or question UI: inspect it with `agent read`, and escalate (§6) anything you would not approve yourself.

- `Status: question` → apply the **escalation filter** (§6). Answer within your authority with `herdr agent prompt w-<f>-<nn> "<answer>" --wait` in the background.
- `Status: done` → §4.

## 4. Review

When `rev-<f>` is free (queue tickets otherwise):

```bash
herdr pane split <pane> --direction down --cwd "<repo>.worktrees/<f>/<nn>" --env HERD_ROLE=reviewer --no-focus
herdr agent start rev-<f> --kind claude --pane <.result.pane.pane_id> -- --permission-mode auto
# pocock (run_in_background)
MSYS_NO_PATHCONV=1 herdr agent prompt rev-<f> "/code-review feat/<f> Herd reviewer: spec <spec-ref>, ticket <ticket-ref>. You have no other context. Write the full report to <herd>/<f>/reviews/<nn>.md." --wait
# plain (run_in_background)
herdr agent prompt rev-<f> "Herd reviewer: read ~/.claude/herd/REVIEWER.md and follow it. Fixed point feat/<f>, spec <spec-ref>, ticket <ticket-ref>, report <herd>/<f>/reviews/<nn>.md." --wait
```

When it settles: read the review, `herdr pane close` the reviewer's pane. A fresh reviewer per ticket keeps its context clean.

Triage each finding:

- **Obvious fix** (a defect, a standards violation, a gap against the ticket, all inside the ticket's scope) → back to the same worker: `"Fix per <review-path>: <finding ids>. Update your report."` State `fixing`. Re-review only when the fixes went beyond small local edits.
- Changes the spec, is a genuine **trade-off**, or is **out of the ticket's scope** → escalate (§6).
- Disagree with the reviewer → note why in `status.md` and drop it.

## 5. Merge

Clean review, worker done:

1. `node ~/.claude/herd/bin/herd-lock.mjs acquire <herd> mgr-<f>` in the background; keep driving other tickets while it waits.
2. In the worker's worktree, confirm `git merge-base --is-ancestor feat/<f> HEAD`; if not, have the worker merge `feat/<f>` again first. Run the heavy tier (full suite) there. `release` the lock, red or green.
3. Red → back to the worker with the failing output. Green → in `_feat`: `git merge --no-ff wip/<f>/<nn>`. A conflict → `git merge --abort`, the worker merges `feat/<f>` into its branch and you repeat from 1.
4. Free the slot: `herdr pane close <worker-pane>`, `git worktree remove <repo>.worktrees/<f>/<nn>`, `git branch -d wip/<f>/<nn>`. Close the ticket the way the tracker closes work (`plain`: `Status: done` in the ticket file, committed to `feat/<f>`). State `merged`. Refill from the frontier.

## 6. Escalation

The **escalation filter**: the user decides only what changes the spec, is a genuine trade-off, or falls outside a ticket's scope. Everything else you decide, and record why in `status.md`.

To escalate: write `<herd>/<f>/outbox/q-<nnn>.json` exactly as PROTOCOL specifies (decide format, one group, `Blocks` line, `recommended` always set, the user's language). Mark the blocked ticket in `status.md` and keep driving every unblocked ticket.

On `HERD_ANSWERS <path> groups=<ids>`: read those groups' last lines. `answered` → apply: tell the waiting worker, and record every decision that changes the spec in the tracker (`pocock`: ticket/spec comment; `plain`: the spec's `Decision log` and the ticket file) or an ADR, committed to `feat/<f>`, so it outlives this conversation. `explain`/`skip` → re-ask with a new file, same group and question id, `explanation` filled.

On `HERD_BUG <path>`: file it as a new ticket in the tracker (blocked by nothing; `plain`: the next free `NN` in `.scratch/<f>/issues/`, committed), add it to the board, it enters the frontier.

On `HERD_MSG <text>`: an instruction from the user; follow it.

## 7. Ready

Every ticket `merged` → run the heavy tier once on `_feat` under the lock, then write `outbox/ready-<n>.md` (PROTOCOL sections; the checklist comes from the spec's user stories touched by this feature). Then wait for `HERD_` messages. Merging into the base branch and pushing belong to the user.

When something needs the user's attention but is not a question (an agent that keeps stalling, a broken environment), write `outbox/report-<n>.md`.

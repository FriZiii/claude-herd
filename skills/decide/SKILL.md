---
name: decide
description: Ask the user 2+ questions through a persistent local browser tab instead of the terminal. Use whenever you are about to ask several questions at once - a grilling round, a coordinator's questions about subagent reports, any batch of decisions.
---

Move questions out of the terminal into one browser tab that stays open for the whole session. Questions live in **groups** (one tab each). The user answers and submits one group at a time; you process that group while they keep answering the others. A single question stays in the terminal.

The calling skill (grilling, chief-of-staff, anything else) still decides _what_ to ask and what to recommend. This skill only changes _how_ questions are delivered and answers come back.

The CLI is `node ~/.claude/skills/decide/decide.mjs <command> <session-dir> …`. Use one **session dir** for the whole session: `<scratchpad>/decide` (OS temp dir + `/decide-<random>` when the session has no scratchpad). One session dir = one server = one tab.

## 1. Ask: write a questions file and push it

Write a JSON file (anywhere, e.g. `<session-dir>/ask-<n>.json`) and run `decide.mjs ask <session-dir> <file>` in the foreground. It starts the server if needed, adds the questions, and opens the tab in Chrome (the default browser if Chrome is missing) only when no tab is connected; otherwise they appear live in the open tab. Exit code 2 lists every problem with the file: fix and rerun. Tell the user in one line where the questions are (the `DECIDE_URL` line). Write the question content in the user's language.

```jsonc
{
  "title": "Coordinator: orders",           // optional; tab and header title
  "groups": [                               // optional on later asks for groups that already exist
    {
      "id": "api", "label": "Subagent API", "description": "markdown, optional",
      "source": { "type": "subagent", "name": "API: /orders pagination", "id": "a3f9c1" }
    }
  ],
  "questions": [
    {
      "id": "Q7",                            // a question with an id already pending in its group is replaced
      "group": "api",                        // omit groups entirely for a single-theme batch
      "title": "Orders list pagination",
      "body": "markdown: the full question",
      "context": "markdown, optional, collapsed: report excerpt, reasoning, file paths",
      "explanation": "markdown, optional: set when re-asking after 'Explain'",
      "type": "single",                      // single | multi | bool | text
      "options": [                           // single/multi only, 2+ options
        { "id": "a", "label": "Cursor", "description": "markdown, optional" },
        { "id": "b", "label": "Offset" }
      ],
      "recommended": "a"                     // single: id; multi: [ids]; bool: true/false; text: prefilled string
    }
  ]
}
```

- **Groups** are the unit of submission, so a group is a set of questions you can act on together: coordinator → one group per subagent or task; grilling → one group per design-tree branch, so the answers to one branch unblock that branch's follow-ups while the user keeps answering the others.
- **Source**: always set `source` on every new group, so the user sees who is asking. `type` is `grill-me`, `grill-with-docs` or `grilling` for a grilling session (the skill the user invoked), `subagent` for questions coming out of a subagent's work, `agent` for your own questions; `name` is the subagent's task or the topic; `id` is the subagent/agent id when there is one.
- **Recommendation**: always set `recommended`; it is preselected, so accepting every recommendation is one click. A grilling "➡️ recommended answer" maps onto it.
- **Type**: discrete choices → `single`/`multi`; a "yes accepts my recommendation" question with no real alternatives → `bool`; open-ended → `text` with your recommendation prefilled. `single` gets an "Other…" option automatically; every question gets "Notes", "Explain" and "Skip".
- **Context**: put the evidence the user needs to decide into `context` (report excerpt, numbers, paths) so they never scroll the terminal.
- You can `ask` again at any time to add groups or questions; the tab updates live and marks them "new". The server keeps each group's earlier decisions and shows them; you never resend history.

## 2. Wait: arm a background waiter

Run `decide.mjs wait <session-dir>` with `run_in_background: true`, then end your turn or carry on with other work. The harness wakes you when it exits. Keep exactly one waiter armed while any group is open or being processed. Re-arm it right after each wake-up, before processing, so submissions made while you work are caught.

It exits on the next submission (or immediately if some are already queued) and prints `DECIDE_SUBMITTED <groupIds> answers=<path>` followed by one readable line per question. `answers.jsonl` holds the same data structured: per question `status` (`answered` | `explain` | `skip` | `open`), `label`, `recommended` (true when the user kept your recommendation), `other`, `note`, `explain`. `DECIDE_STOPPED` means the server is gone (stopped or idle for 4 h); do not re-arm.

If the user answers in the terminal instead, stop the waiter and continue from their message.

## 3. Process each submitted group

Print the trace in the terminal: one line per question, `Q7 → cursor`, plus the user's notes verbatim where they wrote any. Then act on each status:

- **answered**: settled. Treat `note` and `other` as part of the decision.
- **explain**: the user asked for an explanation, and `explain` says what is unclear. Re-ask the same id in the same group with `explanation` filled in, aimed at exactly that.
- **skip** / **open**: still unsettled; re-ask in that group when it becomes relevant again.

While you work, the tab shows the group as "Agent processing". A group is finished with exactly one of these:
- `ask` with follow-up questions to the same group (it reopens), or
- `decide.mjs done <session-dir> <groupId>…` when nothing more is needed from it (it shows as "Done").

## 4. Stop

When the work that needed questions is over and no group is open or processing, run `decide.mjs stop <session-dir>`. The tab shows "Session ended" and the waiter exits with `DECIDE_STOPPED`.

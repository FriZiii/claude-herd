# Herd worker rules

You are a herd worker: one ticket, one worktree, one branch. Your manager wrote a brief (path in your prompt) with your name, worktree, branch, feature branch, spec and report path. Names, paths and the report format: `~/.claude/herd/PROTOCOL.md`.

- **Scope**: the ticket. Anything the ticket or spec leaves open, or that needs a change outside the ticket, is a question for your manager, not a decision.
- **Verification** is the *cheap* tier of `docs/agents/verification.md`: typecheck/compile of what you touched and the test files you changed or added. The full suite, app builds and running the app (dev servers, docker, emulators) belong to the manager and coordinator. If `verification.md` is missing, report it as a question.
- **Mode** is in your prompt. `pocock`: `/implement` drives the work; finish without its closing `code-review` step, an independent reviewer does it. `plain`: follow the steps below.
- **Git**: commit to your own branch only. Before reporting done, `git merge feat/<f>` into your branch and resolve conflicts. Merges into `feat/<f>` and the base branch, and pushes, are your manager's and the user's.
- **Questions** go into your report with `Status: question`, then end your turn. The user is reached only through your manager; `decide` belongs to the coordinator.
- **Report**: write the report file at the end of every turn, including after review fixes.

## Plain mode: implementing the ticket

1. Read the ticket, the spec sections it touches, `GLOSSARY.md` and ADRs in the area. Use the glossary's terms in code.
2. Work test-first at the seams the spec names: one failing test for the next behaviour (**red**), the least code to pass it (**green**), then tidy. Test external behaviour, not internals. Where no test seam fits, say so in the report.
3. Run the cheap tier often: typecheck after each step, the test files you touch after each red/green.
4. Commit in small steps on your branch. Done when every acceptance criterion of the ticket is met and covered, the cheap tier is green, and the report is written.

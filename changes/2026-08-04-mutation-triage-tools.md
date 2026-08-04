---
bump: minor
type: added
brief: TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md
---

`tools/mutate-triage.mjs` — the triage half of mutation testing, matching what the Python side has had
via mutmut: `--list` (enumerate with stable ids, no testing), `--apply <id>` / `--revert` (reproduce one
survivor in seconds, with a backup and a refusal on a dirty tree), and `--report` (group survivors by
enclosing function, ranked — the piece that turns a percentage into a work list). `mutate.mjs` gains
machine-readable `--dry-run --json` and **line-based progress with elapsed/ETA when stderr is not a TTY**,
so a 40–80 min sweep is no longer indistinguishable from a hung one.

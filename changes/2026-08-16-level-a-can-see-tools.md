---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

Level A **refused on every file under `tools/`** — correctly, since without per-function coverage
"nothing calls this" is indistinguishable from "nothing asserts on this". The cause was a hard-coded
`--exclude=tools/**` in its own c8 invocation.

The effect: every guard in that tree lived on hand-written cases only and could never be
mutation-assessed — `commit-shape` (guards `main` against the ref-move corruption), `rebase-safe`
(prevents work loss), `land-pr` (merges PRs), and this programme's own `stmt-delete`.

The exclusion is now lifted **only when the subject is itself under `tools/`**, with `--include`
alongside because `.c8rc.json` restricts include to root `*.js` and c8 merges its config with these
flags. Measured: 0 tools files in the report → **117**, `commit-shape.mjs` carrying 4 functions.

⚠️ **`.c8rc.json` is deliberately NOT touched.** Its stated job is measuring the Dex *suite* as the
baseline for a future floor ("NO THRESHOLD YET — this measures, it does not gate"), and folding 117
dev tools into that number would corrupt the baseline it exists to establish. Level A's report is
ephemeral — a temp dir it removes — so this changes no shared measurement.

**End-to-end on the guard that prompted it:** `classify` is TESTED (corroborating that all four of
its boundary mutants are killed), while `readCommit` and `main` are NOT-REACHED by that group. The
first is a peer's claim confirmed; the second is new information their hand-written cases could not
surface.

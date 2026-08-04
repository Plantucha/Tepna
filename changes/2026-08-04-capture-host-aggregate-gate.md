<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04-BRIEF.md
---

Execute two of the three §8 items from the subprocess-surface follow-up (out-of-suite `capture-host/`).

**§2/§3/§4 → the runbook.** `MUTATION-AUDIT-RUNBOOK-2026-08-03` §1 is now "**Seven** ways a run fails
while looking fine": the non-unique-anchor row is in the table, and the prose below carries the
`s.count(anchor) == 1` assertion with the note that `>= 1` is *not* the check, because it passes on
exactly the case that breaks. §3's cost lesson sits in runbook §4 — a 5.18 s real-clock wait in one test
pushed three unrelated `wifi_up` mutants from KILLED to TIMEOUT, so test runtime is drawn from the
budget deciding whether other mutants get a verdict at all. The in-flight rule is widened in place to
"nothing that READS the tree may overlap anything that WRITES it", keeping the `pgrep` self-match
warning.

**§5 — the pre-commit hook is declined; an aggregate gate ships instead.** `capture-host/check.sh` runs
ruff · shellcheck · pytest, continues after a failure, and computes its verdict from the collected exit
codes rather than the tail. A hook must be *installed*; `core.hooksPath` is unset here while several
agent sessions work the tree, so the common state would be a hook that exists in-repo and runs for
nobody — a gate that does not gate. §5's own warning applies too: the last hook proposed in that brief
would have blocked every release. The JS side already answered this with `npm run check`; this is that,
for capture-host, and it is documented in `capture-host/README.md` as the entry point.

Verified by re-applying the defect — 5 mutants, all killed, including `set -e` (which would abort at the
first failing gate and silently undo the point) and a verdict ignoring the collected codes. `check.sh`
is owned by `tests/test_check_script.py` and listed in the shell-surface inventory; an ungated gate
would have been the joke.

**§6's 21-mutant `harvest` cluster is deliberately left**, with the reason recorded in §8: it is a fresh
campaign rather than this one's residue, and `pull_session` at 68.9 % is the larger target of the two.

Also fixed: a malformed `DOCS-INDEX.md` row whose link was doubled (`| [`| [`), so it did not render.

---
bump: patch
type: fixed
brief: none
---

# `check.sh` refuses an interpreter that lacks its own tools

RESIDUE `2026-10-19-check-sh-in-a-worktree-drops-the-coverage-floor`: a `git worktree` carries no
`capture-host/.venv`, so `PY` fell back to a bare `python3` with none of `requirements-dev.txt`. Three
gates then reddened over a run that examined nothing, and `$PY -m ruff` with no ruff exits 1 — the same
code `checkverdict.py` reads as "violations found", so the verdict blamed the diff. A preflight now
probes the chosen interpreter for ruff and pytest-cov, names every absent tool with the `PYTHON=`
remedy, writes a `NOT_RUN` object over any stale one, and exits 2 before a single gate runs.

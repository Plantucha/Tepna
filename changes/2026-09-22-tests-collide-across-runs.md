---
bump: patch
type: fixed
brief: none
---

Two capture-host test files no longer red when a second run shares the box (a peer's `check.sh` in another worktree, or pytest-xdist at ≥ 8 workers): `vigil.sh is_vigil()` no longer accepts an EMPTY cwd — a neighbour's torn-down stub with `capture.py` in its argv was claimed as our daemon, so `start` started nothing and `status` reported RUNNING on a cold box (a deterministic plant reproduces it and reds the old script); `check.sh`'s `.mypy-latest.txt` is now the `MYPY_OUT` override, per sandbox in the tests, so eight sandboxed runs stop reading each other's mypy line. Residue `2026-09-22-check-sh-tests-collide-across-worktrees` logged and closed in the same PR.

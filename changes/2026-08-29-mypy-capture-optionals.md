---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---
mypy session-lane batch 5: six guarded-Optional sites in capture.py, each guard traced individually.
Three were attributes/slots initialised to None whose type mypy took from the initialiser
(`self.t0`, `self.est_t0`, `_oxywr["w"]`). One was a module-global narrowing that does not cross a
function boundary (`_PMD_PROBE`), re-established locally. Two were `seen[addr] = prev` storing a
None first-sighting into a `dict[str, float]` — dropped the key instead, since the read path cannot
distinguish a None value from an absent one. The archive/to_thread group is deliberately NOT included.

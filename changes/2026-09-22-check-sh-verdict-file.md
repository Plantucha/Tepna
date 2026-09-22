---
bump: minor
type: added
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

`capture-host/check.sh` writes ONE `tepna.verdict/1` object (`.check-verdict.json`, beside `.mypy-latest.txt`) over its four blocking children — ruff · shellcheck · pytest · unwired — via the new `checkverdict.py`: each child's status is read off its documented exit-code contract (0 PASS · the contract's issues code FAIL · 127 NOT_RUN, a missing TOOL, excluded and the run UNKNOWN · abnormal codes and pytest's "no tests collected" UNKNOWN), aggregated by §3d's precedence (FAIL > UNKNOWN > PASS, never a vote); the `advisory-state` tokens ride in `result.advisory`; the shell exit code stays the gate. Manifest rows added; the object is validated under verdict.js in the tests.

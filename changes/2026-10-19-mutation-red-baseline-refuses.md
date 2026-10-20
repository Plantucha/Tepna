---
bump: patch
type: fixed
brief: none
---

capture-host/tools/mutate_diff.py now refuses a module whose own clean baseline failed. It used to report PASS over one. mutmut calls a mutant killed when the covering tests fail with it applied. A red baseline fails without one too, so every mutant read as killed. Measured on #3704: three red baselines, `status: PASS`, exit 0, and 14 survivors nobody saw. `run_one` also consults `clean_ok` ahead of the `timeout is not None` branch. The one consumer of that flag sat inside that branch, and the gate always supplies a timeout.

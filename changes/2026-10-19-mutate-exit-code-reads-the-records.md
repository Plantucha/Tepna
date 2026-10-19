---
bump: patch
type: fixed
brief: none
---

Decide `tools/mutate.py`'s exit code from the records it produced, not from the skip count alone. A `--only` glob matching no mutant exited 0. The log ended in a full `not checked` listing that looked finished. The decision now lives in `mutation_sweep.sweep_exit_verdict`, inside the coverage floor. It names the phase that decided nothing. The record also carries the selection it ran.

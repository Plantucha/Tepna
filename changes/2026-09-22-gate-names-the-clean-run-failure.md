---
bump: patch
type: changed
brief: none
---

`capture-host/tools/mutate_diff.py`: when mutmut's own clean baseline fails, the diff-scoped mutation gate now NAMES the test that broke it (`mutation_diff.clean_run_failures`, read off mutmut's streamed report) and says whose failure it is — the covering set's, not the diff's — instead of refusing with "mutants were generated but 0 tested — a crash after generation" while the name sat three lines above in the log. Residue `2026-09-09-alert-poller-test-order-dependent`: its instance does not reproduce today (measured on the exact CI covering set and a 6580-test superset) and its class was closed by #2718; the unnamed refusal was the half that remained.

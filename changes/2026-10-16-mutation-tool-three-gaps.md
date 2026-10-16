---
bump: patch
type: fixed
brief: none
---

Close three mutation-tool gaps.

Hang quarantine: a per-mutant no-progress watchdog (--quarantine-timeout, default 300s) SIGKILLs a suite run that goes silent. The tool journals the mutant QUARANTINED. Quarantined mutants stay out of the kill-rate denominator, like INVALID. The suite progress view counts them apart. A warning reports the count.

Journal scope header: a fresh journal records file, limit, filter, bail, full, only and diff in its first record. On --resume the tool compares each field. On mismatch it refuses with exit 2. It no longer misattributes verdicts across scopes.

Machine-readable compliance: --verdict prints the TOOL-BUILD-STANDARD section 2.13 manifest as JSON. It carries 13 clauses. Each states met, n/a with a reason, or absent.

Tests: ten new selftest assertions in tools/mutate.mjs, two in tools/mutation-suite.mjs. Each failed before the fix and passed after.

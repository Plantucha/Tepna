<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: none
---
`capture.py`'s decision predicates are now mutation-tested — and the module stopped being unmeasurable.

`capture.py` is the daemon, and the audit had it sampled at **1 %** (69 of 7 197 mutants) because a run
never finished. The cause was not the module's size: `tools/mutate.py` set `PYTHONDONTWRITEBYTECODE=1`,
mutmut starts a fresh process per mutant, and mutmut's generated module for `capture.py` is 100 MB.
Cold import **429 s**; with a `.pyc`, **0.4 s**. Every mutant was recompiling 1.9 M lines — 7 197 × 429 s
is 36 days. The scratch is a throwaway `/tmp` copy, so the flag was protecting nothing.

Second fix: the generated mutant file is a pure function of the MUTATED module (mutmut copies tests but
never mutates them), so regenerating on a test-only edit rebuilt a byte-identical 100 MB file and threw
away the warm cache. Scratches are now keyed on the module's hash and reused, with `reused_scratch`
reported. Measured end to end: a `capture.py` iteration went from **22 min to 18 s**; `sdnotify` 6.7 s
→ 1.0 s.

With that, the 16 pure decision predicates measured 230 mutants: **83 % → 91 %**, 18 killed, 0
regressions. They gate whether a device is dropped, a clock corrected, a radio power-cycled — and the
survivors sat exactly on the boundaries their docstrings were written around: `seen > 0` → `> 1` in
`radio_looks_deaf` power-cycles a radio that heard something, and five `transient_ble_error` mutants
made a protocol refusal undetectable because the markers are matched against already-lowercased text.

Also: a source-scanning test (`test_the_clock_write_stays_behind_the_policy`) fails against any mutant
file — it counts `set_time_frame(` call sites and finds 664 — which mutmut reports as "failed to collect
stats", i.e. the whole module unmeasurable. It now skips on a generated file rather than being added to
`SOURCE_SCANNING_TESTS`, whose per-FILE exclusion would have dropped `oxyii_rtc_due`'s only coverage.

New: `tools/mutate_pure.py`, an in-process harness for pure functions — 235 mutants/s, but it runs only
zero-fixture tests so its survivor set is a superset of the truth. A triage accelerator, not a
measurement of record; `--self-check` enforces that against a mutmut dump.

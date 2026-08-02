<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host, docs]
brief: none
---
Record the mutation audit's second pass — three targets closed, and webmon measured for the first time.

`audits/MUTATION-AUDIT-FINDINGS-2026-08-02.md` is `REFERENCE (living)`, so it is re-stamped rather than
superseded. The first-pass table is kept verbatim — it is what the original findings were derived from —
with the four moved rows called out and the current numbers in a new **Second pass** section.

**webmon's absence turned out to be smaller than it looked.** The audit recorded it as the one module
that "exceeded the driver's per-module timeout twice". Measured, it takes **3 857 s** against a cap
hard-coded at **3 600 s** — 7 % over an arbitrary number, not a pathological module. It read as
unmeasurable rather than as over-budget because `subprocess.TimeoutExpired` propagated straight out of
`run_one`, so both attempts died with a traceback and left no partial result at all. Both halves are
fixed in the harness (PR #704); this records the number: **59 %, 1402/2356 killed, 954 survivors**.

The module-level percentage is the least useful thing about it. **926 of those 954 survivors are in
`make_app`** — one very large function holding the whole aiohttp route table — so the finding is "the
route table is weakly tested", and the next pass should go a route at a time.

Also adds the `_sh` timeout assertion to `test_cpap_wifi_commands.py`, closing the six `_wpa_down`
survivors left after the first attempt: the teardown's `timeout=10` reaches `subprocess.run`, where
`None` means *wait forever* — on the one part of the harvest with a documented history of hanging.
`cpap_harvest` 72 % → **77 %** (348 → 282 survivors, 66 killed, 0 regressions).

The "where to go next" list is re-ordered against the new measurements: webmon's `make_app` first, then
`polar_psftp` (69 %), now the weakest of the untouched modules. The standing instruction not to wire a
whole-tree kill-rate threshold into CI is restated in the doc — `tools/mutate_diff.py` stays
diff-scoped.

Docs + one test assertion — no shipped source, no `manifestHash` movement, no fixture re-recorded.

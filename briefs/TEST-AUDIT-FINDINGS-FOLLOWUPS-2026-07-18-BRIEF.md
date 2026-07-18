<!--
  TEST-AUDIT-FINDINGS-FOLLOWUPS-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED — 2026-07-18 · **Created:** 2026-07-18

# Test-audit findings — follow-ups (residue after executing the 42)

Follow-up to `TEST-AUDIT-FINDINGS-2026-07-18-BRIEF.md` (house `-FOLLOWUPS` pattern). Executing that brief
closed **40 of 42** hollow gates with both-direction-verified assertions. This carries the residue: one
finding with no synchronous test seam, plus the two audit surfaces that were explicitly **out of scope**
of the first (JS-only, corpus lane) pass.

## §1 — #98 `overdex-walk` paged `readEntries` (real gap, no sync seam)

The mutation `all = all.concat(slice(batch))` → `all = slice(batch)` drops every 100-entry page but the
last — a **real** bug (a directory of >100 dropped files silently loses all but the final page). It was
NOT a no-op; the design-agent could not close it because `OverDexWalk`'s directory recursion is
**async webkit-entry `readEntries`** (paged at 100), and the test lane has **no async group support**
(same limitation noted in `TEST-COVERAGE-FOLLOWUPS §5`, which left it "to render-coverage"). **Options:**
(a) add a minimal async-capable assertion path to the harness and drive a stubbed `readEntries` that pages
at 100; or (b) refactor the accumulation into a **synchronous, exported** `mergePages(pages)` helper and
pin *that* with a known-answer (2 pages of 100 → 200 entries, not 100). **Recommend (b)** — a small
export seam is testable in the existing sync lane and documents the paging invariant.

## §2 — Python `capture-host/` mutation audit — RAN 2026-07-18 (mutation score 44%)

The Python side (`ruff` + pytest, 54 tests) got a full mutation pass. **⚠ mutmut 3.6 was unreliable
here** — its default runner loaded the *original* modules via `tests/conftest.py`'s `sys.path` pin (so
its `mutants/` copies never ran → it reported 0 kills), and `mutmut results` listed only ~791 of the
**1418** mutants the files actually contain. Both are traps for the next person. The trustworthy method
was a **hand-driver**: activate each mutant via `MUTANT_UNDER_TEST=<module.name>` and run its test file
**from inside `mutants/`** (the layout that loads the mutated code) — validated by a known-killable
(`writers…capture_filename` `stamp=None` → killed) and a known-survivor (default-arg change → survives).

**Result over the complete 1418 mutants: 629 killed / 789 survived = 44%.** Per module:

| module | score | read |
|---|---|---|
| `viatom` | 88% | well-tested |
| `oxyii` | 66% | O2Ring protocol — solid |
| `telemetry` | 65% | decent |
| `writers` | 49% | output-format gaps (`night_dir`, `write_ppi`, `__init__`) |
| **`polar_pmd`** | **42%** | **the raw ECG/PPG/ACC frame decoders — the real gap** |
| `clockcfg` | 8% | mostly `timedatectl` **subprocess** wrappers (`status`/`set_ntp`/`set_tz`) — hard to unit-test, **low signal-impact**; not the priority |

**Priority: `polar_pmd.decode_frame` (161 survivors) + `_decode_delta` (80) + `_i24` (13).** These parse
the captured waveform, and severe corruptions **survive the full 54-test suite** (spot-verified), e.g.:
`for o in range(0, len(payload)-2, 3)` → `range(0, 3)` (**decode only 1 ECG sample per frame**);
the PPG loop likewise (1 sample/frame); `back / fs` → `back * fs` (**per-sample timestamp corrupted by
fs²** — a ms/s-class unit bug); ACC step `6`→`7` and `unpack_from(…, o)`→`(…)` (misaligned / constant
ACC). A real such defect would silently mangle every recording, uncaught.

**Fix (highest value first):** add a `test_polar_pmd` **known-answer that decodes a full multi-sample
ECG + PPG + ACC frame and asserts EVERY sample value AND its back-timed `t_ms`** (not just "a frame
decodes"). One strong frame-decode known-answer kills the bulk of the 254 decoder survivors — the same
> **PARTIALLY DONE 2026-07-18:** added `test_polar_pmd` full-frame known-answers for the **uncompressed ECG/PPG/ACC** paths — every sample value + every back-timed `sensor_ns`/`t_ms` (PPG had ZERO decode coverage before). Both-direction verified: 5 representative severe mutations (stride `range(0,3)`, PPG 12-stride, ACC drop-offset, back-timing sign, `_i24` sign) now RED. `_decode_delta` (compressed path — signed ref, per-channel accumulate, block delta_size/count, LSB bit-read) + **GYRO/MAG/PPI** decode are now ALSO pinned (wave 2, 2026-07-18): 6 more mutation classes both-direction-verified. `test_polar_pmd` 9→19 tests; the raw-decoder gap (uncompressed + compressed + all IMU/PPI paths) is closed.
> The same
"pin the whole output, not that it ran" lesson as the JS unexported-metric class. Then `writers`
(assert the full CSV row set per stream) and `telemetry.push`. **De-prioritize `clockcfg`'s subprocess
paths** (they shell out; low-value to unit-test, no signal data). Artifacts: this audit's driver +
per-mutant results are in the session scratchpad (`mutkill.py`, `mutkill-full.json`), not committed.

## §3 — Deep-scout second wave (fresh mutations beyond the 99)

The first pass planted a fixed 99. A **deep-scout wave** (new mutations in the under-covered clusters —
the cross-SD family beyond the 5 caught, deeper estimator/threshold/index logic) was cut off by a session
rate-limit. Re-run it to find hollow gates the first 99 didn't probe; also drive the surfaces the first
pass never exercised — **browser render-coverage**, **CSP** / **no-network** static lanes, and
`verify-provenance.html` (the browser check of `gateA_ok`/`gateB_ok` owed for #73/#74 from the parent).

## Done when

§1 closed with a sync seam + known-answer (both directions), §2 has run at least one Python mutation pass
with survivors triaged (gated or dispositioned), §3's deep-scout wave has run and its findings are either
gated or spun into a further follow-up. Each lands as its own gated PR.

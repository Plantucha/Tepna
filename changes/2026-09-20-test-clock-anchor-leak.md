<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
A test that faked `time.monotonic` could move `capture._now()` for every later test in the same
process — the failure behind #2715's red mutation lane, which passed locally under xdist twice.
`_now()` predicts wall time from an anchor its own `_reanchor()` writes into module globals; the
`monotonic = 1000.0` tests in `test_capture_runners` never patch those globals, so `monkeypatch`
restored the clock and left the anchor. With `writers._open_sample_writers > 0` (a counter another
test had leaked) `_now()` then ABSORBS the divergence instead of re-anchoring: a permanent
`anchor + (real monotonic − 1000)` — the runner's uptime, ~4 h — and `resumable_set` judged its
window against that `now`, so the resume happened by filename collision while the "resuming
file-set" line was never emitted. xdist usually scatters the clock tests to another worker; mutmut's
clean baseline is one sequential process and saw it every time.

Fixed: an autouse fixture in `tests/conftest.py` snapshots and restores `_anchor_wall`,
`_anchor_mono`, `_anchor_utcoff`, `_civil_shift` after every test (never `_reanchor()`s — that would
write globals itself). `tests/test_clock_anchor_isolation.py` PLANTS the leak in the exact CI shape
and asserts the next test's `_now()` agrees with the wall clock: verified failing without the fixture
and passing with it, and the three-test CI reproduction (leaked writer + plant + the resume test)
fails without it and passes with it. The writer-counter leak is a separate defect, simulated in the
plant and logged as residue `2026-09-20-open-writer-counter-leaks-across-tests` together with the
wider, unenumerated population of `capture.py` module globals other tests have been seen to leak.

# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The planted leak, in the exact shape the #2715 mutation lane hit. Two module globals conspire:

  1. `capture._anchor_mono` — several `test_capture_runners` tests fake `time.monotonic` (`lambda:
     1000.0`) WITHOUT patching the anchors; `_now()` sees a huge step and `_reanchor()`s with the FAKE
     monotonic origin. `monkeypatch` restores `time.monotonic`; it never sees the anchor the CODE wrote.
  2. `writers._open_sample_writers` — a process-global counter any test that opens a StreamWriter and
     never closes it leaves > 0. With it > 0, `_now()` ABSORBS the resulting divergence (the
     backward-step-with-a-file-open branch) instead of re-anchoring, and every later call returns
     `predicted`: anchor + (real monotonic − 1000) — the runner's uptime, ~4 h in that CI run
     (`…_20260920182347_…` stamped in a run at 14:3x UTC).

The conftest fixture closes (1). (2) is a separate leak, NOT fixed here, and is simulated in the second
test so this pair fails without the fixture whatever the real counter holds. Ordered by name so the
planter runs first in a sequential process; under xdist the pair may split across workers and the
second test still holds. The plant is the load-bearing half: a restore that restored nothing would
read identically."""
import datetime as dt

import capture


def test_a_plants_a_fake_monotonic_origin_in_the_anchor(monkeypatch):
    monkeypatch.setattr(capture, "open_sample_writers", lambda: 0)   # no file open → the step RE-ANCHORS
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)  # the shape at test_capture_runners:2706/2733
    capture._now()
    assert capture._anchor_mono == 1000.0, "the code anchored on the fake clock — the state that used to leak"


def test_b_sees_a_now_that_agrees_with_the_wall_clock_even_with_a_file_open(monkeypatch):
    """Without the conftest restore `_anchor_mono` is still 1000.0: `predicted` runs ahead by the real
    monotonic clock's whole value, and with a sample writer open (the leaked counter, simulated here)
    `_now()` ABSORBS that instead of re-anchoring and returns it."""
    assert capture._anchor_mono != 1000.0, "the planted anchor leaked past its test"
    monkeypatch.setattr(capture, "open_sample_writers", lambda: 1)   # leak (2), simulated
    delta = abs((capture._now() - dt.datetime.now()).total_seconds())
    assert delta < 5.0, f"_now() is {delta:.0f} s from the wall clock — a leaked anchor, absorbed"

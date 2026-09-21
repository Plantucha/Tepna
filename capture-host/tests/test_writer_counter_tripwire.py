# tepna-capture — tests/test_writer_counter_tripwire.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The guard for residue `2026-09-20-open-writer-counter-leaks-across-tests`. `writers._open_sample_writers`
# is a process-global counter; a test that opens a sample writer and never closes it leaves it > 0 for
# every later test in the process, and with it > 0 `capture._now()` ABSORBS a clock divergence instead
# of re-anchoring — so a fake-monotonic anchor leaked by one test became a permanent hours-off `_now()`
# in the #2715 mutation lane (measured: `…_20260920182347_…` stamped at 14:3x UTC).
#
# MEASURED before the fixture existed, with the same reset-then-tripwire method as
# test_capture_event_tripwire.py: 4947 tests passed before the first leaker, and the full enumeration
# named TEN across three files. Every one was a missing `close()`, and every one got a close, not a
# marker — the marker exists for a scenario that ENDS with a file open, and none of the ten did.
import os
import shutil
import subprocess
import sys
import textwrap

import writers

_TESTS = os.path.dirname(os.path.abspath(__file__))


def test_every_test_starts_with_the_counter_at_ZERO():
    """The reset half — the precondition every later test silently relies on."""
    assert writers.open_sample_writers() == 0


def _child(body):
    probe = os.path.join(_TESTS, f"_wcount_probe_{os.getpid()}")
    os.makedirs(probe, exist_ok=True)
    try:
        with open(os.path.join(probe, "test_probe.py"), "w") as f:
            f.write(textwrap.dedent(body))
        r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
                            os.path.join(probe, "test_probe.py")],
                           capture_output=True, text=True, timeout=300, cwd=os.path.dirname(_TESTS))
        return r.returncode, r.stdout + r.stderr
    finally:
        shutil.rmtree(probe, ignore_errors=True)


def test_the_tripwire_NAMES_a_test_that_leaves_a_writer_open(tmp_path):
    """THE PLANT, through the REAL conftest in a child pytest: a passing body that opens a StreamWriter
    and never closes it must fail AND name itself and the count."""
    rc, out = _child("""
        import writers

        def test_a_throwaway_test_that_leaks_a_writer(tmp_path):
            w = writers.StreamWriter(str(tmp_path / "x.txt"), "ecg", fsync=False)
            assert w is not None          # the BODY passes — the leak is the only defect
    """)
    assert rc != 0, f"the tripwire did not fire on a leaking test:\n{out}"
    assert "test_a_throwaway_test_that_leaks_a_writer" in out, out
    assert "_open_sample_writers = 1" in out, out


def test_a_test_that_CLOSES_its_writer_is_not_flagged(tmp_path):
    rc, out = _child("""
        import writers

        def test_a_throwaway_test_that_closes(tmp_path):
            w = writers.StreamWriter(str(tmp_path / "x.txt"), "ecg", fsync=False)
            w.close()
    """)
    assert rc == 0, out


def test_a_MARKED_test_may_end_with_a_writer_open():
    """The marker is a declaration, not a loophole: it silences the tripwire for a scenario that ends
    with a file open, and the reset still runs so nothing reaches the next test."""
    rc, out = _child("""
        import pytest, writers

        @pytest.mark.leaves_writers_open
        def test_a_scenario_that_ends_open(tmp_path):
            writers.StreamWriter(str(tmp_path / "x.txt"), "ecg", fsync=False)

        def test_the_next_test_starts_clean():
            assert writers.open_sample_writers() == 0
    """)
    assert rc == 0, out

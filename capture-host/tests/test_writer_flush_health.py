# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""A SWALLOWED FLUSH IS SILENT DATA LOSS, AND THESE WRITERS SWALLOWED SIXTEEN OF THEM.

`storage_poller` already watches free space and alerts on it, so the surface these tests defend is
the one it CANNOT see: every write failure that never moves the free-space number — EIO on a failing
drive, EROFS after a read-only remount, a quota. At the writer they are indistinguishable from
success, and the night reads as complete while its tail is missing.
"""
import errno
import os

import pytest

import writers


class _FailingFH:
    """A handle whose flush fails on demand, the way a full or dying disk does."""

    def __init__(self, err=errno.ENOSPC):
        self.err, self.failing, self.closed = err, True, False

    def flush(self):
        if self.failing:
            raise OSError(self.err, os.strerror(self.err))

    def fileno(self):
        return 0

    def close(self):
        self.closed = True


def _writer(tmp_path, fsync=False):
    w = writers.StreamWriter(str(tmp_path / "s.csv"), "hr", fsync=fsync)
    w._fh = _FailingFH()
    w._rr_fh = None
    return w


def test_A_FAILING_FLUSH_IS_COUNTED_AND_NAMED_BY_SYMBOLIC_ERRNO(tmp_path, caplog):
    """ENOSPC, EIO and EROFS want three different responses at 3am — free space, get the data off a
    dying drive, fix the mount. A count cannot tell them apart, so the errno must be in the line."""
    w = _writer(tmp_path)
    with caplog.at_level("WARNING"):
        w.flush()
    assert w.flush_failures == 1
    assert "ENOSPC" in caplog.text
    assert "may NOT be on disk" in caplog.text


def test_IT_LOGS_ON_THE_TRANSITION_NOT_ON_EVERY_FAILURE(tmp_path, caplog):
    """Whatever breaks a write stays broken, so a per-failure line runs to tens of thousands over a
    night. The objection is not volume: it is that the second identical line carries nothing the
    first did not, while BURYING the first — the only one that says when it started."""
    w = _writer(tmp_path)
    with caplog.at_level("WARNING"):
        for _ in range(500):
            w.flush()
    assert w.flush_failures == 500, "every failure must still be COUNTED"
    assert caplog.text.count("WRITE FAILED") == 1, "only the onset should be logged"


def test_RECOVERY_IS_REPORTED_ONCE_WITH_THE_DAMAGE_COUNT(tmp_path, caplog):
    w = _writer(tmp_path)
    for _ in range(7):
        w.flush()
    w._fh.failing = False
    with caplog.at_level("INFO"):
        w.flush()
        w.flush()
    assert caplog.text.count("writing again") == 1
    assert "after 7 failed flush(es)" in caplog.text


def test_CLOSE_MUST_NOT_CLAIM_RECOVERY_ITS_OWN_FLUSH_DID_NOT_EARN(tmp_path, caplog):
    """🔴 THE SUBTLE ONE. `close()` runs `flush()` inside its own `try`. If `close` also reported
    success, a close that merely managed to shut a handle would clear the failing state its own
    flush had just set — announcing "writing again" about a file whose tail never landed. The
    recovery claim belongs to the operation that actually writes."""
    w = _writer(tmp_path)
    w.flush()
    assert w.flush_failures == 1
    with caplog.at_level("INFO"):
        w.close()
    assert "writing again" not in caplog.text
    assert w._health._failing is True, "close cleared a failing state it did not earn"


def test_A_HEALTHY_WRITER_SAYS_NOTHING_AND_COUNTS_NOTHING(tmp_path, caplog):
    """The control. Without it every assertion above passes on a logger that never fires."""
    w = writers.StreamWriter(str(tmp_path / "ok.csv"), "hr", fsync=False)
    with caplog.at_level("INFO"):
        w.flush()
        w.flush()
        w.close()
    assert w.flush_failures == 0
    assert "WRITE FAILED" not in caplog.text and "writing again" not in caplog.text


def test_A_CLOSED_HANDLE_REPORTS_ITS_TYPE_NOT_A_BOGUS_ERRNO(tmp_path, caplog):
    """`ValueError: I/O operation on closed file` carries no errno. Reporting `errno None` would be
    a fabricated detail; the type name is the honest answer."""
    assert writers._write_error_name(ValueError("closed")) == "ValueError"
    assert writers._write_error_name(OSError(errno.EROFS, "ro")) == "EROFS"
    # an errno with no symbolic name must not crash or silently vanish
    assert "12345" in writers._write_error_name(OSError(12345, "?"))


@pytest.mark.parametrize("cls", [c for c in dir(writers) if c.endswith("Writer")])
def test_EVERY_WRITER_REPORTS_ITS_OWN_FAILURES_NOT_JUST_THE_ONE_I_TESTED(cls, tmp_path, caplog):
    """Sixteen swallows across EIGHT classes, byte-identical and copy-pasted. Fixing the one that has
    a test and leaving seven is exactly how this comes back.

    ⚠️ This DRIVES each class's flush and close rather than asserting the attribute exists. An
    `hasattr` check passes on all eight while seven of the sixteen call sites are still swallowing —
    the property is inherited-looking boilerplate, the call sites are the thing that can be wrong."""
    w = getattr(writers, cls)(str(tmp_path / f"{cls}.csv"), *(["hr"] if cls == "StreamWriter" else []),
                              fsync=False)
    w._fh = _FailingFH(errno.EIO)
    if getattr(w, "_rr_fh", None) is not None:
        w._rr_fh = _FailingFH(errno.EIO)

    with caplog.at_level("WARNING"):
        w.flush()
    assert w.flush_failures == 1, f"{cls}.flush swallowed without counting"
    assert "EIO" in caplog.text, f"{cls}.flush swallowed without saying so"

    # ...the recovery leg, which is a THIRD distinct site per class. Without it the failing state
    # would never clear for seven of the eight, and nothing would say so.
    w._fh.failing = False
    if getattr(w, "_rr_fh", None) is not None:
        w._rr_fh.failing = False
    with caplog.at_level("INFO"):
        w.flush()
    assert "writing again" in caplog.text, f"{cls}.flush never reported recovery"

    # ...and close's own handler, which is a SEPARATE swallow in every one of these classes
    w._fh.close = lambda: (_ for _ in ()).throw(OSError(errno.EIO, "gone"))
    w.close()
    assert w.flush_failures >= 2, f"{cls}.close swallowed its own failure"

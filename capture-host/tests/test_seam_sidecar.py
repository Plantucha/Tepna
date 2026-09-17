# tepna-capture — tests/test_seam_sidecar.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""BLE-TIMEBASE-AT-THE-EDGE §1.4 — clock seams emitted where the clocks arrive.

The cost of not emitting them is measured: with the true F1 magnitude planted into a `_PPG.txt`,
`hostAxis` REFUSES at ±50,000 ppm exactly as designed and `relSec` still spans 2.416e8 s — a 7.66-year
night downstream while the rate guard reads green.
"""
import datetime as dt
import os
import re
import sys


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import writers  # noqa: E402

T0 = dt.datetime(2026, 9, 16, 12, 0, 0)


def _sc(tmp_path, stream="ppg"):
    return writers._SeamSidecar(str(tmp_path / "X_PPG.txt"), stream)


def _rows(sc):
    return [l for l in open(sc.path).read().split("\n") if l and not l.startswith("#")][1:]


def test_a_device_step_IS_a_seam(tmp_path):
    """The failure the sidecar exists for: the device counter jumps, the host does not."""
    sc = _sc(tmp_path)
    for i in range(4):
        sc.feed(T0 + dt.timedelta(milliseconds=8 * i), 1_000_000_000 + 8_000_000 * i)
    sc.feed(T0 + dt.timedelta(milliseconds=32), 1_000_000_000 + 400_000_000_000)
    sc.close()
    assert sc.seams == 1
    assert len(_rows(sc)) == 1


def test_PLANT_a_DROPOUT_is_NOT_a_seam(tmp_path):
    """THE discriminator, and the reason the key is the RESIDUAL rather than either delta alone.

    Across a dropout BOTH clocks advance together — the device kept counting while nothing was
    delivered — so a detector keyed on "the device jumped" fires on every dropout and the file fills
    with the normal behaviour of a BLE link. Across a STEP only the device moves."""
    sc = _sc(tmp_path)
    sc.feed(T0, 1_000_000_000)
    # a 300-SECOND dropout: host and device both advance 300 s, residual ~0
    sc.feed(T0 + dt.timedelta(seconds=300), 1_000_000_000 + 300_000_000_000)
    sc.close()
    assert sc.seams == 0, "a dropout is not a seam — both clocks advanced together"
    assert sc.examined == 1, "and it was EXAMINED, not skipped"


def test_the_bound_matches_the_ECGDex_detector():
    """Parity. If the emitter and the node's detector disagree about what a seam IS, the node's
    cross-check becomes a false-alarm generator rather than a check."""
    js = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "..", "ecgdex-dsp.js")).read()
    m = re.search(r"ECG_RESYNC_BOUND_MS\s*=\s*(\d+)", js)
    assert m, "ECGDex's bound not found — parity cannot be asserted against nothing"
    assert writers.SEAM_BOUND_MS == int(m.group(1))


def test_a_stream_with_no_device_clock_records_nothing_and_does_not_crash(tmp_path):
    """§∅: absent is not zero. `sensor_ns=None` means no device clock to disagree with, so there is
    nothing to observe — not a seam count of 0 arrived at by looking."""
    sc = _sc(tmp_path)
    for i in range(5):
        sc.feed(T0 + dt.timedelta(milliseconds=8 * i), None)
    sc.close()
    assert sc.seams == 0 and sc.examined == 0


def test_an_honest_empty_file_SAYS_it_looked(tmp_path):
    """An empty sidecar and one that never ran are the same bytes unless the final line says so —
    the argument that made write_acc feed its run sidecar."""
    sc = _sc(tmp_path)
    for i in range(3):
        sc.feed(T0 + dt.timedelta(milliseconds=8 * i), 1_000_000_000 + 8_000_000 * i)
    sc.close()
    body = open(sc.path).read()
    assert "# final stream=ppg seams=0 examined=2" in body
    assert "bound_ms=60000" in body, "the file must carry the bound that produced its rows"


def test_PLANT_every_device_clocked_writer_FEEDS_the_sidecar():
    """The wiring gate. Eight call sites is eight chances to miss one, and a missed one is INVISIBLE —
    that stream simply never reports a seam, which is indistinguishable from a stream that has none.

    Asserted as a NAMED SET, never a count: a count encodes "eight" as the invariant, when the
    question a reader has is WHICH."""
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "writers.py")).read().split("\n")
    starts = {}
    for i, l in enumerate(src):
        m = re.match(r"    def ([a-z_0-9]+)\(", l)
        if m:
            starts[i] = m.group(1)
    idx = sorted(starts)
    fed = set()
    for k, ln in enumerate(idx):
        end = idx[k + 1] if k + 1 < len(idx) else len(src)
        if "_seams.feed" in "\n".join(src[ln:end]):
            fed.add(starts[ln])
    missing = [n for n in writers.SEAM_FED_WRITERS if n not in fed]
    assert not missing, f"device-clocked writers that do not feed the seam sidecar: {missing}"


def test_the_uncovered_paths_are_uncovered_ON_PURPOSE():
    """`feed()` takes only `phone` — no device clock, so a seam is NOT EXPRESSIBLE there, which is a
    different fact from unmeasured. Pinned so that 'add it everywhere' is a deliberate change."""
    assert "feed" not in writers.SEAM_FED_WRITERS
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "writers.py")).read()
    # ⚠️ TWO methods are now named `feed` — `_SeamSidecar.feed(self, phone, sensor_ns)` and
    # `_RunSidecar.feed(self, channel, value, phone)`. A bare `def feed(` search finds whichever comes
    # first in the file and would assert about the wrong one; this test failed exactly that way on its
    # first run. Anchor on the RUN sidecar's class, which is the one §1.4 does not cover.
    cls = src.index("class _RunSidecar:")
    m = re.search(r"    def feed\(self[^)]*\)", src[cls:])
    assert m, "_RunSidecar.feed not found"
    assert "sensor_ns" not in m.group(0), "if _RunSidecar.feed gained a device clock, revisit this"


def test_a_sidecar_that_cannot_OPEN_does_not_stop_the_recording(tmp_path, monkeypatch):
    """The annotation is subordinate to the stream. A read-only volume must cost the seam record, not
    the night — and `_ensure` must not retry per sample on the notification path."""
    sc = _sc(tmp_path)

    def boom(*_a, **_k):
        raise OSError("read-only file system")
    monkeypatch.setattr(writers, "open", boom, raising=False)
    import builtins
    monkeypatch.setattr(builtins, "open", boom)
    for i in range(3):
        sc.feed(T0 + dt.timedelta(milliseconds=8 * i), 1_000_000_000 + 8_000_000 * i)
    assert sc.seams == 0
    assert sc._opened is True, "it tried once and must not retry every sample on the notify path"


def test_a_broken_clock_value_does_not_reach_the_capture_path(tmp_path, monkeypatch):
    """`phone` comes from the device path and is not guaranteed well-formed. Whatever it is, the stream
    row was already written by the caller — an annotation cannot be allowed to undo that."""
    sc = _sc(tmp_path)
    sc.feed(T0, 1_000_000_000)

    class Bad:
        def timestamp(self):
            raise ValueError("not a clock")
    sc.feed(Bad(), 1_000_000_000 + 8_000_000)   # must not raise
    sc.close()
    assert sc.seams == 0


def test_a_failing_CLOSE_cannot_fail_a_night(tmp_path, monkeypatch):
    """Last resort: the final line could not be written. The recording is already complete by then."""
    sc = _sc(tmp_path)
    sc.feed(T0, 1_000_000_000)
    sc.feed(T0 + dt.timedelta(milliseconds=8), 1_000_000_000 + 8_000_000)

    class BadFH:
        def write(self, *_a):
            raise OSError("disk went away")

        def close(self):
            raise OSError("and so did the handle")
    sc._fh = BadFH()
    sc.close()          # must not raise
    assert sc._fh is None, "the handle is released even when closing it failed"

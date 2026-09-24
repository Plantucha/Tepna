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
from tests._srcscan import module_source

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
    src = module_source("writers.py").split("\n")   # skips on a mutmut file — see tests/_srcscan.py
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
    src = module_source("writers.py")   # skips on a mutmut file — see tests/_srcscan.py
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


# ── THE RECONNECT BOUNDARY IS EXAMINED (2026-09-22) ─────────────────────────────────────────────
# The real geometry: smoketest 2026-09-21, H10 ECG. Session 1's last row and session 2's first row,
# verbatim from the file — device clock +243,739,222,431 ms over a host step of 84,638 ms.
_S1_LAST_NS, _S1_LAST_PHONE = 599616098054140718, dt.datetime(2026, 9, 21, 21, 20, 35, 988000)
_S2_FIRST_NS, _S2_FIRST_PHONE = 843355320485590198, dt.datetime(2026, 9, 21, 21, 22, 0, 626000)


def _session1(tmp_path):
    import writers

    p = str(tmp_path / "Polar_H10_x_20260921211843_ECG.txt")
    w1 = writers.StreamWriter(p, "ecg", fsync=False)
    for i in range(3):
        w1.write_ecg(
            _S1_LAST_PHONE - dt.timedelta(milliseconds=8 * (2 - i)), _S1_LAST_NS - 7_690_000 * (2 - i), 0.0, -20333
        )
    w1.close()
    return p


def test_PLANT_a_resumed_writer_examines_the_reconnect_boundary(tmp_path):
    """The unfixed code printed `seams=0 examined=0` for session 2's first interval — the seam."""
    import writers

    p = _session1(tmp_path)
    w2 = writers.StreamWriter(p, "ecg", fsync=False)  # resumes: same path, non-empty
    assert w2.resumed
    w2.write_ecg(_S2_FIRST_PHONE, _S2_FIRST_NS, 0.0, -273)  # the boundary sample
    w2.close()
    body = open(p[:-4] + "SEAMS.txt").read()
    rows = [x for x in body.splitlines() if x and not x.startswith("#") and not x.startswith("phone_ts")]
    assert len(rows) == 1, body
    dev_step_ms = float(rows[0].split(";")[2])
    assert abs(dev_step_ms - 243_739_222_431.0) < 1.0, rows[0]
    assert "# final stream=ecg seams=0 examined=2" in body  # session 1: two intervals, no seam
    assert "# final stream=ecg seams=1 examined=1" in body  # session 2: THE boundary, counted


def test_CONTROL_the_unseeded_sidecar_is_blind_to_the_same_boundary(tmp_path):
    """Fixed and unfixed must print DIFFERENT bytes on the same two samples, or the plant proves
    nothing: an unseeded instance stores the first sample and judges no interval."""
    import writers

    sc = writers._SeamSidecar(str(tmp_path / "X_ECG.txt"), "ecg")  # no seed
    sc.feed(_S2_FIRST_PHONE, _S2_FIRST_NS)
    sc.close()
    assert sc.seams == 0 and sc.examined == 0


def test_a_resumed_writer_across_a_DROPOUT_examines_the_boundary_and_finds_no_seam(tmp_path):
    import writers

    p = _session1(tmp_path)
    w2 = writers.StreamWriter(p, "ecg", fsync=False)
    gap = dt.timedelta(seconds=84.638)  # both clocks advance TOGETHER
    w2.write_ecg(_S1_LAST_PHONE + gap, _S1_LAST_NS + 84_638_000_000, 0.0, -273)
    w2.close()
    body = open(p[:-4] + "SEAMS.txt").read()
    assert "# final stream=ecg seams=0 examined=1" in body, body  # examined, not skipped; not a seam


def test_the_seed_keeps_at_rel_on_the_files_own_axis_for_ecg(tmp_path):
    import writers

    p = _session1(tmp_path)
    w2 = writers.StreamWriter(p, "ecg", fsync=False)
    assert w2._seams._first_ns == _S1_LAST_NS - 7_690_000 * 2  # the FILE's first sample, not the seed
    w2.close()


def test_last_row_clocks_hands_over_NOTHING_rather_than_a_fabricated_clock(tmp_path):
    """§∅ at the seed: absence is None, never 0. Every refusing branch, one case each."""
    import writers

    f = tmp_path / "s.txt"
    assert writers._last_row_clocks(str(tmp_path / "absent.txt")) is None  # no file
    f.write_text("")
    assert writers._last_row_clocks(str(f)) is None  # empty
    f.write_text("# comment\nPhone timestamp;sensor timestamp [ns];x\n")
    assert writers._last_row_clocks(str(f)) is None  # header only
    f.write_text("Phone timestamp;a;b\n2026-09-21T21:20:35.988;;1\n")
    assert writers._last_row_clocks(str(f)) is None  # _ns_col(None) → ''
    f.write_text("Phone timestamp;a;b\nnot-a-timestamp;599616098054140718;1\n")
    assert writers._last_row_clocks(str(f)) is None  # bad phone ts
    f.write_text("Phone timestamp;a;b\n2026-09-21T21:20:35.988;599616098054140718;1\n")
    ns, ms = writers._last_row_clocks(str(f))
    assert ns == 599616098054140718
    assert abs(ms - dt.datetime(2026, 9, 21, 21, 20, 35, 988000).timestamp() * 1000.0) < 0.001


def test_a_torn_last_row_is_skipped_for_the_seed_too(tmp_path):
    """A resumed writer truncates a torn tail before appending; the seed must read the last COMPLETE
    row (the one before the tear), matching the truncated file the writer goes on to append to."""
    import writers

    p = _session1(tmp_path)
    with open(p, "a") as fh:
        fh.write("2026-09-21T21:20:36.0")  # torn: no newline, no clock
    w2 = writers.StreamWriter(p, "ecg", fsync=False)
    assert w2._seams._prev_ns == _S1_LAST_NS
    w2.close()


# ── RESUME IS THE SIDECAR'S OWN PROPERTY, NOT THE PARENT'S (2026-09-23) ─────────────────────────
# Wren, on the box: last night's H10 `ECGSEAMS.txt` carried NO header while the Verity's did. The
# sidecar INHERITED `resumed` from its parent StreamWriter — the only resumable writer here that did
# — and #2902 made it open LAZILY, so "the parent is resuming a file-set" stopped implying "my own
# file exists with a header". On that path it opened "a" on a path that did not exist and skipped the
# header by design, leaving a sidecar that never says what it is.
def test_PLANT_a_resumed_PARENT_with_no_sidecar_file_still_writes_the_header(tmp_path):
    import writers
    p = str(tmp_path / "Polar_H10_x_20260922223818_ECG.txt")
    w1 = writers.StreamWriter(p, "ecg", fsync=False)
    w1.write_ecg(dt.datetime(2026, 9, 22, 22, 38, 18), 1_000_000_000, 0.0, -20000)
    w1.close()
    seams = p[:-4] + "SEAMS.txt"
    os.remove(seams)                      # the observed state: parent resumable, sidecar absent

    w2 = writers.StreamWriter(p, "ecg", fsync=False)
    assert w2.resumed, "the PARENT is resuming — that is the whole setup"
    w2.write_ecg(dt.datetime(2026, 9, 22, 22, 38, 26), 1_008_000_000, 0.0, -20001)
    w2.close()

    body = open(seams).read()
    assert body.startswith("# stream=ecg rule=clock-seam"), f"a sidecar that cannot say what it is: {body!r}"
    assert "phone_ts;idx;device_step_ms" in body, body


def test_a_sidecar_resuming_its_OWN_non_empty_file_does_not_re_emit_the_header(tmp_path):
    """The other half: self-detection must still APPEND rather than truncate or duplicate."""
    import writers
    p = str(tmp_path / "X_ECG.txt")
    sc = writers._SeamSidecar(p, "ecg")
    sc.feed(dt.datetime(2026, 9, 22, 22, 0, 0), 1_000_000_000)
    sc.close()
    first = open(p[:-4] + "SEAMS.txt").read()
    assert first.count("rule=clock-seam") == 1

    sc2 = writers._SeamSidecar(p, "ecg")          # same path, now non-empty
    sc2.feed(dt.datetime(2026, 9, 22, 23, 0, 0), 2_000_000_000)
    sc2.close()
    body = open(p[:-4] + "SEAMS.txt").read()
    assert body.count("rule=clock-seam") == 1, "the header must not be re-emitted on resume"
    assert body.startswith(first), "the earlier session's bytes must survive verbatim"
    assert body.count("# final") == 2, "one per session"

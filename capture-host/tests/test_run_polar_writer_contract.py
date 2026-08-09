# tepna-capture — tests/test_run_polar_writer_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""What `run_polar` puts IN the capture files — the durable record, read back and checked.

Third family from the `run_polar` mutation pass (RUN-POLAR-MUTATION-PASS-2026-08-08). 22 REACHABLE
survivors sat on the writer dispatch — `wr.write_ppi(smp.phone, smp.sensor_ns, v[0], v[1], v[2], v[3])`
and its five siblings — with an argument dropped, reordered, or replaced by None.

WHY THEY ALL SURVIVED. `test_capture_runners.py` drives every stream and then asserts the FILES EXIST:

    ecgs = list((tmp_path / "captures").rglob("*_ECG.txt"))
    assert ecgs and ecgs[0].stat().st_size > 60

A file's existence and its size are invariant under every one of these mutations. A PPI row with `hr`
and `pp_ms` transposed is the same length as a correct one.

THIS IS THE MIRROR OF THE LIVE-BUS FAMILY. `test_run_polar_live_contract.py` pins what reaches the
monitor and disappears; this pins what is written to disk and is the only copy. The second is the
thing the box exists to produce: a wrong column here is not noticed until someone computes HRV from
the night, months later, and it is not recoverable.

The values in the fixture frames are chosen to be mutually distinguishable — PPI carries hr=60,
interval=850 ms, error=5 — so a transposition FAILS rather than coincidentally matching.
"""
import asyncio
import sys

import capture

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import test_capture_runners as T

_clean_stop = T._clean_stop          # the same module-global reset; see the live-contract file


def _rows(tmp_path, suffix):
    """(header, data rows) of the one capture file with this suffix."""
    hits = list((tmp_path / "captures").rglob(f"*_{suffix}.txt"))
    assert len(hits) == 1, f"expected exactly one *_{suffix}.txt, got {[p.name for p in hits]}"
    lines = hits[0].read_text().splitlines()
    return lines[0], [ln for ln in lines[1:] if ln.strip()]


def _run(monkeypatch, tmp_path, streams, frames, hr_frame=None):
    T._polar_common(monkeypatch)
    T._inject_connect(monkeypatch, T.FlexPolarClient(data_frames=frames, hr_frame=hr_frame))
    T._stop_after(monkeypatch, 1)
    asyncio.run(capture.run_polar(T._pdev(streams=streams), str(tmp_path)))


# ── PPI: the column order that a header alone cannot enforce ────────────────────────────────────────
def test_a_PPI_row_is_INTERVAL_first_and_HR_last(tmp_path, monkeypatch):
    """PSL's PPI layout, and the one most worth pinning: the file says
    `PP-interval [ms];error estimate [ms];blocker;contact;contact;hr [bpm]`, while the call site passes
    `(v[0], v[1], v[2], v[3])` = (hr, pp_ms, err, flags) and `write_ppi` reorders them.

    Transposed, every row still parses, still has the right column count, and still has a plausible
    number in each slot — 60 is a believable interval only if you are not looking, and 850 is not a
    believable HR only if you are. Nothing downstream rejects it; HRV computed from that night is
    simply wrong."""
    _run(monkeypatch, tmp_path, ["ppi"], [T._ppi_frame()])
    header, rows = _rows(tmp_path, "PPI")
    assert rows, "no PPI beat was written"
    cols = rows[0].split(";")
    assert len(cols) == 7, f"PSL's PPI row is 7 columns, got {len(cols)}: {rows[0]}"
    assert cols[1] == "850", f"column 2 is the PP-interval in ms; got {cols[1]!r} from {rows[0]!r}"
    assert cols[2] == "5", f"column 3 is the error estimate; got {cols[2]!r}"
    assert cols[-1] == "60", f"the LAST column is hr [bpm]; got {cols[-1]!r} from {rows[0]!r}"
    assert header.split(";")[1].startswith("PP-interval"), header
    assert header.split(";")[-1].startswith("hr"), header


def test_the_PPI_flag_bits_are_split_into_their_own_columns(tmp_path, monkeypatch):
    """`flags & 1`, `>>1 & 1`, `>>2 & 1` — blocker, contact, contact. The fixture sends 0x06 = 0b110, so
    the three columns must read 0,1,1; a dropped shift or a wrong mask reorders skin-contact truth."""
    _run(monkeypatch, tmp_path, ["ppi"], [T._ppi_frame()])
    _h, rows = _rows(tmp_path, "PPI")
    assert rows[0].split(";")[3:6] == ["0", "1", "1"], (
        f"flags 0x06 must split to blocker=0, contact=1, contact=1; got {rows[0]}")


# ── the multi-channel streams: a dropped axis is a silent one-third loss ────────────────────────────
def test_ACC_writes_all_three_axes_in_order(tmp_path, monkeypatch):
    _run(monkeypatch, tmp_path, ["acc"], [T._acc_frame()])
    _h, rows = _rows(tmp_path, "ACC")
    assert rows[0].split(";")[2:5] == ["10", "-20", "1000"], (
        f"X;Y;Z must be written in order and unmodified; got {rows[0]}")


def test_GYRO_and_MAG_keep_their_SCALED_float_values(tmp_path, monkeypatch):
    """These two arrive already scaled to physical units by `pmd.axis_scale`, so they cannot use ACC's
    integer formatting. A dropped axis or a swapped pair is invisible in a file listing."""
    _run(monkeypatch, tmp_path, ["gyro", "mag"], [T._gyro_frame(), T._mag_frame()])
    for suffix, raw in (("GYRO", (1, 2, 3)), ("MAG", (4, 5, 6))):
        _h, rows = _rows(tmp_path, suffix)
        vals = [float(x) for x in rows[0].split(";")[2:5]]
        assert len(vals) == 3, f"{suffix}: three axes, got {vals}"
        assert vals[0] < vals[1] < vals[2], (
            f"{suffix}: the axes must keep their order — raw {raw} is strictly increasing, got {vals}")
        assert all(v != 0 for v in vals), f"{suffix}: a zeroed axis means an argument was dropped: {vals}"


def test_PPG_writes_THREE_optical_channels_plus_AMBIENT_as_a_separate_column(tmp_path, monkeypatch):
    """`write_ppg(..., v[:3], v[3])` — the 3 LEDs and the ambient reference are split at the call site,
    not inside the writer. Passing all four as channels, or ambient as a channel, silently turns the
    reference into a fourth LED — and PpgDex's consensus vote would then average the reference into the
    signal it exists to subtract."""
    _run(monkeypatch, tmp_path, ["ppg"], [T._ppg_frame()])
    header, rows = _rows(tmp_path, "PPG")
    cols = rows[0].split(";")
    assert len(cols) == 6, f"phone;sensor_ns;ch0;ch1;ch2;ambient = 6 columns, got {len(cols)}: {rows[0]}"
    assert cols[2:5] == ["11", "12", "13"], f"the three LED channels, in order; got {cols[2:5]}"
    assert cols[5] == "14", f"ambient is its OWN last column, not a fourth LED; got {cols[5]!r}"
    assert header.split(";")[-1] == "ambient", header


def test_ECG_writes_the_microvolt_sample_and_the_DEVICE_clock(tmp_path, monkeypatch):
    _run(monkeypatch, tmp_path, ["ecg"], [T._ecg_frame()])
    _h, rows = _rows(tmp_path, "ECG")
    assert len(rows) == 3, f"the fixture frame carries three samples; got {len(rows)}"
    for r in rows:
        assert len(r.split(";")) == 4, f"phone;sensor_ns;rel_ms;uv = 4 columns, got {r}"
        assert r.split(";")[3] == "7", f"the µV sample must survive unmodified; got {r}"
    # The frame stamps only its LAST sample; the earlier ones are BACK-TIMED off the device's own
    # counter rather than off arrival, so the ns column must climb to exactly the frame's value.
    ns = [int(r.split(";")[1]) for r in rows]
    assert ns[-1] == 1_000_000_000, f"the last sample carries the frame's own ns; got {ns}"
    assert ns[0] < ns[1] < ns[2], f"back-timing must be strictly increasing; got {ns}"


# ── HR: one notification, two files ─────────────────────────────────────────────────────────────────
def test_an_HR_notification_writes_the_BPM_row_and_a_SEPARATE_RR_file(tmp_path, monkeypatch):
    """PSL splits these: one HR row per notification in `_HR.txt`, one row per interval in `_RR.txt`.
    `write_hr(_now(), 0, bpm, rr)` passes both from one call, so a dropped argument loses a whole file's
    worth of the night — and `_RR.txt` is the HRV substrate, the reason the strap is worn at all."""
    hr = bytes([0x06, 57]) + (870).to_bytes(2, "little")
    _run(monkeypatch, tmp_path, ["ecg", "hr"], [T._ecg_frame()], hr_frame=hr)
    _h, hr_rows = _rows(tmp_path, "HR")
    assert hr_rows and hr_rows[0].split(";")[1] == "57", f"the device's own bpm; got {hr_rows[0]}"
    _h2, rr_rows = _rows(tmp_path, "RR")
    assert rr_rows, "the RR sibling file must be written — it is the HRV substrate"
    assert rr_rows[0].split(";")[1] == str(round(870 / 1024 * 1000)), (
        f"RR is converted from the SIG's 1/1024 s units to ms; got {rr_rows[0]}")


# ── every stream reaches its OWN file ────────────────────────────────────────────────────────────────
def test_each_measurement_lands_in_its_OWN_file_and_none_is_empty(tmp_path, monkeypatch):
    """The dispatch is a chain of `elif meas == pmd.X`. A mutated comparison sends one stream's samples
    into another's writer — both files still exist and both still have rows, so a listing looks right."""
    _run(monkeypatch, tmp_path, ["ecg", "acc", "ppg", "gyro", "mag", "ppi"],
         [T._ecg_frame(), T._acc_frame(), T._ppg_frame(), T._gyro_frame(), T._mag_frame(), T._ppi_frame()])
    widths = {}
    for suffix in ("ECG", "ACC", "PPG", "GYRO", "MAG", "PPI"):
        _h, rows = _rows(tmp_path, suffix)
        assert rows, f"{suffix}: its own frame was sent and nothing was written"
        assert len({len(r.split(";")) for r in rows}) == 1, f"{suffix}: ragged rows: {rows}"
        widths[suffix] = len(rows[0].split(";"))
    # Column counts are a shape fingerprint: a mis-routed sample writes the wrong number of columns.
    assert widths == {"ECG": 4, "ACC": 5, "PPG": 6, "GYRO": 5, "MAG": 5, "PPI": 7}, widths


# ── the device clock is column 2 on every waveform stream ───────────────────────────────────────────
# `sensor_ns` is what makes a row placeable on the DEVICE's own timebase rather than on arrival, and
# DEVICE-RATE-TRUTH §6.3 is entirely about why that distinction matters: BLE hands several frames over
# in one connection event, so arrival times collapse and a rate measured from them reports the radio's
# batching. A `None` here writes the literal string "None" into that column — the row still parses,
# still has the right width, and its device clock is gone.
def test_every_waveform_row_carries_the_DEVICE_ns_counter(tmp_path, monkeypatch):
    _run(monkeypatch, tmp_path, ["ecg", "acc", "ppg", "gyro", "mag"],
         [T._ecg_frame(), T._acc_frame(), T._ppg_frame(), T._gyro_frame(), T._mag_frame()])
    for suffix in ("ECG", "ACC", "PPG", "GYRO", "MAG"):
        header, rows = _rows(tmp_path, suffix)
        assert header.split(";")[1] == "sensor timestamp [ns]", f"{suffix} header: {header}"
        ns = rows[-1].split(";")[1]
        assert ns.isdigit(), f"{suffix}: column 2 must be the device ns counter, got {ns!r}"
        assert int(ns) == 1_000_000_000, (
            f"{suffix}: the frame stamped 1e9 ns and the file must carry it; got {ns}")


def test_PPI_and_HR_carry_NO_device_clock_column(tmp_path, monkeypatch):
    """The deliberate asymmetry, and the reason two writer parameters are dead on purpose. PPI frames
    carry no usable device clock — every row this box has written has `sensor_ns == 0` — so `write_ppi`
    accepts the argument for call-site symmetry and does not emit it. `nightqc.file_span_sec` already
    assumes exactly that. Pinning it stops someone "fixing" the writer to emit a column of zeros."""
    hr = bytes([0x06, 57]) + (870).to_bytes(2, "little")
    _run(monkeypatch, tmp_path, ["ppi", "hr"], [T._ppi_frame()], hr_frame=hr)
    for suffix in ("PPI", "HR"):
        header, _rows_ = _rows(tmp_path, suffix)
        assert "sensor timestamp" not in header, (
            f"{suffix} must NOT carry a device-clock column — it has no usable device clock: {header}")

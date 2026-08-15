# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""END-TO-END timing test for the capture write path (KNOWN-CLOCK-ADVERSARIAL-CAPTURE, target 4).

WHY THIS FILE EXISTS. The known-clock experiment injects defects into the arrival SIDECAR and asks the
JS estimator to recover them. That leaves the capture daemon itself outside the loop: everything it
does — decoding a PMD frame, stamping arrival, formatting the CSV — happens BEFORE the substrate those
experiments perturb. So a defect introduced during acquisition would be invisible to all of them, and
`capture-host` is the one component here that holds a 100 % coverage floor while having no test that
follows a clock relationship from a wire frame to a recovered rate.

WHAT IT ASSERTS. A device clock running at a KNOWN offset from host arrival goes in as raw PMD bytes;
the real `decode_frame` parses it, the real `PmdArrivalLogWriter` writes it, the file is read back, and
the rate is recovered from the written columns. The recovered ppm must match what was planted. Nothing
here reimplements a writer or a parser — a test that formats its own CSV would pass while the shipped
formatter was broken, which is precisely the gap being closed.

DETERMINISM. No randomness and no wall clock: every arrival is computed from a fixed base instant.
"""
import datetime as dt
import struct

import polar_pmd as pmd
import writers


def _ecg_frame(last_ns: int, n_samples: int = 10) -> bytes:
    """One uncompressed ECG PMD notification whose LAST sample carries `last_ns`.

    Layout per the vendor spec, as `decode_frame` reads it: type byte, u64 device ns of the LAST
    sample, frame-type byte (0 = uncompressed), then 3-byte little-endian signed microvolt samples.
    """
    body = b"".join((100 + i).to_bytes(3, "little", signed=True) for i in range(n_samples))
    return bytes([pmd.ECG]) + struct.pack("<Q", last_ns) + bytes([0x00]) + body


def _write_and_recover(tmp_path, ppm: float, minutes: int = 40, hz: float = 130.0):
    """Plant a device-vs-host rate of `ppm`, run the REAL decode + write path, recover it from file.

    Sign convention, stated because it is the classic route to a confident wrong answer: a device
    running FAST accumulates device-time faster than host-time, so `host - device` SHRINKS and the
    recovered rate is NEGATIVE. The caller passes the device's error and we assert against `-ppm`.
    """
    base = dt.datetime(2026, 8, 14, 23, 0, 0)
    path = str(tmp_path / "Polar_H10_TEST_20260814230000_PMDARRIVAL.csv")
    w = writers.PmdArrivalLogWriter(path, flush_interval=0.0, fsync=False)
    samples_per_frame = 10
    frame_dt = samples_per_frame / hz                      # seconds of real time per frame
    n_frames = int(minutes * 60 / frame_dt)
    dev_epoch_ns = 800_000_000_000_000_000                 # arbitrary device epoch, as the wire carries
    prev_last = None
    for i in range(n_frames):
        host_elapsed = i * frame_dt                        # true elapsed host seconds
        dev_elapsed = host_elapsed * (1.0 + ppm / 1e6)     # the device's own, wrong, elapsed time
        last_ns = dev_epoch_ns + int(round(dev_elapsed * 1e9))
        arrival = base + dt.timedelta(seconds=host_elapsed)
        meas, samples = pmd.decode_frame(_ecg_frame(last_ns, samples_per_frame), arrival,
                                         fs=hz, prev_last_ns=prev_last)
        assert meas == pmd.ECG and samples, "the shipped decoder rejected a well-formed ECG frame"
        prev_last = last_ns
        w.write(arrival, "Polar H10 TEST", "ecg", samples[0].sensor_ns, last_ns, len(samples))
    w.close()

    # ── read back exactly what was written and recover the rate ────────────────────────────────
    rows = []
    with open(path) as fh:
        header = fh.readline().strip()
        for line in fh:
            c = line.rstrip("\n").split(";")
            if len(c) < 6 or not c[3]:
                continue
            host = dt.datetime.strptime(c[0], "%Y-%m-%dT%H:%M:%S.%f")
            rows.append((host, int(c[3])))
    assert header == "Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples"
    assert len(rows) > 100, f"only {len(rows)} rows survived the write path"

    h0, d0 = rows[0][0], rows[0][1]
    span_s = (rows[-1][1] - d0) / 1e9
    resid_s = ((rows[-1][0] - h0).total_seconds()) - span_s
    return (resid_s / span_s) * 1e6 if span_s else None


def test_write_path_preserves_a_planted_clock_rate(tmp_path):
    """A rate planted on the wire survives decode + write + read-back, at the right sign and size."""
    for ppm in (0.0, 50.0, -50.0, 200.0):
        got = _write_and_recover(tmp_path, ppm)
        assert got is not None
        # host-minus-device, so a fast device reads NEGATIVE
        assert abs(got - (-ppm)) < 2.0, f"planted {ppm:+.0f} ppm on the wire, recovered {got:+.3f}"


def test_write_path_null_control_is_exactly_flat(tmp_path):
    """No planted error must recover as no error — a write path that invented one would show here."""
    got = _write_and_recover(tmp_path, 0.0)
    assert abs(got) < 0.5, f"an unperturbed capture recovered {got:+.4f} ppm"


def test_arrival_stamp_has_millisecond_resolution(tmp_path):
    """The recovered rate is only as good as the stamp's resolution, so pin it.

    A 40 min span at 1 ppm is 2.4 ms of divergence: a stamp truncated to whole seconds would make
    every rate below ~400 ppm unrecoverable, and the test above would still pass at 200 ppm. This
    asserts the property that makes the others meaningful rather than trusting the format string.
    """
    path = str(tmp_path / "x_PMDARRIVAL.csv")
    w = writers.PmdArrivalLogWriter(path, flush_interval=0.0, fsync=False)
    w.write(dt.datetime(2026, 8, 14, 23, 0, 0, 123456), "dev", "ecg", 1, 2, 3)
    w.close()
    stamp = open(path).read().strip().split("\n")[1].split(";")[0]
    frac = stamp.split(".")[-1]
    assert len(frac) >= 3, f"arrival stamp {stamp!r} carries no sub-second field"
    assert frac.startswith("123"), f"arrival stamp {stamp!r} lost its milliseconds"


def test_blank_sensor_ns_is_written_blank_not_zero(tmp_path):
    """A missing device stamp must stay missing. A fabricated 0 would read as a real instant at the
    device epoch and drag any rate fitted through it — the §2.6 rule applied to the write path."""
    path = str(tmp_path / "y_PMDARRIVAL.csv")
    w = writers.PmdArrivalLogWriter(path, flush_interval=0.0, fsync=False)
    w.write(dt.datetime(2026, 8, 14, 23, 0, 0), "dev", "ecg", None, None, 0)
    w.close()
    cols = open(path).read().strip().split("\n")[1].split(";")
    assert cols[3] == "" and cols[4] == "", f"missing device stamps were written as {cols[3:5]!r}"

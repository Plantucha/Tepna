# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""O2Ring finger-site PPG is written as ONE optical column, not replicated across three.

PPGDEX-O2RING-FINGER-SITE §3/§7. The host used to fan the ring's single decoded value into
ppg0/1/2 so it could ride the Verity's 3-LED PSL layout. Downstream that is not a formatting
detail: PpgDex's consensus vote saw three "independent" channels agreeing perfectly and reported
ledAgreementPct 100 at `measured` tier — a fabricated quality claim over one sensor counted three
times (ENGINE-VERIFICATION-FINDINGS §1.3).

These tests pin the honest shape at the point it is written, in BOTH directions: the 1-column
stream must stay 1 column, and the Verity's 3-LED stream must be untouched.
"""
from __future__ import annotations

import datetime as _dt

from writers import StreamWriter


def _read(path):
    with open(path, "r", newline="") as fh:
        return fh.read().splitlines()


def test_ppg1_header_and_rows_are_single_column(tmp_path):
    p = tmp_path / "o2ring_ppg.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    now = _dt.datetime(2026, 7, 19, 2, 14, 7)
    for i, v in enumerate((101, 98, 156, 97)):
        w.write_ppg(now, 1_000_000 * i, 0.0, (v,), 0)
    w.close() if hasattr(w, "close") else w._fh.flush()

    lines = _read(str(p))
    assert lines[0] == "Phone timestamp;sensor timestamp [ns];channel 0", lines[0]
    # exactly THREE fields per row — a fourth would mean an ambient or a replicated column crept back
    for row in lines[1:]:
        assert row.count(";") == 2, row
    # the decoded value is carried verbatim, including a raw 156: the sentinel is rejected downstream
    # by ISOLATION (ppgdex-dsp.js), never suppressed at the writer — the host does not judge samples.
    assert [r.split(";")[2] for r in lines[1:]] == ["101", "98", "156", "97"]


def test_ppg1_never_replicates_the_single_value(tmp_path):
    """The specific regression: one value must not appear three times on a row."""
    p = tmp_path / "o2ring_ppg.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    w.write_ppg(_dt.datetime(2026, 7, 19, 2, 14, 7), 0, 0.0, (123,), 0)
    w._fh.flush()
    row = _read(str(p))[1]
    assert row.split(";")[2:] == ["123"], row
    assert ";123;123" not in row, "the single pleth value was fanned across channels again: " + row


def test_verity_three_led_layout_is_unchanged(tmp_path):
    """BOTH directions — the wrist stream keeps its 3 channels + ambient."""
    p = tmp_path / "verity_ppg.txt"
    w = StreamWriter(str(p), "ppg", fsync=False)
    w.write_ppg(_dt.datetime(2026, 7, 19, 2, 14, 7), 0, 0.0, (-499500, -508840, -516640), -650690)
    w._fh.flush()
    lines = _read(str(p))
    assert lines[0] == "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient"
    assert lines[1].split(";")[2:] == ["-499500", "-508840", "-516640", "-650690"], lines[1]


def test_header_column_count_matches_row_column_count(tmp_path):
    """The drift this stream key exists to prevent.

    PpgDex resolves the layout by COUNTING the named optical columns in the header. A 3-column
    header over 1-column rows would resolve to the wrist path and read the sensor-ns column as
    light — so header and row shape must agree for every ppg stream, by construction.
    """
    for stream, ch, ambient in (("ppg1", (100,), 0), ("ppg", (1, 2, 3), 4)):
        p = tmp_path / f"{stream}.txt"
        w = StreamWriter(str(p), stream, fsync=False)
        w.write_ppg(_dt.datetime(2026, 7, 19, 2, 14, 7), 0, 0.0, ch, ambient)
        w._fh.flush()
        lines = _read(str(p))
        assert lines[0].count(";") == lines[1].count(";"), f"{stream}: header/row column mismatch"
        # and the header really does name as many optical columns as the device has sensors
        assert lines[0].count("channel ") == len(ch), f"{stream}: header names the wrong sensor count"

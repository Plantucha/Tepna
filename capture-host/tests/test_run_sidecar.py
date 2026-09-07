# tepna-capture — tests/test_run_sidecar.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The constant-run sidecar: absence-as-value spans recorded BESIDE an optical stream, never into it.
#
# Every test plants a KNOWN span and asserts the exact rows that come back, because the failure this
# file exists to catch is the silent one: a rule that matches nothing emits no rows, and so does a
# clean stream. Only a plant separates "looked and found nothing" from "never looked".
#
# The live rule is `stuck` (constant run >= T_STUCK) and ONLY that, plus `held` classification for
# zero-order-hold streams. `clip` and `collapse` need the whole night (the ring's 199-clip is not an
# encoding extreme; a running median is O(window) on the BLE notification path) and belong to the
# end-of-night back-check — asserted here so a later "why not live too?" edit trips a named test.

import datetime as _dt
import os

import pytest

import writers
from writers import (HELD_TOP2_SHARE, HELD_WARMUP_RUNS, RUN_MIN_BY_STREAM, T_STUCK, StreamWriter,
                     _RunSidecar)

T0 = _dt.datetime(2026, 9, 6, 4, 53, 0)


def _phone(i: int, hz: float = 125.0) -> _dt.datetime:
    """Host arrival stamps on the recording's own axis, one sample apart at `hz`."""
    return T0 + _dt.timedelta(seconds=i / hz)


def _rows(path):
    """Data rows only — `#` comments and the header are not rows."""
    return [ln.split(";") for ln in open(path).read().splitlines()
            if ln and not ln.startswith("#") and not ln.startswith("Phone")]


def _sidecar(p):
    return str(p).rpartition(".")[0] + "RUNS.txt"


def _push(w, v, n, start=0, hz=125.0):
    for k in range(n):
        w.write_ppg(_phone(start + k, hz), 0, 0.0, (v,), 0)
    return start + n


# ── the rule itself ───────────────────────────────────────────────────────────────────────────

def test_a_stuck_run_is_reported_and_a_legitimate_plateau_is_not(tmp_path):
    """A 12,411-sample constant baseline is reported; a 48-sample plateau (the measured p99.99 of
    real 8-bit pleth) is not. This is the whole reason the threshold is 200 and not 5: at any low
    threshold, 7.3 % of legitimate non-sentinel runs are >= 5 and the rule flags real signal."""
    p = tmp_path / "X_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    i = _push(w, 3, 48)                      # p99.99 plateau — MUST NOT be reported
    i = _push(w, 100, 12411, start=i)        # the real 97 s baseline hold — MUST be reported
    i = _push(w, 7, 4, start=i)              # short tail so the long run closes normally
    w.close()

    rows = _rows(_sidecar(p))
    assert len(rows) == 1, rows
    assert rows[0][1] == "channel 0"
    assert (rows[0][2], rows[0][3], rows[0][4]) == ("100", "48", "12411")
    assert rows[0][6] == "1" and rows[0][7] == "stuck"
    assert float(rows[0][5]) == pytest.approx(12410 / 125.0 * 1000.0, abs=1.0)  # 12410 gaps


def test_the_beat_marker_falls_out_without_the_rule_ever_naming_its_value(tmp_path):
    """The O2Ring's 156 marker is a singleton by construction. A value-keyed rule would need editing
    the day the vendor picks another number — and would keep READING as healthy, because a rule that
    matches nothing and a clean stream produce the same empty file."""
    p = tmp_path / "X_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    i = 0
    for _ in range(50):
        i = _push(w, 156, 1, start=i)
        i = _push(w, 9, 2, start=i)
    w.close()

    assert _rows(_sidecar(p)) == []


def test_a_clean_stream_leaves_an_HONEST_EMPTY_sidecar_not_an_absent_one(tmp_path):
    """No qualifying run => the file EXISTS and says so. An absent file and a file saying "I looked
    and found none" are different claims; only the second is usable evidence."""
    p = tmp_path / "X_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    for i in range(400):
        w.write_ppg(_phone(i), 0, 0.0, (i % 97,), 0)
    w.close()

    sc = _sidecar(p)
    assert _rows(sc) == []
    body = open(sc).read()
    assert "rule=stuck" in body and f"t_stuck={T_STUCK}" in body
    assert "runs=0 errors=0" in body


def test_an_open_run_at_close_is_flushed_with_closed_0(tmp_path):
    """A span that runs to the end of the recording has an UNKNOWN end, not a missing existence.
    Dropping it would lose exactly the spans that ran out the night."""
    p = tmp_path / "X_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    _push(w, 3, T_STUCK + 5)
    w.close()

    rows = _rows(_sidecar(p))
    assert len(rows) == 1
    assert rows[0][4] == str(T_STUCK + 5) and rows[0][6] == "0" and rows[0][7] == "stuck"


def test_a_run_straddling_a_flush_is_ONE_run_not_two_pieces(tmp_path):
    """The accumulator must be blind to the write path's periodic flush. If a flush split a run, two
    sub-threshold halves would BOTH vanish and the span would be reported as clean."""
    p = tmp_path / "X_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    n = T_STUCK + 40
    for i in range(n):
        w.write_ppg(_phone(i), 0, 0.0, (8,), 0)
        if i == n // 2:
            w.flush()                        # the event the accumulator must not see
    w.write_ppg(_phone(n), 0, 0.0, (9,), 0)
    w.close()

    rows = _rows(_sidecar(p))
    assert len(rows) == 1, "a flush split the run into sub-threshold pieces"
    assert rows[0][4] == str(n)


# ── which streams, and the zero-order-hold classifier ─────────────────────────────────────────

def test_the_verity_three_column_branch_tracks_each_optical_channel_separately(tmp_path):
    """The Verity goes through the SAME write_ppg (3-column branch), so it gets a sidecar too —
    verified rather than assumed. `ambient` is excluded: a held ambient is not this absence."""
    p = tmp_path / "V_PPG.txt"
    w = StreamWriter(str(p), "ppg", fsync=False)
    n = T_STUCK + 3
    for i in range(n):
        w.write_ppg(_phone(i), 0, 0.0, (4, i % 7, 6), 99)   # ch0/ch2 held, ch1 varies, ambient held
    w.close()

    got = {r[1]: r[4] for r in _rows(_sidecar(p))}
    assert got == {"channel 0": str(n), "channel 2": str(n)}, got


def test_ppg2w_tracks_both_channels_and_ignores_motion(tmp_path):
    p = tmp_path / "X_PPG2W.txt"
    w = StreamWriter(str(p), "ppg2w", fsync=False)
    n = T_STUCK + 2
    for i in range(n):
        w.write_ppg2w(_phone(i), 0, 11, 22, i)              # motion varies every sample
    w.close()

    assert _sidecar(p).endswith("_PPG2WRUNS.txt")
    got = {r[1]: r[4] for r in _rows(_sidecar(p))}
    assert got == {"channel 0": str(n), "channel 1": str(n)}, got


def test_a_zero_order_hold_stream_is_classified_held_and_emits_no_run_rows(tmp_path):
    """The O2Ring ACC updates at 1.5625 Hz and is written at 10 Hz, so ~99.8 % of its runs are length
    6 or 7. Those runs are the SAMPLING CADENCE, not absence. The stream is not excluded by name —
    the shape is measured, so a firmware change that ends the hold starts producing rows by itself."""
    sc = _RunSidecar(str(tmp_path / "A_ACC.txt"), "accraw", T_STUCK)
    for r in range(HELD_WARMUP_RUNS + 5):                  # alternate 6/7-sample runs, as measured
        for k in range(6 + (r % 2)):
            sc.feed("X [raw]", r, _phone(r * 7 + k, hz=10.0))
    sc.close()

    body = open(sc.path).read()
    assert sc.klass["X [raw]"] == "held"
    assert "class=held" in body and "top2=6,7" in body
    assert _rows(sc.path) == []


def test_a_varying_stream_is_classified_variable_and_its_warmup_rows_are_KEPT(tmp_path):
    """The verdict is taken over a warm-up window, so rows found during it are buffered rather than
    guessed at. A `variable` verdict must release them — dropping them would lose the very spans
    that occurred at the start of a night."""
    sc = _RunSidecar(str(tmp_path / "B_PPG.txt"), "ppg1", 4)
    sc.feed("channel 0", 5, _phone(0))
    for k in range(9):                                     # one long run inside the warm-up window
        sc.feed("channel 0", 5, _phone(1 + k))
    for r in range(HELD_WARMUP_RUNS + 2):                  # then varied lengths => not a hold
        for k in range(1 + (r % 5)):
            sc.feed("channel 0", 100 + r, _phone(50 + r * 5 + k))
    sc.close()

    assert sc.klass["channel 0"] == "variable"
    assert any(r[4] == "10" for r in _rows(sc.path)), "the warm-up run was dropped"


def test_the_class_verdict_is_stamped_with_when_it_was_taken(tmp_path):
    """A warm-up verdict is a claim about the START of a recording. It is stamped with the run count
    it was decided at so a reader can see it is a window verdict, not a whole-night one."""
    sc = _RunSidecar(str(tmp_path / "C_ACC.txt"), "accraw", T_STUCK)
    for r in range(HELD_WARMUP_RUNS):
        for k in range(6 + (r % 2)):
            sc.feed("X [raw]", r, _phone(r * 7 + k, hz=10.0))
    sc.close()
    assert f"decided_at={HELD_WARMUP_RUNS}runs" in open(sc.path).read()
    assert f"held_top2_share={HELD_TOP2_SHARE}" in open(sc.path).read()


# ── the seam, ownership, and failure isolation ────────────────────────────────────────────────

def test_emit_run_is_the_ONE_seam_and_names_the_rule_that_found_the_span(tmp_path):
    """A back-check detector (clip/collapse/rail-run) writes through this same call, so every span in
    the corpus lands in ONE file shape with its rule in its own column. A second writer would be a
    second shape to reconcile later."""
    sc = _RunSidecar(str(tmp_path / "D_PPG.txt"), "ppg1", T_STUCK)
    sc.klass["channel 0"] = "variable"                      # past the warm-up
    sc.emit_run("channel 0", 199, 40, 900, 7200.0, 1, "clip", T0)
    sc.close()

    rows = _rows(sc.path)
    assert len(rows) == 1
    assert rows[0][1:] == ["channel 0", "199", "40", "900", "7200.0", "1", "clip"]


def test_clip_and_collapse_are_NOT_computed_live(tmp_path):
    """Asserted so a later "add them to the writer" edit trips a test that names the reason: the
    ring's 199-clip is not an encoding extreme (so "at the range extreme" is a whole-night property),
    and collapse needs a running median — O(window) per sample on the BLE notification path, where
    the failure mode is dropped notifications, i.e. losing the recording to describe it better."""
    src = open(writers.__file__).read()
    body = src[src.index("class _RunSidecar"):src.index("class StreamWriter")]
    assert "median" not in body
    assert "\"clip\"" not in body and "'clip'" not in body


def test_the_sidecar_is_in_paths_so_a_pruned_session_cannot_orphan_it(tmp_path):
    """§C8: a writer-owned file the pruner cannot see becomes an orphan — measured as 4 orphan RR
    files in one day. The sidecar is a THIRD owned file."""
    p = tmp_path / "X_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    w.write_ppg(_phone(0), 0, 0.0, (1,), 0)
    assert _sidecar(p) in w.paths
    w.discard()
    assert not os.path.exists(_sidecar(p)), "discard() left the sidecar behind"


def test_a_sidecar_write_failure_is_ISOLATED_from_the_sample_stream_and_COUNTED(tmp_path):
    """The recording must survive a broken sidecar — and the isolation must not be SILENT, because a
    swallowed exception and a clean run produce the same empty file."""
    p = tmp_path / "X_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)

    class _Boom:
        def write(self, *_a, **_k):
            raise OSError("sidecar disk gone")

        def close(self):
            pass

    w._runs._fh = _Boom()
    n = T_STUCK + 2
    for i in range(n):
        w.write_ppg(_phone(i), 0, 0.0, (1,), 0)            # must not raise
    w.write_ppg(_phone(n), 0, 0.0, (2,), 0)                # closes the run -> write -> raises
    w.close()

    assert w._runs.errors > 0, "isolation was silent — a swallowed failure must be counted"
    assert w.rows == n + 1                                  # the recording itself is untouched
    assert len(open(p).read().splitlines()) == n + 2         # header + every row


def test_a_sidecar_that_cannot_be_opened_does_not_stop_the_capture(tmp_path, monkeypatch):
    """The recording is P0; a note about it is not."""
    real_open = open
    p = tmp_path / "X_PPG.txt"

    def _fail_on_sidecar(path, *a, **k):
        if str(path).endswith("RUNS.txt"):
            raise OSError("read-only fs")
        return real_open(path, *a, **k)

    monkeypatch.setattr("builtins.open", _fail_on_sidecar)
    w = StreamWriter(str(p), "ppg1", fsync=False)
    monkeypatch.undo()
    for i in range(20):
        w.write_ppg(_phone(i), 0, 0.0, (1,), 0)
    w.close()

    assert w._runs.errors == 1
    assert w.rows == 20


def test_the_threshold_has_ONE_source_that_the_file_itself_reports(tmp_path):
    """The writer default and any consumer's recompute default must be one number, and the FILE must
    carry the value that produced its rows — a default can move after the night was recorded."""
    assert set(RUN_MIN_BY_STREAM.values()) == {T_STUCK}
    p = tmp_path / "X_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    w.close()
    body = open(_sidecar(p)).read()
    assert f"t_stuck={T_STUCK}" in body and f"min_run={T_STUCK}" in body


def test_a_HELD_channel_that_gets_stuck_still_reports_it_at_EOF(tmp_path):
    """The measured normal shape of this failure: every non-sentinel run >= 200 over 3.16 M real
    samples was the LAST run in its file. So the row is (a) unclosed and (b) on a channel that may
    already be classified — and a `held` class must not hide it. The ring's ACC repeats each sample
    6-7x by design; 200 identical samples is 20 s of one triplet, which is the failure."""
    sc = _RunSidecar(str(tmp_path / "E_ACC.txt"), "accraw", T_STUCK)
    for r in range(HELD_WARMUP_RUNS + 2):                  # establish the hold class first
        for k in range(6 + (r % 2)):
            sc.feed("X [raw]", r, _phone(r * 7 + k, hz=10.0))
    assert sc.klass["X [raw]"] == "held"
    base = (HELD_WARMUP_RUNS + 2) * 7
    for k in range(T_STUCK + 50):                          # then the stream sticks, and never recovers
        sc.feed("X [raw]", 4242, _phone(base + k, hz=10.0))
    sc.close()

    rows = [r for r in _rows(sc.path) if r[7] == "stuck"]
    assert len(rows) == 1, "a held channel suppressed a genuine stuck run"
    assert rows[0][2] == "4242" and rows[0][4] == str(T_STUCK + 50)
    assert rows[0][6] == "0", "the run ended at EOF and must be reported unclosed"


def test_emit_run_on_a_closed_sidecar_is_a_no_op(tmp_path):
    """A back-check detector may hold a reference past teardown. Writing there must not raise."""
    sc = _RunSidecar(str(tmp_path / "F_PPG.txt"), "ppg1", T_STUCK)
    sc.close()
    sc.emit_run("channel 0", 1, 0, 999, 1.0, 1, "pinned", T0)      # must not raise
    assert sc._fh is None


def test_a_held_channel_still_suppresses_rows_BELOW_the_stuck_threshold(tmp_path):
    """The other half of the unconditional-emit rule: a `held` channel's ordinary cadence runs — the
    ones a back-check rule might report at a lower threshold — stay suppressed. Only >= T_STUCK is
    unconditional, because only that length cannot be the cadence."""
    sc = _RunSidecar(str(tmp_path / "G_ACC.txt"), "accraw", T_STUCK)
    for r in range(HELD_WARMUP_RUNS + 2):
        for k in range(6 + (r % 2)):
            sc.feed("X [raw]", r, _phone(r * 7 + k, hz=10.0))
    assert sc.klass["X [raw]"] == "held"
    sc.emit_run("X [raw]", 5, 10, 7, 700.0, 1, "pinned", T0)       # cadence-length, from a detector
    sc.close()
    assert [r for r in _rows(sc.path) if r[7] == "pinned"] == []


def test_rows_buffered_before_any_verdict_are_RELEASED_at_close(tmp_path):
    """A channel that never reaches the warm-up count still has its buffered rows written, marked
    `undecided`. Withholding them would silently lose spans on exactly the quietest recordings."""
    sc = _RunSidecar(str(tmp_path / "H_PPG.txt"), "ppg1", T_STUCK)
    sc.emit_run("channel 0", 7, 3, 40, 320.0, 1, "pinned", T0)     # below T_STUCK, no verdict yet
    assert _rows(sc.path) == [], "row was written before the class was known"
    sc.close()

    rows = _rows(sc.path)
    assert len(rows) == 1 and rows[0][7] == "pinned"
    assert "class=undecided" in open(sc.path).read()


def test_a_failure_while_writing_the_closing_comments_is_counted(tmp_path):
    """The trailer says whether the census is complete, so a failure writing IT must not read as a
    clean finish."""
    sc = _RunSidecar(str(tmp_path / "I_PPG.txt"), "ppg1", T_STUCK)
    sc.feed("channel 0", 1, _phone(0))

    class _BoomOnClose:
        def write(self, *_a, **_k):
            raise OSError("gone at teardown")

        def close(self):
            pass

    sc._fh = _BoomOnClose()
    sc.close()
    assert sc.errors > 0


def test_a_sidecar_close_that_raises_is_logged_not_swallowed(tmp_path, caplog):
    """`_RunSidecar.close` handles its own IO errors, so an exception reaching StreamWriter means
    something unexpected — it is logged rather than resumed past."""
    p = tmp_path / "J_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)

    class _Exploding:
        path = "x"

        def close(self):
            raise RuntimeError("unexpected")

    w._runs = _Exploding()
    with caplog.at_level("WARNING"):
        w.close()
    assert "run sidecar close failed" in caplog.text


def test_a_span_split_by_an_isolated_marker_is_ONE_span_not_two_fragments(tmp_path):
    """22 % of raw zero runs in the corpus are one event split by an annotation sample the device
    injects mid-span. At T_STUCK this is not cosmetic: two 150-sample halves are BOTH below the
    threshold, so an unmerged span vanishes entirely."""
    p = tmp_path / "K_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    i = _push(w, 0, 150)
    i = _push(w, 156, 1, start=i)            # the isolated marker, mid-span
    i = _push(w, 0, 150, start=i)
    i = _push(w, 44, 5, start=i)             # a real change of level closes the span
    w.close()

    rows = _rows(_sidecar(p))
    assert len(rows) == 1, f"span was emitted as fragments: {rows}"
    assert rows[0][2] == "0"
    assert rows[0][3] == "0"                 # the span starts where the FIRST fragment did
    assert rows[0][4] == "301", "n must span the whole event including the interrupting sample"


def test_a_REAL_sample_inside_a_span_is_never_merged_over(tmp_path):
    """The sidecar's claim is NOT MEASURED. A sample of value 1 or 2 inside a zero run WAS measured,
    so merging over it fabricates absence — the mirror image of the fabricated zero this file exists
    to record. Only DECLARED annotation values (rows the device inserts) may be spanned.

    An earlier draft merged across a short run of any value, on the argument that a value-keyed rule
    rots when the vendor changes its marker. That is a real risk and it is answered by making the
    annotation set a PARAMETER (below), not by loosening what the file asserts."""
    p = tmp_path / "L_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    i = _push(w, 0, 150)
    i = _push(w, 2, 3, start=i)              # a REAL low sample, not an inserted annotation
    i = _push(w, 0, 150, start=i)
    i = _push(w, 44, 5, start=i)
    w.close()

    assert _rows(_sidecar(p)) == [], "a measured sample was merged over, fabricating absence"


def test_the_annotation_set_is_a_PARAMETER_not_a_literal_in_the_rule(tmp_path):
    """Portability without a value-keyed detector: a device that changes its marker changes one
    declared constant. The merge itself never names a value, and a stream that declares NO
    annotations never merges at all."""
    from writers import ANNOTATIONS_BY_STREAM, _ANNOTATION_GAP_MAX
    import oxyii

    assert ANNOTATIONS_BY_STREAM["ppg1"] == frozenset({oxyii.PPG_BEAT_MARKER})
    assert ANNOTATIONS_BY_STREAM["ppg"] == frozenset()          # Verity inserts nothing
    assert ANNOTATIONS_BY_STREAM["acc"] == frozenset()

    # A stream with an empty annotation set does not merge, even across a marker-shaped interruption.
    p = tmp_path / "L2_PPG.txt"
    w = StreamWriter(str(p), "ppg", fsync=False)
    n = 150
    for k in range(n):
        w.write_ppg(_phone(k), 0, 0.0, (0, 0, 0), 0)
    w.write_ppg(_phone(n), 0, 0.0, (oxyii.PPG_BEAT_MARKER,) * 3, 0)
    for k in range(n):
        w.write_ppg(_phone(n + 1 + k), 0, 0.0, (0, 0, 0), 0)
    w.write_ppg(_phone(2 * n + 1), 0, 0.0, (44, 44, 44), 0)
    w.close()

    assert _rows(_sidecar(p)) == [], "a stream declaring no annotations merged anyway"

    # And the declared set travels in the file, so a recompute uses the set that produced the rows.
    body = open(_sidecar(p)).read()
    assert "annotations=none" in body
    assert f"merge_gap_max={_ANNOTATION_GAP_MAX}" in body


def test_an_interruption_LONGER_than_the_bound_does_not_merge(tmp_path):
    """The gap bound is what stops the merge joining two genuinely separate events. Above it the
    fragments stand alone — and at T_STUCK that means they are simply not reported."""
    p = tmp_path / "M_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    i = _push(w, 0, 150)
    i = _push(w, 156, 9, start=i)            # 9 > _ANNOTATION_GAP_MAX = 8
    i = _push(w, 0, 150, start=i)
    i = _push(w, 44, 5, start=i)
    w.close()

    assert _rows(_sidecar(p)) == []


def test_a_short_run_that_does_NOT_resume_the_held_value_is_not_merged_in(tmp_path):
    """A held span, then a short run, then a DIFFERENT value: the short run was ordinary signal, not
    a gap. Merging it would manufacture a span across a real change of level."""
    p = tmp_path / "N_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    i = _push(w, 0, T_STUCK + 10)
    i = _push(w, 5, 2, start=i)              # short, but the next value is not 0
    i = _push(w, 90, 30, start=i)
    w.close()

    rows = _rows(_sidecar(p))
    assert len(rows) == 1
    assert rows[0][2] == "0" and rows[0][4] == str(T_STUCK + 10), "the short run was absorbed"


def test_a_quantised_clean_sine_yields_ZERO_spans(tmp_path):
    """The negative control real data cannot supply: a signal that is unambiguously healthy. If this
    ever emits a row, the rule is flagging physiology — and on real files that failure is invisible,
    because a flagged clean night and a genuinely bad night both just produce rows."""
    import math
    p = tmp_path / "O_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    for i in range(20000):                   # ~160 s at 125 Hz, 8-bit, ~1.2 Hz pulse on a 100 baseline
        v = int(round(100 + 8 * math.sin(2 * math.pi * 1.2 * i / 125.0)))
        w.write_ppg(_phone(i), 0, 0.0, (v,), 0)
    w.close()

    assert _rows(_sidecar(p)) == [], "the rule flagged a clean quantised sine"


def test_the_comment_line_publishes_EVERY_parameter_that_shaped_the_rows(tmp_path):
    """The file must reproduce itself: a consumer recomputing these spans reads the parameters that
    PRODUCED them, not whatever the defaults have moved to since. A parameter that changes behaviour
    and is not published is a silent divergence between the file and its re-derivation."""
    from writers import _ANNOTATION_GAP_MAX
    p = tmp_path / "P_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    i = _push(w, 0, 120)
    i = _push(w, 156, 1, start=i)
    i = _push(w, 0, 120, start=i)
    i = _push(w, 44, 5, start=i)
    w.close()

    body = open(_sidecar(p)).read()
    for token in (f"t_stuck={T_STUCK}", f"merge_gap_max={_ANNOTATION_GAP_MAX}",
                  f"held_warmup={HELD_WARMUP_RUNS}", f"held_top2_share={HELD_TOP2_SHARE}"):
        assert token in body, f"missing {token}"
    assert "merges=1" in body, "the merge count is not reported"


def test_a_recording_that_ends_ON_an_annotation_row_still_reports_the_span(tmp_path):
    """The last thing in the file is the marker itself, so the merge candidate is still pending at
    teardown. The span before it must not be lost to the pipeline, and the marker run itself is a
    run: both are resolved at close."""
    p = tmp_path / "Q_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    i = _push(w, 0, T_STUCK + 20)
    _push(w, 156, 1, start=i)                # recording ends here, mid-merge-decision
    w.close()

    rows = _rows(_sidecar(p))
    assert len(rows) == 1
    assert rows[0][2] == "0" and rows[0][4] == str(T_STUCK + 20)
    assert rows[0][6] == "1", "the span ended when the marker began, so it is closed"


def test_a_channel_with_BOTH_buffered_rows_and_runs_is_released_once(tmp_path):
    """A channel can reach close both ways — buffered seam rows and its own run history. It must be
    marked and released exactly once, not twice."""
    sc = _RunSidecar(str(tmp_path / "R_PPG.txt"), "ppg1", T_STUCK)
    sc.feed("channel 0", 1, _phone(0))
    sc.feed("channel 0", 2, _phone(1))        # a real run, so the channel is in the histogram
    sc.emit_run("channel 0", 9, 0, 40, 320.0, 1, "pinned", T0)   # and in the buffer
    sc.close()

    body = open(sc.path).read()
    assert body.count("reason=too-few-runs") == 1, "the channel was released twice"
    assert len([r for r in _rows(sc.path) if r[7] == "pinned"]) == 1


def test_a_failure_closing_the_sidecar_handle_is_counted(tmp_path):
    """Even the final `close()` can fail on a dying disk. It is counted, not swallowed — `errors`
    is what tells a reader the census is incomplete."""
    sc = _RunSidecar(str(tmp_path / "S_PPG.txt"), "ppg1", T_STUCK)

    class _BoomOnHandleClose:
        def write(self, *_a, **_k):
            pass

        def close(self):
            raise OSError("dying disk")

    sc._fh = _BoomOnHandleClose()
    sc.close()
    assert sc.errors > 0


def test_the_write_paths_guard_against_a_stream_that_has_no_sidecar(tmp_path):
    """`write_ppg`/`write_ppg2w` are reachable on a writer whose stream is absent from
    RUN_MIN_BY_STREAM. The guard is what keeps that a normal write rather than an AttributeError,
    and it is asserted here rather than left to be incidentally covered by the streams that DO have
    a sidecar — an incidentally-covered guard stops being tested the day its caller changes."""
    p = tmp_path / "T_ECG.txt"
    w = StreamWriter(str(p), "ecg", fsync=False)      # a stream with no sidecar
    assert w._runs is None
    w.write_ppg(_phone(0), 0, 0.0, (1,), 0)           # must not raise
    w.write_ppg2w(_phone(1), 0, 11, 22, 3)
    w.write_acc(_phone(2), None, 0.0, 1, 2, 3)        # ACC feeds the sidecar too, so it needs the guard
    w.close()

    assert not os.path.exists(_sidecar(p))
    assert w.rows == 3


def test_a_failure_DURING_feed_is_isolated_from_the_live_write_path(tmp_path):
    """The isolation that matters at 3am: a sidecar write that raises while SAMPLES ARE ARRIVING must
    not propagate into the writer, because `feed` is called from the BLE notification path.

    Distinct from the teardown case: an earlier test asserted `errors > 0` after a failing sidecar and
    passed — but the exception was raised during `close()` and caught by a different handler, so
    `feed`'s own guard was never executed. `errors > 0` was true via a path the test did not intend,
    which is why the assertion has to be about WHERE the failure happened, not just that it counted."""
    p = tmp_path / "U_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    i = _push(w, 1, T_STUCK + 2)             # a span worth reporting, held pending a merge decision
    i = _push(w, 2, 5, start=i)              # a short non-annotation run: the span is now flushable

    class _Boom:
        def write(self, *_a, **_k):
            raise OSError("disk gone mid-stream")

        def close(self):
            pass

    w._runs._fh = _Boom()
    before = w._runs.errors
    _push(w, 3, 1, start=i)                  # closes the short run -> emits the span -> raises in feed
    assert w._runs.errors > before, "feed's own guard never ran"

    for k in range(10):                      # and the stream keeps recording afterwards
        w.write_ppg(_phone(500 + k), 0, 0.0, (9,), 0)
    w.close()

    assert w.rows == T_STUCK + 2 + 5 + 1 + 10
    assert len(open(p).read().splitlines()) == w.rows + 1     # header + every sample row


def test_the_sidecar_publishes_WHAT_IT_EXAMINED_not_only_what_it_found(tmp_path):
    """`runs=0` cannot distinguish "read 66,535 samples and found nothing" from "was never fed one".

    Those are the same bytes and opposite facts, and the second SHIPPED: `acc`/`accraw` were in
    RUN_MIN_BY_STREAM, so every ACC stream got a sidecar reading `rule=stuck … runs=0` while
    `write_acc` never called `feed`. Writing the empty file is the whole point — it means "looked" —
    and the version that could not prove it looked went out anyway. This is the mechanism that makes
    the two different bytes; the comment that used to assert the distinction was not one."""
    fed = tmp_path / "F_ACCRAW.txt"
    w = StreamWriter(str(fed), "accraw", fsync=False)
    for i in range(30):
        w.write_acc(_phone(i, hz=10.0), None, 0.0, 1, 2, 3)
    w.close()
    fed_body = open(_sidecar(fed)).read()

    never = tmp_path / "N_ACCRAW.txt"
    StreamWriter(str(never), "accraw", fsync=False).close()
    never_body = open(_sidecar(never)).read()

    assert "runs=0" in fed_body and "runs=0" in never_body      # indistinguishable before this
    assert "examined=90 channels=3" in fed_body
    assert "examined=0 channels=0" in never_body
    assert fed_body != never_body, "an unfed sidecar is still byte-identical to an examined one"


def test_each_channel_reports_what_IT_examined(tmp_path):
    """Per channel, so a stream that feeds two of three axes is visible as exactly that."""
    p = tmp_path / "P_ACCRAW.txt"
    w = StreamWriter(str(p), "accraw", fsync=False)
    for i in range(12):
        w.write_acc(_phone(i, hz=10.0), None, 0.0, 1, 2, 3)
    w.close()
    body = open(_sidecar(p)).read()
    assert body.count("examined=12 ") == 3, body

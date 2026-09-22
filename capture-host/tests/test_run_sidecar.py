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
from writers import (HELD_CONFIRM_WINDOWS, HELD_EXIT_SHARE, HELD_TOP2_SHARE, HELD_WARMUP_RUNS, RUN_MIN_BY_STREAM, T_STUCK, StreamWriter,
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
    # The ninth field is the BRACKET (D5, 2026-09-19). A back-check row arrives with no live neighbourhood,
    # so both sides are `unavailable` — not examined — never a guessed class.
    assert rows[0][1:] == ["channel 0", "199", "40", "900", "7200.0", "1", "clip", "unavailable/unavailable", "none"]


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
                  f"held_warmup={HELD_WARMUP_RUNS}", f"held_top2_share={HELD_TOP2_SHARE}",
                  f"held_exit_share={HELD_EXIT_SHARE}", f"held_confirm={HELD_CONFIRM_WINDOWS}"):
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
    # Closes the short run -> the span is emitted into `_pending` -> BRACKET_WINDOW samples later its
    # after-side is known and the row is WRITTEN, still from inside feed() -> raises there. (D5 moved the
    # write from run-close to window-complete; the isolation property is about the same code path.)
    _push(w, 3, writers.BRACKET_WINDOW + 1, start=i)
    assert w._runs.errors > before, "feed's own guard never ran"

    for k in range(10):                      # and the stream keeps recording afterwards
        w.write_ppg(_phone(500 + k), 0, 0.0, (9,), 0)
    w.close()

    assert w.rows == T_STUCK + 2 + 5 + writers.BRACKET_WINDOW + 1 + 10
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


# ── the classifier was INVERTED; these are built from the 2026-09-15 night, not from an ideal ──────
# The pre-existing hold test above feeds a PERFECTLY alternating 6/7 stream, so its share is 1.000 and
# it passes under both the broken and the fixed criterion. That is why the inversion survived: the
# fixture expressed an idealised hold, while the real one jitters. Every number below is measured.

def test_INVERSION_a_never_repeating_stream_is_NOT_held(tmp_path):
    """Verity PPG, 2026-09-15 night: `mean_run=1.00 top2=1,2 share=1.000 class=held` over 1,286,760
    samples per channel — the classifier called the MOST VARIABLE POSSIBLE signal a hold.

    A run of length 1 is one sample, so it is not a repetition, so the stream cannot be a hold however
    concentrated its run lengths are. `held` would suppress the warm-up spans the sidecar exists for."""
    sc = _RunSidecar(str(tmp_path / "V_PPG.txt"), "ppg", T_STUCK)
    for r in range(HELD_WARMUP_RUNS + 5):
        sc.feed("channel 0", r, _phone(r, hz=55.0))       # every value differs => every run length 1
    sc.close()

    body = open(sc.path).read()
    assert sc.klass["channel 0"] == "variable", "a stream that never repeats is not a hold"
    # ANTI-VACUITY: the share test alone still SAYS hold — proving the new guard is what rejects it,
    # not some incidental difference in the feed.
    assert "share=1.000" in body, "the concentration test still scores this a perfect 1.000"


def test_INVERSION_a_real_jittering_hold_IS_held(tmp_path):
    """O2Ring accraw, same night: `top2=6,7 share=0.906 class=variable` — the 6-7x hold the design
    brief documents ("repeats each sample 6-7x BY DESIGN") was found correctly and then REJECTED,
    missing the old 0.95 threshold by 0.044 because a real hold's ratio jitters."""
    sc = _RunSidecar(str(tmp_path / "A_ACCRAW.txt"), "accraw", T_STUCK)
    n = HELD_WARMUP_RUNS + 5
    for r in range(n):
        ln = (6 + (r % 2)) if (r % 16) else (5 + 3 * (r % 2))   # ~88% on {6,7}, rest on {5,8}
        for k in range(ln):
            sc.feed("X [raw]", r, _phone(r * 8 + k, hz=10.0))
    sc.close()

    body = open(sc.path).read()
    assert sc.klass["X [raw]"] == "held", "a 6-7x zero-order hold is exactly what `held` is for"
    assert "top2=6,7" in body
    # The measured share must sit in the band that the OLD threshold rejected — otherwise this test
    # would pass against the unfixed code and prove nothing.
    share = float(body.split("share=")[1].split()[0])
    assert 0.85 <= share < 0.95, f"share {share} must be in the band 0.95 rejected and 0.85 accepts"


def test_INVERSION_a_mostly_non_repeating_stream_is_NOT_held(tmp_path):
    """H10 ACC, same night: `mean_run=1.24 top2=1,2 share=0.969 class=held`. Its dominant run length
    is 1, so it fails the repetition guard even though its share clears both thresholds."""
    sc = _RunSidecar(str(tmp_path / "H_ACC.txt"), "acc", T_STUCK)
    for r in range(HELD_WARMUP_RUNS + 5):
        for k in range(1 + (1 if r % 4 == 0 else 0)):     # mostly 1, occasionally 2 => mean ~1.25
            sc.feed("X [mg]", r, _phone(r * 2 + k, hz=200.0))
    sc.close()

    assert sc.klass["X [mg]"] == "variable", "mean run 1.25 is not a zero-order hold"


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# BRACKETING — owner ruling D5, 2026-09-19: emit the measurement, name nothing (LIVE-TESTS-2026-09-19-PM-RESULT)
# ══════════════════════════════════════════════════════════════════════════════════════════════════

def _pleth(n, seed=7):
    """A varied signal: n samples cycling through >= 20 distinct values (a synthetic pleth)."""
    return [80 + ((seed * k * 7) % 40) for k in range(n)]


def _feed_seq(sc, seq, channel="channel 0", t0=None):
    t0 = t0 or _dt.datetime(2026, 9, 19, 18, 40, 49)
    for k, v in enumerate(seq):
        sc.feed(channel, v, t0 + _dt.timedelta(milliseconds=8 * k))


def test_bracket_side_is_pure_and_distinguishes_UNAVAILABLE_from_FLAT():
    """`unavailable` = no complete window to examine; `flat` = examined and quiet. Different facts,
    different values — §∅ at the class level. A window one sample short is unavailable, not flat."""
    W = writers.BRACKET_WINDOW
    assert writers.bracket_side(None) == "unavailable"
    assert writers.bracket_side([]) == "unavailable"
    assert writers.bracket_side([100] * (W - 1)) == "unavailable"
    assert writers.bracket_side([100] * W) == "flat"
    assert writers.bracket_side(_pleth(W)) == "varied"
    assert writers.bracket_side(list(range(19)) * (W // 19 + 1))[:0] == ""      # sanity: callable
    assert writers.bracket_side([k % 19 for k in range(W)]) == "flat"           # 19 distinct < 20
    assert writers.bracket_side([k % 20 for k in range(W)]) == "varied"         # 20 distinct = varied


def test_a_span_with_pulsatile_signal_on_BOTH_sides_is_varied_varied(tmp_path):
    """The evening capture's flashlight/occlusion shape: worn → flat 100 for >= T_STUCK → worn. Both
    sides examined and varied; the row says so and asserts nothing about fingers."""
    W = writers.BRACKET_WINDOW
    sc = writers._RunSidecar(str(tmp_path / "x_PPG.txt"), "ppg1", T_STUCK)
    _feed_seq(sc, _pleth(W + 50) + [100] * (T_STUCK + 10) + _pleth(W + 50, seed=11))
    sc.close()
    rows = [r for r in _rows(sc.path) if r[7] == "stuck"]
    assert [(r[2], r[4], r[8]) for r in rows] == [("100", str(T_STUCK + 10), "varied/varied")]


def test_a_span_at_FILE_START_is_unavailable_before(tmp_path):
    """The ring streams 100 from connect until a finger registers (30 of 164 corpus runs). No window
    before it existed, so `before` is unavailable — not flat, not varied."""
    W = writers.BRACKET_WINDOW
    sc = writers._RunSidecar(str(tmp_path / "x_PPG.txt"), "ppg1", T_STUCK)
    _feed_seq(sc, [100] * (T_STUCK + 5) + _pleth(W + 50))
    sc.close()
    rows = [r for r in _rows(sc.path) if r[7] == "stuck"]
    assert [(r[2], r[8]) for r in rows] == [("100", "unavailable/varied")]


def test_a_span_that_runs_to_the_END_is_unavailable_after_NOT_flat(tmp_path):
    """The load-bearing distinction. A span still open at close() has no after-side — the recording
    ended first. It must read `unavailable`, and a span whose after-side WAS examined and quiet must
    read `flat`; the two can never share a value."""
    W = writers.BRACKET_WINDOW
    sc = writers._RunSidecar(str(tmp_path / "eof_PPG.txt"), "ppg1", T_STUCK)
    _feed_seq(sc, _pleth(W + 50) + [100] * (T_STUCK + 10))
    sc.close()
    rows = [r for r in _rows(sc.path) if r[7] == "stuck"]
    assert [(r[2], r[6], r[8]) for r in rows] == [("100", "0", "varied/unavailable")]

    sc2 = writers._RunSidecar(str(tmp_path / "quiet_PPG.txt"), "ppg1", T_STUCK)
    # after the span: a DIFFERENT quiet level (99) for a full window — examined, and flat
    _feed_seq(sc2, _pleth(W + 50) + [100] * (T_STUCK + 10) + [99] * (W + 5))
    sc2.close()
    rows2 = [r for r in _rows(sc2.path) if r[7] == "stuck"]
    # The 99-run is itself a reportable span (>= T_STUCK) that ran to EOF, so its own row follows. Its
    # BEFORE window (375 samples) is the 210-sample 100-span plus 165 pleth samples → `varied`, by the
    # definition and not by intent — the window is what it is; its AFTER is EOF → `unavailable`.
    assert [(r[2], r[4], r[8]) for r in rows2] == [("100", str(T_STUCK + 10), "varied/flat"),
                                                   ("99", str(W + 5), "varied/unavailable")]


def test_the_row_is_HELD_until_its_after_window_arrives_then_written_from_feed(tmp_path):
    """Live, the after-side is unknown at run close. The row must not be written early with a guessed
    class: it appears only once BRACKET_WINDOW further samples have been fed, and then with the class
    those samples earned."""
    W = writers.BRACKET_WINDOW
    sc = writers._RunSidecar(str(tmp_path / "x_PPG.txt"), "ppg1", T_STUCK)
    _feed_seq(sc, _pleth(W + 50) + [100] * (T_STUCK + 10))
    tail = _pleth(W, seed=3)
    t0 = _dt.datetime(2026, 9, 19, 19, 0, 0)
    for k, v in enumerate(tail[:-1]):
        sc.feed("channel 0", v, t0 + _dt.timedelta(milliseconds=8 * k))
    sc._fh.flush()
    assert [r for r in _rows(sc.path) if r[7] == "stuck"] == []            # one sample short: still held
    sc.feed("channel 0", tail[-1], t0 + _dt.timedelta(seconds=3))
    sc._fh.flush()
    rows = [r for r in _rows(sc.path) if r[7] == "stuck"]
    assert [(r[2], r[8]) for r in rows] == [("100", "varied/varied")]
    sc.close()


def test_annotation_markers_are_NOT_counted_in_either_window(tmp_path):
    """The ring's 156 beat marker is an annotation, not a sample. A quiet window peppered with markers
    is still flat; the merged span across a marker still gets its before-class."""
    W = writers.BRACKET_WINDOW
    sc = writers._RunSidecar(str(tmp_path / "x_PPG.txt"), "ppg1", T_STUCK, annotations=frozenset({156}))
    # "quiet" = fewer than 20 distinct values but NOT a constant run (a constant 414 would itself be a
    # reportable span, which a first draft of this fixture accidentally created): 19 values cycling,
    # with a marker every 50 samples.
    quiet = []
    for k in range(W + 40):
        quiet.append(156 if k % 50 == 0 else 60 + (k % 19))
    # span split by ONE marker: 150 + marker + 150 = merged 301 >= T_STUCK, reportable only by merging
    _feed_seq(sc, quiet + [100] * 150 + [156] + [100] * 150 + _pleth(W + 50))
    sc.close()
    rows = [r for r in _rows(sc.path) if r[7] == "stuck"]
    assert len(rows) == 1
    assert rows[0][2] == "100" and int(rows[0][4]) >= T_STUCK
    assert rows[0][8] == "flat/varied"


def test_the_rule_line_states_the_window_and_its_threshold(tmp_path):
    """A reader must be able to reproduce the class from the samples: the window and the distinct-value
    threshold ride the rule line, beside the other parameters. And no kind vocabulary survives."""
    sc = writers._RunSidecar(str(tmp_path / "x_PPG.txt"), "ppg1", T_STUCK)
    sc.close()
    head = open(sc.path, encoding="utf-8").read().splitlines()
    assert f"bracket_window={writers.BRACKET_WINDOW}" in head[0]
    assert f"bracket_varied_min={writers.BRACKET_VARIED_MIN}" in head[0]
    assert "kinds=" not in head[0] and "unit=unknown" in head[0]
    assert head[1] == writers._RunSidecar.HEADER and head[1].endswith(";rule;bracket;contact")
    assert "contact_source=none" in head[0] and "contact_tol_s=2" in head[0] and "contact_rule=majority" in head[0]
    assert not hasattr(writers, "run_kind") and not hasattr(writers, "RUN_KIND_BY_STREAM")


def test_PLANT_bracketing_changes_NOTHING_about_which_runs_are_emitted(tmp_path):
    """The run-length gate is untouched: the same feed emits the same (value, n) rows as before D5 —
    only the ninth column carries the neighbourhood. In particular a 41-sample worn plateau at 100
    (ON1's longest) is still below min_run and never becomes a row."""
    W = writers.BRACKET_WINDOW
    sc = writers._RunSidecar(str(tmp_path / "x_PPG.txt"), "ppg1", 200)
    seq = _pleth(W) + [100] * 41 + [95, 97] + [100] * 250 + [80] + [0] * 199 + [3] + [199] * 260 + _pleth(W, seed=5)
    _feed_seq(sc, seq)
    sc.close()
    rows = [(r[2], r[4], r[8]) for r in _rows(sc.path) if r[7] == "stuck"]
    assert [(v, n) for v, n, _b in rows] == [("100", "250"), ("199", "260")]
    assert all("/" in b and b.split("/")[0] in ("varied", "flat", "unavailable") for _v, _n, b in rows)


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE DEVICE'S OWN WORD — `contact`, the second witness (owner "fix it", 2026-09-19)
# ══════════════════════════════════════════════════════════════════════════════════════════════════

T0 = _dt.datetime(2026, 9, 19, 18, 40, 49)


def _span_times(before_len, span_len, t0=T0):
    """Host times (start, end) a flat span will occupy when fed at 8 ms/sample after `before_len` samples."""
    return (t0 + _dt.timedelta(milliseconds=8 * before_len),
            t0 + _dt.timedelta(milliseconds=8 * (before_len + span_len - 1)))


def _span(sc, before_seq, span_len, after_seq, t0=T0):
    """Feed before + a flat-100 span + after at 8 ms/sample. NOTE the frames into the ledger BEFORE
    calling this: the span's row is written the moment its after-window completes, i.e. during the feed."""
    seq = before_seq + [100] * span_len + after_seq
    for k, v in enumerate(seq):
        sc.feed("channel 0", v, t0 + _dt.timedelta(milliseconds=8 * k))
    return _span_times(len(before_seq), span_len, t0)


def test_ledger_majority_none_vs_zero_are_DIFFERENT_facts():
    """`none` = no frame overlapped the span; `0` = the device declared lead-off. The two must never
    share a value — the same trap as unavailable/flat, one witness over."""
    L = writers.ContactLedger()
    a = T0; b = T0 + _dt.timedelta(seconds=3)
    assert L.majority(a, b) == "none"
    L.note(T0 + _dt.timedelta(seconds=1), 0)
    assert L.majority(a, b) == "0"
    assert L.majority(a, b) != "none"


def test_ledger_carries_2_and_3_VERBATIM_never_collapsed_to_worn():
    L = writers.ContactLedger()
    for k, v in enumerate((2, 2, 3)):
        L.note(T0 + _dt.timedelta(seconds=k), v)
    assert L.majority(T0, T0 + _dt.timedelta(seconds=2)) == "2"
    L2 = writers.ContactLedger(); L2.note(T0, 3)
    assert L2.majority(T0, T0) == "3"
    L3 = writers.ContactLedger(); L3.note(T0, None)                  # a frame with no byte declares nothing
    assert L3.majority(T0, T0) == "none"


def test_ledger_join_window_is_PLUS_MINUS_2s_and_majority_ties_go_to_the_smaller_value():
    L = writers.ContactLedger()
    L.note(T0 - _dt.timedelta(seconds=2.5), 0)     # outside: 2.5 s before the span
    L.note(T0 - _dt.timedelta(seconds=1.9), 1)     # inside
    L.note(T0 + _dt.timedelta(seconds=4.9), 0)     # inside (span ends at +3 s, +2 s tolerance)
    L.note(T0 + _dt.timedelta(seconds=5.1), 1)     # outside
    assert L.majority(T0, T0 + _dt.timedelta(seconds=3)) == "0"    # 1 vs 1 → tie → smaller value (lead-off)
    L.note(T0 + _dt.timedelta(seconds=1), 1)
    assert L.majority(T0, T0 + _dt.timedelta(seconds=3)) == "1"    # 2 vs 1


def test_a_row_carries_BOTH_witnesses_and_they_can_disagree(tmp_path):
    """The evening's occlusion shape: the waveform is flat 100 between pulsatile stretches (bracket says
    varied/varied) while the device says contact=1 the whole time. Both on the row; neither hides the
    other. And the flashlight shape: same bracket, device says 0."""
    W = writers.BRACKET_WINDOW
    L = writers.ContactLedger()
    sc = writers._RunSidecar(str(tmp_path / "occ_PPG.txt"), "ppg1", T_STUCK, contact=L)
    a, b = _span_times(W + 50, T_STUCK + 10)
    for k in range(-3, 8):
        L.note(a + _dt.timedelta(seconds=k), 1)
    _span(sc, _pleth(W + 50), T_STUCK + 10, _pleth(W + 50, seed=11))
    sc.close()
    rows = [r for r in _rows(sc.path) if r[7] == "stuck"]
    assert [(r[2], r[8], r[9]) for r in rows] == [("100", "varied/varied", "1")]

    L2 = writers.ContactLedger()
    sc2 = writers._RunSidecar(str(tmp_path / "lamp_PPG.txt"), "ppg1", T_STUCK, contact=L2)
    a, b = _span_times(W + 50, T_STUCK + 10)
    L2.note(a - _dt.timedelta(seconds=1), 1)
    for k in range(0, 4):
        L2.note(a + _dt.timedelta(seconds=k), 0)
    _span(sc2, _pleth(W + 50), T_STUCK + 10, _pleth(W + 50, seed=11))
    sc2.close()
    rows2 = [r for r in _rows(sc2.path) if r[7] == "stuck"]
    assert [(r[2], r[8], r[9]) for r in rows2] == [("100", "varied/varied", "0")]
    assert "contact_source=oxyframe" in open(sc2.path, encoding="utf-8").readline()


def test_a_span_with_NO_overlapping_frame_reads_none_even_with_a_ledger(tmp_path):
    """Frames exist for the session but none within ±2 s of this span (a frame gap): `none`, not 0."""
    W = writers.BRACKET_WINDOW
    L = writers.ContactLedger()
    sc = writers._RunSidecar(str(tmp_path / "gap_PPG.txt"), "ppg1", T_STUCK, contact=L)
    a, b = _span_times(W + 50, T_STUCK + 10)
    L.note(a - _dt.timedelta(seconds=30), 0)
    L.note(b + _dt.timedelta(seconds=30), 0)
    _span(sc, _pleth(W + 50), T_STUCK + 10, _pleth(W + 50, seed=11))
    sc.close()
    rows = [r for r in _rows(sc.path) if r[7] == "stuck"]
    assert [(r[2], r[9]) for r in rows] == [("100", "none")]


def test_streams_without_the_byte_read_none_and_say_so_on_the_rule_line(tmp_path):
    """The Verity and the ACC streams have no contact byte: no ledger by construction, every row `none`,
    `contact_source=none` on the comment line so a reader is not left to infer it. Bracketing is their
    only witness."""
    w = StreamWriter(str(tmp_path / "V_PPG.txt"), "ppg", fsync=False)
    assert w._runs is not None and w._runs._contact is None
    w._runs._fh.flush()
    assert "contact_source=none" in open(w._runs.path, encoding="utf-8").readline()
    w.close()


def test_the_ring_writer_forwards_the_ledger_to_its_sidecar(tmp_path):
    L = writers.ContactLedger()
    w = StreamWriter(str(tmp_path / "R_PPG.txt"), "ppg1", fsync=False, contact=L)
    assert w._runs is not None and w._runs._contact is L
    w._runs._fh.flush()
    assert "contact_source=oxyframe" in open(w._runs.path, encoding="utf-8").readline()
    w.close()


def test_a_row_whose_after_window_completes_BEFORE_the_warm_up_verdict_waits_in_the_buffer(tmp_path):
    """Two hold points, in the right order. A qualifying span early in a file is held for its after-
    window (D5); if that window completes while the channel's hold-class is still undecided, the row
    goes into the warm-up buffer and is released — or dropped as `held` — when the verdict lands.
    Here the verdict is `variable`, so the row is released with the bracket it earned."""
    sc = writers._RunSidecar(str(tmp_path / "x_PPG.txt"), "ppg1", 30)     # min_run 30: the span qualifies, the 25-runs do not
    seq = _pleth(20) + [100] * 30                                          # 20 runs of 1, then the span
    seq += [v for v in range(200, 215) for _ in range(25)]                 # 15 runs of 25 → after-window done at ~run 36
    seq += _pleth(40, seed=13)                                             # 40 more length-1 runs → verdict at run 64
    _feed_seq(sc, seq)
    sc._fh.flush()
    body = open(sc.path, encoding="utf-8").read()
    assert "class=variable" in body                                        # the verdict landed
    rows = [r for r in _rows(sc.path) if r[7] == "stuck"]
    assert [(r[2], r[4], r[8]) for r in rows] == [("100", "30", "unavailable/flat")]
    # released AFTER the verdict line, not before it
    assert body.index("class=variable") < body.index(";100;20;30;")
    sc.close()



# ── THE CLASS IS PER WINDOW (residue 2026-09-06-warmup-verdict-goes-stale, 2026-09-22) ──────────────
# Plants: a stream that HOLDS for one window and then VARIES, and the reverse. Under the old
# once-per-night verdict the first keeps `held` and suppresses every sub-T_STUCK row for the rest of the
# recording; the second keeps `variable` and over-reports. Both were verified red on the old code.

def _hold_runs(sc, ch, n_runs, r0=0, t0=0, hz=10.0):
    """`n_runs` runs of the 6/7 zero-order-hold cadence; returns (next run value, next sample index)."""
    t = t0
    for r in range(n_runs):
        for _ in range(6 + (r % 2)):
            sc.feed(ch, r0 + r, _phone(t, hz=hz))
            t += 1
    return r0 + n_runs, t


def _varied_runs(sc, sc_ch, n_runs, r0, t0, hz=10.0, stuck_every=0, stuck_len=0):
    """`n_runs` runs of varied lengths 1..5 (never a hold); every `stuck_every`-th run is `stuck_len`
    long instead — a sub-T_STUCK run the sidecar should REPORT on a variable channel."""
    t = t0
    for r in range(n_runs):
        n = stuck_len if (stuck_every and r % stuck_every == 0) else 1 + (r % 5)
        for _ in range(n):
            sc.feed(sc_ch, r0 + r, _phone(t, hz=hz))
            t += 1
    return r0 + n_runs, t


def test_a_hold_that_later_varies_TRANSITIONS_and_its_later_sub_T_STUCK_rows_are_REPORTED(tmp_path):
    """The residue's case. Window 0 is a hold (rows dropped — cadence, not absence); window 1 onward is
    variable, so a 20-sample run there is a reportable span. Under the once-per-night verdict it was
    suppressed to the end of the recording."""
    sc = _RunSidecar(str(tmp_path / "H_ACC.txt"), "accraw", 10)
    ch = "X [raw]"
    r, t = _hold_runs(sc, ch, HELD_WARMUP_RUNS)                       # window 0: held
    r, t = _varied_runs(sc, ch, 3 * HELD_WARMUP_RUNS, r, t, stuck_every=16, stuck_len=20)   # windows 1-3: variable
    sc.close()
    body = open(sc.path).read()
    assert sc.klass[ch] == "variable" and sc.transitions[ch] == 1
    lines = [ln for ln in body.splitlines() if ln.startswith(f"# stream=accraw channel={ch} class=")]
    assert [ln.split("class=")[1].split()[0] for ln in lines] == ["held", "variable"], lines
    assert "window=0 confirmed=1 at=" in lines[0]
    # HYSTERESIS: window 1 measured variable but the class in force stayed held (confirm 2); the
    # transition lands on window 2, confirmed=2, and is stamped with that window's instant.
    assert f"window={HELD_CONFIRM_WINDOWS} confirmed={HELD_CONFIRM_WINDOWS} at=" in lines[1]
    assert "class=variable windows=4 transitions=1 partial=0" in body
    rows = _rows(sc.path)
    assert rows and all(r_[4] == "20" for r_ in rows), rows
    assert len(rows) == 8, "the 20-sample runs of the windows judged variable (2 of the 3: the first paid the confirm lag)"


def test_a_variable_stream_that_becomes_a_hold_TRANSITIONS_and_stops_over_reporting(tmp_path):
    """The reverse: window 0 variable (its 20-sample runs reported), windows 1+ a hold — whose 6/7
    cadence must not be reported as spans. Under the once-per-night verdict the hold's rows kept
    coming (min_run=6 makes every held run a 'span')."""
    sc = _RunSidecar(str(tmp_path / "V_ACC.txt"), "accraw", 6)
    ch = "X [raw]"
    r, t = _varied_runs(sc, ch, HELD_WARMUP_RUNS, 0, 0, stuck_every=16, stuck_len=20)      # window 0: variable
    r, t = _hold_runs(sc, ch, 3 * HELD_WARMUP_RUNS, r, t)                                 # windows 1-3: held
    sc.close()
    body = open(sc.path).read()
    assert sc.klass[ch] == "held" and sc.transitions[ch] == 1
    assert "class=held windows=4 transitions=1 partial=0" in body
    rows = _rows(sc.path)
    spans = [r_ for r_ in rows if r_[4] == "20"]
    cadence = [r_ for r_ in rows if r_[4] in ("6", "7")]
    assert len(spans) == 4, "window 0's spans"
    # THE COST OF THE CONFIRM LAG, stated: window 1's cadence rows were judged by the class in force
    # (variable) and written; from window 2 the hold is in force and the cadence is silent again.
    assert len(cadence) == HELD_WARMUP_RUNS, "exactly one window of cadence over-reported, never more"


def test_a_stable_hold_writes_ONE_class_line_and_zero_transitions_across_many_windows(tmp_path):
    """The ring's real ACC: a 6/7 hold all night. Re-deciding per window must not produce a line per
    window — only a change of class is a transition."""
    sc = _RunSidecar(str(tmp_path / "S_ACC.txt"), "accraw", T_STUCK)
    ch = "X [raw]"
    _hold_runs(sc, ch, 5 * HELD_WARMUP_RUNS + 3)                      # five windows and a partial tail
    sc.close()
    body = open(sc.path).read()
    assert body.count(f"# stream=accraw channel={ch} class=") == 1
    assert "windows=5 transitions=0 partial=1" in body and sc.transitions.get(ch, 0) == 0
    assert _rows(sc.path) == []


def test_a_trailing_partial_window_keeps_the_class_in_force_and_says_so(tmp_path):
    """Fewer than HELD_WARMUP_RUNS runs after the last decision: too little to re-decide, so the class
    in force judges those rows — variable here, so the tail's 20-sample run IS written."""
    sc = _RunSidecar(str(tmp_path / "P_PPG.txt"), "ppg1", 10)
    ch = "channel 0"
    r, t = _varied_runs(sc, ch, HELD_WARMUP_RUNS, 0, 0)               # window 0: variable
    _varied_runs(sc, ch, 5, r, t, stuck_every=1, stuck_len=20)        # a partial tail with spans
    sc.close()
    body = open(sc.path).read()
    assert "class=variable windows=1 transitions=0 partial=1" in body
    assert len(_rows(sc.path)) == 5


def test_a_stuck_run_is_written_unconditionally_in_a_held_window_still(tmp_path):
    """Per-window classing changes nothing about T_STUCK: a run at or over it is written in every
    window, held or not — the row least safe to suppress."""
    sc = _RunSidecar(str(tmp_path / "T_ACC.txt"), "accraw", T_STUCK)
    ch = "X [raw]"
    r, t = _hold_runs(sc, ch, HELD_WARMUP_RUNS + 10)
    for _ in range(T_STUCK + 5):
        sc.feed(ch, 999, _phone(t, hz=10.0))
        t += 1
    _hold_runs(sc, ch, 10, r + 1, t)
    sc.close()
    rows = _rows(sc.path)
    assert len(rows) == 1 and rows[0][2] == "999" and int(rows[0][4]) >= T_STUCK
    assert sc.klass[ch] == "held"


def test_an_external_emitter_that_names_no_window_is_judged_by_the_class_in_force(tmp_path):
    """`emit_run` is the seam a back-check writes through; it names no window, so the class currently
    in force decides — held drops it, variable writes it, undecided buffers it until close."""
    sc = _RunSidecar(str(tmp_path / "E_ACC.txt"), "accraw", 10)
    ch = "X [raw]"
    sc.emit_run(ch, 1, 0, 12, 100.0, 1, "rail-run")                   # undecided: buffered
    _hold_runs(sc, ch, HELD_WARMUP_RUNS)                              # held now
    sc.emit_run(ch, 2, 0, 12, 100.0, 1, "rail-run")                   # held: dropped
    sc.close()
    assert _rows(sc.path) == [], "the undecided row waited for a verdict; the verdict was held, so it was dropped with the rest"
    sc2 = _RunSidecar(str(tmp_path / "E2_PPG.txt"), "ppg1", 10)
    _varied_runs(sc2, "channel 0", HELD_WARMUP_RUNS, 0, 0)           # variable now
    sc2.emit_run("channel 0", 3, 0, 12, 100.0, 1, "rail-run")
    sc2.close()
    assert [r_[7] for r_ in _rows(sc2.path)] == ["rail-run"]


def test_the_exit_band_a_held_window_whose_share_dips_under_the_entry_threshold_stays_held(tmp_path):
    """The measured jitter of a real hold: windows at share 0.80–0.85 (p1–p5 on the ring's ACC) must not
    flip the class. One window of the 6/7 cadence with 12 of 64 runs of other lengths scores ≈ 0.81 —
    below entry (0.85), above exit (0.70): no transition. Then two windows at share ≈ 0.5 DO leave."""
    sc = _RunSidecar(str(tmp_path / "B_ACC.txt"), "accraw", T_STUCK)
    ch = "X [raw]"
    r, t = _hold_runs(sc, ch, HELD_WARMUP_RUNS)                       # window 0: held, share 1.0
    for i in range(HELD_WARMUP_RUNS):                                 # window 1: 52 cadence runs + 12 of length 3
        n = 3 if i % 5 == 0 else 6 + (i % 2)
        for _ in range(n):
            sc.feed(ch, r, _phone(t, hz=10.0)); t += 1
        r += 1
    for i in range(2 * HELD_WARMUP_RUNS):                             # windows 2-3: half the runs are odd lengths
        n = 3 if i % 2 == 0 else 6
        for _ in range(n):
            sc.feed(ch, r, _phone(t, hz=10.0)); t += 1
        r += 1
    sc.close()
    body = open(sc.path).read()
    lines = [ln for ln in body.splitlines() if ln.startswith(f"# stream=accraw channel={ch} class=")]
    assert len(lines) == 2 and "window=3 confirmed=2" in lines[1], lines
    assert sc.transitions[ch] == 1 and "windows=4 transitions=1" in body
    w1 = [ln for ln in lines if "window=1 " in ln]
    assert w1 == [], "the dip under 0.85 but over 0.70 wrote no transition"


def _window_with_share(sc, ch, r, t, share, hz=10.0):
    """One 64-run window of the 6/7 cadence in which `share` of the runs are cadence and the rest are
    length 3 — a run-length histogram with a KNOWN top-2 share, independent of any corpus."""
    n_odd = round(HELD_WARMUP_RUNS * (1 - share))
    for i in range(HELD_WARMUP_RUNS):
        n = 3 if i < n_odd else 6 + (i % 2)
        for _ in range(n):
            sc.feed(ch, r, _phone(t, hz=hz)); t += 1
        r += 1
    return r, t


def test_a_pleth_that_dithers_at_the_band_s_edge_never_flips(tmp_path):
    """The plant the band was NOT fitted on: 200 windows alternating share 0.83 / 0.87 — just under and
    just over the 0.85 entry, inside p1–p5 of the real hold's jitter. Once held, none of the 0.83 windows
    (above the 0.70 exit) may flip it: ONE class line, ZERO transitions, the cadence silent."""
    sc = _RunSidecar(str(tmp_path / "D_ACC.txt"), "accraw", T_STUCK)
    ch = "X [raw]"
    r, t = _window_with_share(sc, ch, 0, 0, 0.90)                       # enter: held
    for i in range(200):
        r, t = _window_with_share(sc, ch, r, t, 0.83 if i % 2 == 0 else 0.87)
    sc.close()
    body = open(sc.path).read()
    assert body.count(f"# stream=accraw channel={ch} class=") == 1 and "class=held windows=201 transitions=0" in body
    assert _rows(sc.path) == []


def test_a_variable_stream_dithering_just_under_entry_never_enters_held(tmp_path):
    """The mirror: share 0.80 / 0.84 for 100 windows never reaches 0.85, so the class stays variable and
    every window's rows are written — hysteresis must not manufacture a hold either."""
    sc = _RunSidecar(str(tmp_path / "U_ACC.txt"), "accraw", T_STUCK)
    ch = "X [raw]"
    r, t = 0, 0
    for i in range(100):
        r, t = _window_with_share(sc, ch, r, t, 0.80 if i % 2 == 0 else 0.84)
    sc.close()
    body = open(sc.path).read()
    assert sc.klass[ch] == "variable" and "class=variable windows=100 transitions=0" in body
    assert body.count(f"# stream=accraw channel={ch} class=") == 1


def test_a_transition_at_a_KNOWN_instant_is_stamped_at_that_instant_plus_the_confirm_lag_never_earlier(tmp_path):
    """The hold ends at sample index 64×6.5 (the first varied run); the transition may only be declared
    once HELD_CONFIRM_WINDOWS variable windows have closed after it — its `at=` stamp is the host time
    of the run that closed that window, later than the change and within the stated lag."""
    sc = _RunSidecar(str(tmp_path / "K_ACC.txt"), "accraw", 10)
    ch = "X [raw]"
    r, t_change = _hold_runs(sc, ch, HELD_WARMUP_RUNS)
    r, t_end = _varied_runs(sc, ch, 3 * HELD_WARMUP_RUNS, r, t_change)
    sc.close()
    body = open(sc.path).read()
    line = [ln for ln in body.splitlines() if f"channel={ch} class=variable" in ln][0]
    at = line.rsplit(" at=", 1)[1].strip()
    change_ts = _phone(t_change, hz=10.0).isoformat(timespec="milliseconds")
    # the varied windows average 3 samples/run: window k closes at ≈ t_change + k·64·3 samples
    lag_hi = _phone(t_change + (HELD_CONFIRM_WINDOWS + 1) * HELD_WARMUP_RUNS * 3, hz=10.0).isoformat(timespec="milliseconds")
    assert change_ts < at <= lag_hi, (change_ts, at, lag_hi)
    assert f"confirmed={HELD_CONFIRM_WINDOWS}" in line

# tepna-capture — tests/test_cpap_ingest.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# P3 of CPAP-ACQUISITION-HARDENING-AUDIT — the bounded ingest queue + gap-accounting counters + frame
# classifier. Pure logic, 100% branch.
import pytest
from cpap_ingest import BoundedIngestQueue, FrameKind, GapCounters, classify_frame


def _sd(stream_id, data):
    return {"method": "StreamData", "params": {"streamId": stream_id, "data": data}}


# ── frame classification (audit G4 — the foreign-streamId frame is COUNTED, not silently dropped) ──

def test_a_matching_streamdata_with_data_is_ok():
    assert classify_frame(_sd(7, [{"PatientFlow": [1, 2, 3]}]), 7) is FrameKind.OK


def test_a_foreign_streamid_is_foreign_not_ok():
    assert classify_frame(_sd(9, [{"PatientFlow": [1]}]), 7) is FrameKind.FOREIGN


def test_a_non_streamdata_is_malformed():
    assert classify_frame({"method": "HeartBeat", "params": {}}, 7) is FrameKind.MALFORMED


def test_a_streamdata_with_empty_data_is_malformed():
    assert classify_frame(_sd(7, []), 7) is FrameKind.MALFORMED


def test_a_streamdata_with_non_list_data_is_malformed():
    assert classify_frame(_sd(7, {"not": "a list"}), 7) is FrameKind.MALFORMED


def test_a_non_dict_message_is_malformed_not_an_exception():
    assert classify_frame(None, 7) is FrameKind.MALFORMED
    assert classify_frame("garbage", 7) is FrameKind.MALFORMED


def test_a_streamdata_with_non_dict_params_is_malformed():
    assert classify_frame({"method": "StreamData", "params": None}, 7) is FrameKind.MALFORMED


def test_a_streamdata_missing_params_is_malformed():
    assert classify_frame({"method": "StreamData"}, 7) is FrameKind.MALFORMED


# ── the gap counters ──────────────────────────────────────────────────────────────────────────────

def test_note_frame_folds_each_kind_into_the_right_counter():
    c = GapCounters()
    c.note_frame(FrameKind.OK, n_samples=40)
    c.note_frame(FrameKind.OK, n_samples=40)
    c.note_frame(FrameKind.FOREIGN)
    c.note_frame(FrameKind.MALFORMED)
    assert c.frames_ok == 2 and c.samples_ok == 80
    assert c.foreign_stream == 1 and c.malformed == 1


def test_total_lost_counts_overflow_malformed_and_tail_but_not_foreign():
    """Foreign frames were never ours, so they are NOT loss. Overflow, malformed, and the post-drop tail
    ARE the honest 'how much did we miss' — audit §16."""
    c = GapCounters(overflow=3, malformed=2, post_drop_tail=1, foreign_stream=10, sink_errors=5)
    assert c.total_lost == 6                # 3 + 2 + 1; foreign AND sink_errors excluded (different axes)


def test_summary_is_a_flat_stable_dict():
    c = GapCounters(frames_ok=5, samples_ok=200, foreign_stream=1, malformed=2,
                    overflow=1, stalls=1, post_drop_tail=1, sink_errors=3)
    s = c.summary()
    assert s == {
        "frames_ok": 5, "samples_ok": 200, "foreign_stream": 1, "malformed": 2,
        "overflow": 1, "stalls": 1, "post_drop_tail": 1, "sink_errors": 3, "total_lost": 4,
    }
    # key order is stable so two nights diff cleanly
    assert list(s.keys()) == ["frames_ok", "samples_ok", "foreign_stream", "malformed",
                              "overflow", "stalls", "post_drop_tail", "sink_errors", "total_lost"]


# ── the bounded queue (spec §17 — backpressure, overflow recorded not silent) ──────────────────────

def test_offer_accepts_until_capacity_then_drops_and_counts_overflow():
    q = BoundedIngestQueue(capacity=2)
    assert q.offer("a") is True
    assert q.offer("b") is True
    assert q.offer("c") is False           # full → dropped
    assert q.counters.overflow == 1        # the loss is RECORDED, not silent
    assert q.depth == 2


def test_max_depth_is_a_high_water_mark():
    q = BoundedIngestQueue(capacity=3)
    q.offer("a"); q.offer("b")
    assert q.max_depth == 2
    q.drain()
    q.offer("c")                            # depth 1 now, but max_depth stays 2
    assert q.max_depth == 2


def test_drain_returns_fifo_and_empties():
    q = BoundedIngestQueue(capacity=4)
    q.offer(1); q.offer(2); q.offer(3)
    assert q.drain() == [1, 2, 3]
    assert q.depth == 0
    assert q.drain() == []                  # draining an empty queue is fine


def test_draining_makes_room_again():
    q = BoundedIngestQueue(capacity=2)
    q.offer("a"); q.offer("b")
    assert q.offer("c") is False
    q.drain()
    assert q.offer("c") is True             # room after drain
    assert q.counters.overflow == 1         # the earlier drop is still recorded


def test_capacity_below_one_is_refused():
    with pytest.raises(ValueError, match="capacity must be >= 1"):
        BoundedIngestQueue(capacity=0)


def test_queue_and_counters_share_the_overflow_record():
    """The queue's overflow lands in the SAME GapCounters the frame classifier writes, so a night's
    single ingest record carries both the classification and the backpressure loss."""
    c = GapCounters()
    q = BoundedIngestQueue(capacity=1, counters=c)
    q.offer("x")
    q.offer("y")                            # dropped
    c.note_frame(FrameKind.OK, n_samples=40)
    assert c.overflow == 1 and c.frames_ok == 1 and c.total_lost == 1

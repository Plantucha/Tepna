# tepna-capture — tests/test_cpap_detect.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Branch coverage for the shadow adapter: parsing, extraction, and the injected-seam poll cycle.
# No BLE, no real clock — the device read and the monotonic clock are fakes.

import asyncio

import cpap_detect as D
from cpap_supervisor import CPAPSessionSupervisor, SessionState, TherapyState


def _run(coro):
    return asyncio.run(coro)


# --- parse_use_marker -------------------------------------------------------------------


def test_marker_parses_iso():
    a = D.parse_use_marker("2026-08-24T21:48:55.000Z")
    b = D.parse_use_marker("2026-08-24T23:34:36Z")
    assert a is not None and b is not None
    assert b > a  # monotonic ordering preserved


def test_marker_accepts_space_separator():
    assert D.parse_use_marker("2026-08-24 23:34:36") is not None


def test_marker_none_for_non_string():
    assert D.parse_use_marker(None) is None
    assert D.parse_use_marker(12345) is None


def test_marker_none_for_unmatched():
    assert D.parse_use_marker("not-a-date") is None


def test_marker_rejects_out_of_range_month_day():
    assert D.parse_use_marker("2026-13-01T00:00:00Z") is None
    assert D.parse_use_marker("2026-08-40T00:00:00Z") is None


def test_marker_rejects_out_of_range_time():
    assert D.parse_use_marker("2026-08-24T25:00:00Z") is None
    assert D.parse_use_marker("2026-08-24T12:99:00Z") is None
    assert D.parse_use_marker("2026-08-24T12:00:99Z") is None


# --- extract_fields ---------------------------------------------------------------------


def test_extract_full():
    fg, use, mask = D.extract_fields(
        {
            "FGState": "Therapy",
            "MaskPressure": 7.4,
            "MachineMetrics": {"LastTherapyUseDateTime": "2026-08-24T21:48:55Z"},
        }
    )
    assert fg == TherapyState.THERAPY
    assert use is not None
    assert mask == 7.4


def test_extract_tolerates_missing_and_wrong_types():
    fg, use, mask = D.extract_fields({"FGState": "Bogus", "MaskPressure": "x", "MachineMetrics": 5})
    assert fg is None  # unknown state
    assert use is None  # MachineMetrics not a dict
    assert mask is None  # non-numeric pressure


def test_extract_empty_result():
    assert D.extract_fields({}) == (None, None, None)


def test_extract_bool_pressure_is_none():
    _, _, mask = D.extract_fields({"MaskPressure": True})
    assert mask is None


def test_extract_int_pressure_coerced():
    _, _, mask = D.extract_fields({"MaskPressure": 6})
    assert mask == 6.0


def test_extract_standby():
    fg, _, _ = D.extract_fields({"FGState": "Standby"})
    assert fg == TherapyState.STANDBY


# --- build_observation ------------------------------------------------------------------


def test_build_unreachable_when_none():
    obs = D.build_observation(None, 1000)
    assert obs.reachable is False
    assert obs.host_ms == 1000


def test_build_reachable_from_dict():
    obs = D.build_observation({"FGState": "Therapy"}, 2000)
    assert obs.reachable is True
    assert obs.fg_state == TherapyState.THERAPY


# --- ShadowDetector.poll_once -----------------------------------------------------------


class _Writer:
    def __init__(self):
        self.rows = []

    def write(self, decision):
        self.rows.append(decision.as_row())


def _detector(reads, *, writer=None, t0=0.0):
    sup = CPAPSessionSupervisor()
    clock = {"t": t0}

    async def read():
        return reads.pop(0)

    def mono():
        clock["t"] += 1.0
        return clock["t"]

    return D.ShadowDetector(sup, read=read, mono=mono, writer=writer, poll_interval_s=5.0), sup


def test_poll_once_starts_session_and_journals():
    writer = _Writer()
    det, sup = _detector([{"FGState": "Therapy", "MachineMetrics": {"LastTherapyUseDateTime": "2026-08-24T21:00:00Z"}}], writer=writer)
    d = _run(det.poll_once())
    assert sup.state == SessionState.ACTIVE
    assert d.transition == "start"
    assert len(writer.rows) == 1  # every decision written in shadow mode


def test_poll_once_without_writer():
    det, sup = _detector([{"FGState": "Standby"}])
    d = _run(det.poll_once())
    assert d.transition is None
    assert sup.state == SessionState.IDLE


def test_poll_once_unreachable_read():
    det, sup = _detector([None])
    d = _run(det.poll_once())
    assert d.trigger == "unreachable_hold"


# --- ShadowDetector.run -----------------------------------------------------------------


def test_run_polls_until_should_stop():
    reads = [{"FGState": "Standby"}, {"FGState": "Standby"}]
    det, _ = _detector(reads)
    slept = []

    async def sleep(secs):
        slept.append(secs)

    calls = {"n": 0}

    def should_stop():
        calls["n"] += 1
        return calls["n"] > 2  # allow two poll cycles

    _run(det.run(should_stop=should_stop, sleep=sleep))
    assert slept == [5.0, 5.0]  # two cycles, injected interval


def test_run_stops_immediately_when_should_stop_true():
    det, _ = _detector([])

    async def sleep(secs):
        raise AssertionError("should not sleep")  # run() exits before the first sleep

    _run(det.run(should_stop=lambda: True, sleep=sleep))

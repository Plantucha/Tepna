# tepna-capture — tests/test_run_polar_bounded_awaits.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Every post-connect await in `run_polar` is BOUNDED — proven by hanging the operation.

THE INCIDENT THIS PROTECTS AGAINST is written into capture.py at the `_read_batt` call site: on
2026-07-25 a `read_gatt_char` sat between the last successful PMD START and the hold loop that owns the
stall watchdog, and it was unbounded. On a link BlueZ never fails it simply never returned — the Verity
logged four streams `-> ok` at 23:51:23 and then nothing at all until 04:16:01. Link up the whole time
(680 of 682 poll samples connected), zero bytes, and no stall warning, because the watchdog is
DOWNSTREAM of the thing that was stuck. QC logged `missing stream(s)` twice and nothing consumed it.
4 h 25 m of a night, lost silently, with a green card.

WHY THIS FILE EXISTS SEPARATELY FROM THE EXISTING COVERAGE. `test_capture_runners.py` already pins the
HELPER — `_bounded_setup` times out a hanging await and passes a prompt one through. That proves the
bound works when it is used. It does not prove `run_polar` USES it, and that is where the defect lives:
a mutation pass left 9 survivors on the call sites (`_bounded_setup(None)`,
`start_notify(PMD_CONTROL, )`, `timeout = None`, `wait_for(ctrl_q.get(), None)`), every one of which
re-creates the 2026-07-25 freeze. They survived the whole suite. They are invisible to an ordinary
mutation run too, because an unbounded await HANGS the runner rather than failing it — they only
surfaced once the kill-checker grew a per-mutant timeout.

⚠️ EVERY TEST HERE BOUNDS ITSELF. `pytest-timeout` is not installed, so a regression must FAIL rather
than hang the suite — a hanging test is the same class of unhelpful as the bug it is chasing. Each
drives `run_polar` inside an `asyncio.wait_for`, and the assertion is "it returned at all".
"""
import asyncio
import sys

import pytest

import capture
import polar_pmd as pmd

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import test_capture_runners as T

_clean_stop = T._clean_stop

# Comfortably longer than every bound the tests patch in (0.05 s), and far shorter than the real ones
# (10 s setup, 3 s control), so an UNBOUNDED await is a failure in ~2 s rather than a wedged suite.
TEST_BOUND_S = 2.0


def _drive_bounded(streams=("ecg",)):
    """Run run_polar under a hard deadline. Returns True if it terminated, False if it hung."""
    async def go():
        try:
            await asyncio.wait_for(capture.run_polar(T._pdev(streams=list(streams)), _TMP[0]),
                                   TEST_BOUND_S)
            return True
        except asyncio.TimeoutError:
            return False
    return asyncio.run(go())


_TMP = [None]


@pytest.fixture(autouse=True)
def _tmp(tmp_path):
    _TMP[0] = str(tmp_path)


class HangingNotifyClient(T.FlexPolarClient):
    """Subscribes to the control characteristic and never returns — BlueZ's silent-wedge shape."""
    async def start_notify(self, uuid, cb):
        if getattr(uuid, "uuid", uuid) == pmd.PMD_CONTROL:
            await asyncio.Event().wait()          # never set: the await that ate 4 h 25 m
        return await super().start_notify(uuid, cb)


class HangingWriteClient(T.FlexPolarClient):
    """Accepts the control write and never completes it. The write is a D-Bus round-trip to the same
    stack that wedges, and it sits in the negotiation path every reconnect runs."""
    async def write_gatt_char(self, uuid, cmd, response=False):
        if uuid == pmd.PMD_CONTROL:
            await asyncio.Event().wait()
        return await super().write_gatt_char(uuid, cmd, response=response)


class SilentControlClient(T.FlexPolarClient):
    """Answers the write, then never delivers the indication — so `ctrl_q.get()` has nothing to give."""
    async def write_gatt_char(self, uuid, cmd, response=False):
        self.writes.append(bytes(cmd))
        return None


def _tighten(monkeypatch):
    monkeypatch.setattr(capture, "_BLE_SETUP_TIMEOUT_S", 0.05)
    monkeypatch.setattr(capture, "_PMD_CTRL_TIMEOUT_S", 0.05)


def test_a_hanging_control_SUBSCRIBE_does_not_freeze_the_session(tmp_path, monkeypatch):
    """`await _bounded_setup(client.start_notify(pmd.PMD_CONTROL, _on_ctrl))`. Unwrap it and the task
    parks here forever with its link nominally up — connected=True, zero rows, no warning."""
    _tighten(monkeypatch)
    T._polar_common(monkeypatch)
    T._inject_connect(monkeypatch, HangingNotifyClient(data_frames=[T._ecg_frame()]))
    T._stop_after(monkeypatch, 1)
    assert _drive_bounded(), (
        "run_polar never returned — a hanging start_notify must be bounded so the except/finally can "
        "close the writers and the loop retry on a fresh link (the 2026-07-25 freeze)")


def test_a_hanging_control_WRITE_does_not_freeze_the_negotiation(tmp_path, monkeypatch):
    """`_ctrl` bounds its write too. Unbounded, one wedged write parks the whole device task."""
    _tighten(monkeypatch)
    T._polar_common(monkeypatch)
    T._inject_connect(monkeypatch, HangingWriteClient(data_frames=[T._ecg_frame()]))
    T._stop_after(monkeypatch, 1)
    assert _drive_bounded(), "run_polar never returned — the control WRITE must be bounded"


def test_an_indication_that_NEVER_ARRIVES_does_not_freeze_the_negotiation(tmp_path, monkeypatch):
    """`got = await asyncio.wait_for(ctrl_q.get(), timeout)`. A dropped indication leaves the queue
    empty forever; without the bound the negotiation waits for an answer that is not coming."""
    _tighten(monkeypatch)
    T._polar_common(monkeypatch)
    T._inject_connect(monkeypatch, SilentControlClient(data_frames=[T._ecg_frame()]))
    T._stop_after(monkeypatch, 1)
    assert _drive_bounded(), "run_polar never returned — the indication wait must be bounded"


def test_the_control_timeout_defaults_to_the_CONSTANT_not_to_None(tmp_path, monkeypatch):
    """`timeout = _PMD_CTRL_TIMEOUT_S if timeout is None else timeout`. Two mutations of that line
    survived the suite: `timeout = None` (unbounded) and an inverted `is not None` (which resolves to
    None for every default call). Both make `asyncio.wait_for(..., None)` — a wait with no deadline,
    which is the freeze wearing the shape of a timeout."""
    _tighten(monkeypatch)
    T._polar_common(monkeypatch)
    T._inject_connect(monkeypatch, SilentControlClient(data_frames=[T._ecg_frame(), T._acc_frame()]))
    T._stop_after(monkeypatch, 1)
    assert _drive_bounded(streams=("ecg", "acc")), (
        "run_polar never returned — every _ctrl call uses the DEFAULT timeout, so a None default is "
        "an unbounded wait on every control round-trip of every reconnect")


def test_a_hanging_BATTERY_read_does_not_freeze_the_session(tmp_path, monkeypatch):
    """The exact 2026-07-25 site. It is cosmetic — battery level — and the enclosing try/except makes a
    timeout a SKIP, which is right: a cosmetic read must never cost a session."""
    _tighten(monkeypatch)

    class HangingBatteryClient(T.FlexPolarClient):
        async def read_gatt_char(self, uuid):
            if uuid == capture.BATTERY_UUID:
                await asyncio.Event().wait()
            return await super().read_gatt_char(uuid)

    T._polar_common(monkeypatch)
    T._inject_connect(monkeypatch, HangingBatteryClient(data_frames=[T._ecg_frame()]))
    T._stop_after(monkeypatch, 1)
    assert _drive_bounded(), (
        "run_polar never returned — a hanging battery read cost 4 h 25 m on 2026-07-25 and must be "
        "bounded; it is cosmetic and its timeout is deliberately swallowed")


# ── the other half of the contract: bounded is not the same as WORKING ──────────────────────────────
# The six mutants above that survived the timeout tests all break the control SUBSCRIBE or point the
# write at the wrong characteristic — and every one is swallowed by the `except` around it, which is
# correct (a failed subscribe must not take the task down) but leaves the session degraded. capture.py
# says so at that site: "without the control channel every _ctrl below times out, so every START goes
# unacknowledged and no PMD stream can be confirmed. The session is degraded from this line onward."
#
# So the assertion that catches them is about the HEALTHY path: on a device that answers, the control
# channel must really be subscribed and the START must really be acknowledged. "It returned" does not
# distinguish a working negotiation from one that silently degraded to NO_ACK on every stream.
def test_a_HEALTHY_device_actually_negotiates_rather_than_degrading_silently(tmp_path, monkeypatch):
    sets: list = []
    real_set = capture._set
    monkeypatch.setattr(capture, "_set", lambda n, **kv: (sets.append((n, dict(kv))), real_set(n, **kv))[1])
    T._polar_common(monkeypatch)
    T._inject_connect(monkeypatch, T.FlexPolarClient(data_frames=[T._ecg_frame()]))
    T._stop_after(monkeypatch, 1)
    assert _drive_bounded(), "the healthy session must terminate"

    errs = [str(kv.get("last_error")) for _n, kv in sets if kv.get("last_error")]
    assert not any("unacknowledged" in e for e in errs), (
        f"a device that answers every command must not report an unacked START — that is the signature "
        f"of a control channel that was never subscribed; saw {errs}")
    # The negotiated rate only lands when a START is ACKNOWLEDGED, so this is the positive half.
    fs = capture.STATUS["devices"]["H10"].get("pmd_options", {}).get("ecg")
    assert fs == [130], (
        f"the device's own rate menu must have been read back over the control channel; got {fs!r}")


def test_the_control_channel_being_unavailable_is_a_WARNING_and_names_the_consequence(tmp_path, monkeypatch, caplog):
    """When the subscribe genuinely fails, it must be loud. WARNING, not info: every START from that
    line on goes unconfirmed, so it must not read as a routine note in a night's journal."""
    _tighten(monkeypatch)
    T._polar_common(monkeypatch)

    class NoControlClient(T.FlexPolarClient):
        async def start_notify(self, uuid, cb):
            if getattr(uuid, "uuid", uuid) == pmd.PMD_CONTROL:
                raise RuntimeError("control subscribe refused")
            return await super().start_notify(uuid, cb)

    T._inject_connect(monkeypatch, NoControlClient(data_frames=[T._ecg_frame()]))
    T._stop_after(monkeypatch, 1)
    with caplog.at_level("WARNING"):
        assert _drive_bounded(), "a refused control subscribe must not freeze the session either"
    warn = [r for r in caplog.records if r.levelname == "WARNING"
            and "control indications unavailable" in r.getMessage()]
    assert warn, (
        "a control channel that could not be subscribed must warn — the session is degraded from that "
        f"line onward; warnings seen: {[r.getMessage()[:60] for r in caplog.records]}")

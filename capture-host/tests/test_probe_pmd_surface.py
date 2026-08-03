# tepna-capture — tests/test_probe_pmd_surface.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The command-surface sweep. It talks to a device that cannot be brought into CI, so what is pinned here
# is everything that does NOT need one — and specifically the properties that were learned the expensive
# way, one BLE window each:
#
#   * the ALLOWLIST refuses trigger writes and unknown opcodes. This is the safety property: op 0x08/0x09
#     persist across power cycles, so a probe that sent one would arm a recording that starts by itself
#     on every boot and removes the live stream the nightly capture depends on.
#   * a REFUSED command is recorded and the sweep continues. The device answers some writes with a
#     GATT-layer error; letting that propagate cost a window at reply 8 of 20.
#   * the plan is RESUMABLE across links, and one-shot queries come FIRST. A run that ordered the
#     plentiful queries first completed 23/28 commands and missed all four unique ones.
#   * the clock experiment RESTORES the device clock even when the run fails. Left on local civil time,
#     every device stamp the following night is off by the UTC offset — and looks plausible.
#   * `clock_verdict` distinguishes "the clock it reports" from "the clock it stamps". That distinction
#     IS the finding (brief §3); collapsing them is how a tool reports success having verified nothing.

import asyncio
import datetime as _dt

import pytest

import polar_pmd as pmd
import probe_pmd_surface as probe


def _run(coro):
    return asyncio.run(coro)


# ── the allowlist: the safety property ───────────────────────────────────────────────────────────────

def test_trigger_writes_are_refused_by_name_and_reason():
    """0x08/0x09 persist across power cycles — the refusal must say so, not just 'denied'."""
    for op in (0x08, 0x09):
        with pytest.raises(ValueError) as e:
            probe.sweep_cmd(op)
        assert "persists across power cycles" in str(e.value)
        assert "TRIGGER" in str(e.value)


def test_an_unknown_opcode_is_assumed_to_write():
    with pytest.raises(ValueError, match="assumed to write"):
        probe.sweep_cmd(0x0B)


def test_a_known_write_op_is_refused_too():
    """START (0x02) is a real op with a real name — and still not this probe's business."""
    with pytest.raises(ValueError, match="allowlist"):
        probe.sweep_cmd(0x02, pmd.ACC)


def test_an_empty_command_is_rejected_rather_than_indexed():
    with pytest.raises(ValueError, match="empty"):
        probe._check_allowed(b"")


def test_the_offline_bit_is_what_selects_the_offline_menu():
    assert probe.sweep_cmd(0x01, pmd.ACC) == b"\x01\x02"
    assert probe.sweep_cmd(0x01, pmd.ACC, offline=True) == b"\x01\x82"
    assert probe.sweep_cmd(0x05) == b"\x05"


# ── the plan ─────────────────────────────────────────────────────────────────────────────────────────

def test_the_scarce_one_shot_queries_are_planned_first():
    """Ordering the per-measurement queries first cost all four unique answers in one window."""
    plan = probe.plan_sweep([pmd.PPG, pmd.ACC])
    assert [cmd.hex() for _, _, _, cmd in plan[:4]] == ["05", "06", "07", "0a"]


def test_every_measurement_is_asked_both_ways():
    plan = probe.plan_sweep([pmd.ACC])
    modes = [(n, m) for n, lbl, m, _ in plan if lbl == "acc"]
    assert ("GET_MEASUREMENT_SETTINGS", "online") in modes
    assert ("GET_MEASUREMENT_SETTINGS", "offline") in modes


def test_an_undocumented_type_is_labelled_by_number_not_crashed_on():
    plan = probe.plan_sweep([0x0E])
    assert any(lbl == "0x0e" for _, lbl, _, _ in plan)


def test_fold_replies_nests_per_measurement_and_decodes_status():
    rows = [
        ("GET_MEASUREMENT_SETTINGS", "acc", "offline",
         bytes.fromhex("f00102000000030d001a0034000101100002010800040103")),
        ("GET_MEASUREMENT_STATUS", "", "", bytes.fromhex("f005ff000002050601030e")),
        ("GET_SDK_MODE_STATUS", "", "", None),
    ]
    out = probe.fold_replies(rows)
    assert out["GET_MEASUREMENT_SETTINGS"]["acc"]["offline"]["settings"]["rate_hz"] == [13, 26, 52]
    assert out["GET_MEASUREMENT_STATUS"]["active"]["acc"] == "none"
    assert out["GET_SDK_MODE_STATUS"] == {"raw": None}


def test_a_status_reply_that_never_arrived_is_not_decoded_as_all_inactive():
    """`None` must stay None. Folding a missing reply into 'everything is off' would be a fabricated
    observation about the device."""
    out = probe.fold_replies([("GET_MEASUREMENT_STATUS", "", "", None)])
    assert "active" not in out["GET_MEASUREMENT_STATUS"]


def test_decode_settings_names_ids_and_keeps_unknown_ones():
    assert probe.decode_settings(None) == {}
    got = probe.decode_settings(bytes.fromhex("f0010100000001370001011600040104"))
    assert got == {"rate_hz": [55], "resolution_bits": [22], "channels": [4]}


def test_an_unnamed_setting_axis_is_kept_under_its_number(monkeypatch):
    monkeypatch.setattr(probe.pmd, "parse_settings_response", lambda _v: {0x77: [1]})
    assert probe.decode_settings(b"\xf0") == {"setting_0x77": [1]}


# ── the clock: the distinction that is the whole finding ─────────────────────────────────────────────

def test_device_time_converts_from_the_polar_epoch():
    assert probe.device_time(0) == _dt.datetime(2000, 1, 1)


_LOCAL = _dt.datetime(2026, 8, 2, 20, 10, 0)
_UTC = _dt.datetime(2026, 8, 3, 0, 10, 0)


def test_a_device_that_stamps_utc_is_named_as_stamping_utc():
    assert "STAMPS UTC" in probe.clock_verdict(_UTC, _UTC, _LOCAL, _UTC)


def test_a_device_that_stamps_local_is_named_as_stamping_local():
    assert "STAMPS LOCAL" in probe.clock_verdict(_LOCAL, _LOCAL, _LOCAL, _UTC)


def test_the_clock_it_reports_disagreeing_with_the_clock_it_stamps_is_called_out():
    """The measured behaviour: SET_LOCAL_TIME lands, GET_LOCAL_TIME echoes it, samples stay UTC."""
    v = probe.clock_verdict(_LOCAL, _UTC, _LOCAL, _UTC)
    assert "DISAGREES" in v and "proves nothing" in v


def test_no_sample_stamp_is_inconclusive_rather_than_a_verdict():
    assert "cannot say" in probe.clock_verdict(_UTC, None, _LOCAL, _UTC)


def test_a_host_already_on_utc_is_reported_as_indistinguishable_not_as_proof():
    v = probe.clock_verdict(None, _UTC, _UTC, _UTC)
    assert "indistinguishable" in v


def test_a_device_agreeing_with_neither_host_clock_is_named_unsynced():
    stray = _dt.datetime(2019, 1, 1)
    assert "unsynced" in probe.clock_verdict(None, stray, _LOCAL, _UTC)


def test_a_refused_write_concludes_the_clock_is_not_settable():
    out = {"set_local_time_ack": "REFUSED: RuntimeError: PS-FTP error 201"}
    assert "not settable" in probe._clock_conclusion(out)


def test_no_stamp_after_the_write_is_inconclusive_not_a_negative():
    out = {"set_local_time_ack": "accepted", "before": {"device_stamps": "x"},
           "after": {"device_stamps": None}}
    assert "inconclusive" in probe._clock_conclusion(out)


def test_the_measured_case_concludes_the_sample_clock_did_not_follow():
    out = {"set_local_time_ack": "accepted",
           "before": {"device_stamps": "2026-08-03T00:09:56"},
           "after": {"device_stamps": "2026-08-03T00:10:19", "device_reports": "2026-08-02T20:10:05",
                     "verdict": "device STAMPS UTC — and GET_LOCAL_TIME DISAGREES with the stamps"}}
    assert "does not follow" in probe._clock_conclusion(out)


def test_a_sample_clock_that_did_move_is_reported_as_settable():
    out = {"set_local_time_ack": "accepted",
           "before": {"device_stamps": "2026-08-03T00:09:56"},
           "after": {"device_stamps": "2026-08-02T20:10:19", "device_reports": None,
                     "verdict": "device STAMPS LOCAL CIVIL time"}}
    assert "settable" in probe._clock_conclusion(out)


def test_an_unmoved_clock_falls_through_to_the_observed_verdict():
    out = {"set_local_time_ack": "accepted",
           "before": {"device_stamps": "2026-08-03T00:10:19"},
           "after": {"device_stamps": "2026-08-03T00:10:19", "device_reports": None,
                     "verdict": "device STAMPS UTC"}}
    got = probe._clock_conclusion(out)
    assert "unchanged" in got and "STAMPS UTC" in got


# ── the control point ────────────────────────────────────────────────────────────────────────────────

class _FakeClient:
    """A control point that answers from a queue. `refuse_after` reproduces the device going deaf."""

    def __init__(self, replies=(), refuse_after=None, reads=None):
        self.replies, self.writes, self._cb = list(replies), [], None
        self.refuse_after, self.reads = refuse_after, reads or {}
        self.is_connected, self.disconnected = True, False

    async def start_notify(self, _char, cb):
        self._cb = cb

    async def stop_notify(self, _char):
        pass

    async def connect(self):
        pass

    async def disconnect(self):
        self.disconnected = True

    async def read_gatt_char(self, uuid):
        val = self.reads.get(uuid)
        if isinstance(val, Exception):
            raise val
        if val is None:
            raise RuntimeError("no such characteristic")
        return bytearray(val)

    async def write_gatt_char(self, _char, data, response=False):
        if self.refuse_after is not None and len(self.writes) >= self.refuse_after:
            raise RuntimeError("GATT Protocol Error: Unlikely Error")
        self.writes.append(bytes(data))
        reply = self.replies.pop(0) if self.replies else None
        if reply is not None and self._cb:
            self._cb(0, bytearray(reply))


@pytest.fixture(autouse=True)
def _no_pacing_delay(monkeypatch):
    """The 0.25 s inter-command gap is real behaviour, not something to sit through 40 times."""
    real = asyncio.sleep

    async def quick(d):
        await real(0)
    monkeypatch.setattr(probe.asyncio, "sleep", quick)


def test_a_reply_is_paired_with_its_command():
    c = _FakeClient([b"\xf0\x05\x00"])
    cp = probe.Control(c)
    _run(cp.start())
    assert _run(cp.send(b"\x05")) == b"\xf0\x05\x00"
    assert cp.transcript == [{"sent": "05", "reply": "f00500"}]


def test_a_refused_write_is_recorded_and_does_not_raise():
    """The property that turned a dead window into a usable transcript."""
    c = _FakeClient(refuse_after=0)
    cp = probe.Control(c)
    _run(cp.start())
    assert _run(cp.send(b"\x05")) is None
    assert cp.errors == ["05"]
    assert "Unlikely Error" in cp.transcript[0]["refused"]


def test_a_timeout_yields_none_rather_than_hanging():
    cp = probe.Control(_FakeClient())
    _run(cp.start())
    assert _run(cp.send(b"\x05", timeout=0.01)) is None
    assert cp.transcript[0]["reply"] is None


def test_a_stale_reply_is_not_returned_as_the_next_commands_answer():
    c = _FakeClient([b"\xf0\x05\x00"])
    cp = probe.Control(c)
    _run(cp.start())
    cp.q.put_nowait(b"\xff\xff")                     # leftover from a timed-out command
    assert _run(cp.send(b"\x05")) == b"\xf0\x05\x00"


# ── link handling ────────────────────────────────────────────────────────────────────────────────────

def _patch_scan(monkeypatch, results):
    """results: a list consumed one per scan; an item of None means 'not seen this time'."""
    seq = list(results)

    async def find(_addr, timeout=0):
        return seq.pop(0) if seq else None
    monkeypatch.setattr(probe.BleakScanner, "find_device_by_address", find)


def test_a_scan_retries_before_declaring_the_device_absent(monkeypatch):
    _patch_scan(monkeypatch, [None, None, "dev"])
    assert _run(probe._find("AA:BB")) == "dev"


def test_a_device_that_never_advertises_is_reported_absent(monkeypatch):
    _patch_scan(monkeypatch, [None, None, None])
    assert _run(probe._find("AA:BB")) is None


def test_a_link_that_connects_but_is_already_down_is_retried(monkeypatch):
    """Measured: `async with BleakClient(...)` entered and the next call raised 'Not connected'."""
    dead, live = _FakeClient(), _FakeClient()
    dead.is_connected = False
    made = iter([dead, live])
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: next(made))

    async def use():
        async with probe._client("dev", None) as c:
            return c
    assert _run(use()) is live
    assert dead.disconnected


def test_a_connect_that_raises_is_retried_then_reported(monkeypatch):
    class _Boom(_FakeClient):
        async def connect(self):
            raise RuntimeError("le-connection-abort-by-local")
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: _Boom())

    async def use():
        async with probe._client("dev", None):
            pass                                     # pragma: no cover — the connect never succeeds
    with pytest.raises(RuntimeError, match="could not hold a link"):
        _run(use())


def test_an_adapter_is_passed_the_supported_way_not_the_deprecated_one(monkeypatch):
    """`adapter=` is deprecated AND ignored; passing it silently used the wrong radio."""
    seen = {}

    def make(dev, **kw):
        seen.update(kw)
        return _FakeClient()
    monkeypatch.setattr(probe, "BleakClient", make)

    async def use():
        async with probe._client("dev", "hci2"):
            pass
    _run(use())
    assert seen == {"bluez": {"adapter": "hci2"}}


def test_a_teardown_failure_does_not_mask_the_result(monkeypatch):
    class _BadExit(_FakeClient):
        async def disconnect(self):
            raise RuntimeError("already gone")
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: _BadExit())

    async def use():
        async with probe._client("dev", None) as c:
            return c
    assert _run(use()) is not None


# ── identity / features ──────────────────────────────────────────────────────────────────────────────

def test_identity_reports_a_missing_characteristic_rather_than_failing_the_run():
    c = _FakeClient(reads={probe.DIS["model"]: b"INW4J\x00"})
    got = _run(probe.read_identity(c))
    assert got["model"] == "INW4J"
    assert "unavailable" in got["manufacturer"]
    assert "unavailable" in got["battery_pct"]


def test_a_non_text_characteristic_is_reported_as_hex():
    c = _FakeClient(reads={probe.DIS["serial"]: b"\xff\xfe"})
    assert _run(probe.read_identity(c))["serial"] == "fffe"


def test_the_battery_level_is_read_as_a_number():
    c = _FakeClient(reads={probe.BATTERY: bytes([96])})
    assert _run(probe.read_identity(c))["battery_pct"] == 96


def test_the_feature_bitmask_names_known_types_and_numbers_unknown_ones():
    c = _FakeClient(reads={pmd.PMD_CONTROL: bytes.fromhex("0f6e620000")})
    got = _run(probe.read_features(c))
    assert got["supported_ids"] == [1, 2, 3, 5, 6, 9, 13, 14]
    assert "ppg" in got["supported"] and "type_0x0e" in got["supported"]


def test_an_unreadable_feature_bitmask_is_an_error_field_not_an_exception():
    assert "unavailable" in _run(probe.read_features(_FakeClient()))["error"]


# ── execute_plan: resumability ───────────────────────────────────────────────────────────────────────

def test_a_sweep_resumes_on_a_fresh_link_at_the_command_that_failed(monkeypatch):
    """The property the whole design exists for: a dead link costs one command, not the whole run."""
    first, second = _FakeClient([b"\xf0\x05\x00"], refuse_after=1), _FakeClient([b"\xf0\x06\x00"] * 9)
    made = iter([first, second])
    _patch_scan(monkeypatch, ["dev", "dev", "dev"])
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: next(made))
    out: dict = {}
    plan = probe.plan_sweep([])                      # the four one-shot queries only
    rows = _run(probe.execute_plan("AA:BB", None, plan, out))
    assert len(rows) == len(plan), "the sweep did not finish on the second link"
    assert out["links_used"] == 2
    assert out["commands_completed"] == "4/4"
    assert out["gatt_refused"], "the refusal must still be recorded, not silently retried away"


def test_a_device_that_stops_advertising_mid_sweep_says_how_far_it_got(monkeypatch):
    _patch_scan(monkeypatch, [None, None, None])
    out: dict = {}
    _run(probe.execute_plan("AA:BB", None, probe.plan_sweep([]), out))
    assert "0/4" in out["sweep_note"]


def test_identity_is_read_on_its_own_link_after_the_sweep(monkeypatch):
    sweep_c = _FakeClient([b"\xf0\x05\x00"] * 9)
    id_c = _FakeClient(reads={probe.DIS["model"]: b"INW4J"})
    made = iter([sweep_c, id_c])
    _patch_scan(monkeypatch, ["dev", "dev"])
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: next(made))
    out: dict = {}
    _run(probe.execute_plan("AA:BB", None, probe.plan_sweep([]), out))
    assert out["identity"]["model"] == "INW4J"
    assert sweep_c is not id_c


def test_a_failed_identity_link_does_not_discard_the_sweep(monkeypatch):
    made = iter([_FakeClient([b"\xf0\x05\x00"] * 9)])

    def make(dev, **kw):
        try:
            return next(made)
        except StopIteration:
            raise RuntimeError("link gone") from None
    _patch_scan(monkeypatch, ["dev", "dev"])
    monkeypatch.setattr(probe, "BleakClient", make)
    out: dict = {}
    _run(probe.execute_plan("AA:BB", None, probe.plan_sweep([]), out))
    assert out["commands_completed"] == "4/4"
    assert "error" in out["identity"]


def test_identity_is_skipped_when_the_device_has_gone(monkeypatch):
    _patch_scan(monkeypatch, ["dev"] + [None] * 6)
    monkeypatch.setattr(probe, "BleakClient",
                        lambda dev, **kw: _FakeClient([b"\xf0\x05\x00"] * 9))
    out: dict = {}
    _run(probe.execute_plan("AA:BB", None, probe.plan_sweep([]), out))
    assert "identity" not in out


# ── the sample stamp ─────────────────────────────────────────────────────────────────────────────────

def _acc_frame(sensor_ns: int) -> bytes:
    import struct
    return bytes([pmd.ACC]) + struct.pack("<Q", sensor_ns) + b"\x01" + struct.pack("<hhh", 0, 0, 1000)


def test_a_sample_stamp_comes_from_the_device_clock_not_the_host(monkeypatch):
    ns = 835_228_200_000_000_000
    c = _FakeClient([bytes.fromhex("f001020000000134000101100002010800040103")])
    _patch_scan(monkeypatch, ["dev"])
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: c)

    async def notify(char, cb):
        if char == pmd.PMD_DATA:
            asyncio.get_running_loop().call_soon(cb, 0, bytearray(_acc_frame(ns)))
    monkeypatch.setattr(c, "start_notify", notify)
    assert _run(probe.sample_stamp("AA:BB", None)) == probe.device_time(ns)


def test_a_missing_device_yields_no_stamp(monkeypatch):
    _patch_scan(monkeypatch, [None, None, None])
    assert _run(probe.sample_stamp("AA:BB", None)) is None


def test_no_start_command_yields_no_stamp(monkeypatch):
    c = _FakeClient([b"\xf0\x01\x02\x00\x00"])
    _patch_scan(monkeypatch, ["dev"])
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: c)
    monkeypatch.setattr(probe.pmd, "build_start", lambda *a, **k: None)
    monkeypatch.setattr(probe.pmd, "START", {})
    assert _run(probe.sample_stamp("AA:BB", None)) is None


def test_a_stream_that_never_delivers_yields_no_stamp_and_still_stops(monkeypatch):
    c = _FakeClient([bytes.fromhex("f0010200000001340001011000020108000401 03".replace(" ", ""))])
    _patch_scan(monkeypatch, ["dev"])
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: c)
    assert _run(probe.sample_stamp("AA:BB", None, timeout=0.01)) is None
    assert any(w == pmd.stop_cmd(pmd.ACC) for w in c.writes), "the stream was left running"


def test_an_empty_frame_yields_no_stamp(monkeypatch):
    c = _FakeClient([bytes.fromhex("f001020000000134000101100002010800040103")])
    _patch_scan(monkeypatch, ["dev"])
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: c)

    async def notify(char, cb):
        if char == pmd.PMD_DATA:
            asyncio.get_running_loop().call_soon(cb, 0, bytearray(_acc_frame(0)))
    monkeypatch.setattr(c, "start_notify", notify)
    monkeypatch.setattr(probe.pmd, "decode_frame", lambda *a, **k: (pmd.ACC, []))
    assert _run(probe.sample_stamp("AA:BB", None)) is None


# ── the clock experiment: the restore is the point ───────────────────────────────────────────────────

class _FakeFs:
    """A PS-FTP session standing in for PolarPsFtp — it owns its own link, so it is patched wholesale."""
    calls: list = []

    def __init__(self, reported=None, set_raises=None, restore_raises=None):
        self.reported, self.set_raises, self.restore_raises = reported, set_raises, restore_raises

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get_local_time(self):
        return self.reported

    async def set_local_time(self, when=None, tz_offset_min=None):
        _FakeFs.calls.append((when, tz_offset_min))
        if when is None and self.restore_raises:
            raise self.restore_raises
        if when is not None and self.set_raises:
            raise self.set_raises


def _patch_clock(monkeypatch, fs, stamps):
    _FakeFs.calls = []
    monkeypatch.setattr(probe.psftp, "PolarPsFtp", lambda addr, adapter=None: fs)
    seq = list(stamps)

    async def stamp(*a, **k):
        return seq.pop(0) if seq else None
    monkeypatch.setattr(probe, "sample_stamp", stamp)


def test_the_measured_result_the_write_lands_and_the_sample_clock_ignores_it(monkeypatch):
    fs = _FakeFs(reported=_LOCAL)
    _patch_clock(monkeypatch, fs, [_UTC, _UTC])
    out = _run(probe.clock_experiment("AA:BB", None))
    assert out["set_local_time_ack"] == "accepted"
    assert "does not follow" in out["conclusion"]
    assert out["restored"].startswith("device returned")
    assert _FakeFs.calls[-1] == (None, None), "the restore must use the daemon's UTC default"


def test_the_true_offset_is_written_not_zero(monkeypatch):
    """capture.py writes tz_offset=0 with a UTC value on purpose; the EXPERIMENT must not copy that,
    or it tests nothing."""
    _patch_clock(monkeypatch, _FakeFs(reported=_LOCAL), [_UTC, _UTC])
    out = _run(probe.clock_experiment("AA:BB", None))
    expect = _dt.datetime.now().astimezone().utcoffset()
    assert out["wrote"]["tz_offset_min"] == int(expect.total_seconds() // 60)


def test_a_refused_write_is_reported_as_refused_not_as_a_negative_result(monkeypatch):
    _patch_clock(monkeypatch, _FakeFs(reported=None, set_raises=RuntimeError("PS-FTP error 201")),
                 [_UTC, _UTC])
    out = _run(probe.clock_experiment("AA:BB", None))
    assert out["set_local_time_ack"].startswith("REFUSED")
    assert "not settable" in out["conclusion"]


def test_the_device_is_restored_even_when_the_run_fails_after_the_write(monkeypatch):
    """The property that matters most here. A probe that wanders off and leaves the armband on local
    civil time shifts every device stamp the following night by the UTC offset — plausibly."""
    fs = _FakeFs(reported=_LOCAL)
    _FakeFs.calls = []
    monkeypatch.setattr(probe.psftp, "PolarPsFtp", lambda addr, adapter=None: fs)
    calls = {"n": 0}

    async def stamp(*a, **k):
        calls["n"] += 1
        if calls["n"] > 1:
            raise RuntimeError("link dropped after the write")
        return _UTC
    monkeypatch.setattr(probe, "sample_stamp", stamp)
    with pytest.raises(RuntimeError):
        _run(probe.clock_experiment("AA:BB", None))
    assert (None, None) in _FakeFs.calls, "no restore after the failure"


def test_a_failed_restore_says_so_loudly(monkeypatch):
    _patch_clock(monkeypatch, _FakeFs(reported=_LOCAL, restore_raises=RuntimeError("gone")),
                 [_UTC, _UTC])
    out = _run(probe.clock_experiment("AA:BB", None))
    assert "RESTORE FAILED" in out["restored"]
    assert "re-run the daemon's clock sync" in out["restored"]


def test_the_psftp_wrappers_use_their_own_session(monkeypatch):
    fs = _FakeFs(reported=_LOCAL)
    _FakeFs.calls = []
    monkeypatch.setattr(probe.psftp, "PolarPsFtp", lambda addr, adapter=None: fs)
    assert _run(probe._get_local_time("AA:BB", None)) == _LOCAL
    _run(probe._set_local_time("AA:BB", None, _LOCAL, -240))
    assert _FakeFs.calls == [(_LOCAL, -240)]


# ── run() and the CLI ────────────────────────────────────────────────────────────────────────────────

def test_a_missing_device_is_reported_rather_than_crashing(monkeypatch):
    _patch_scan(monkeypatch, [None] * 9)
    out = _run(probe.run("AA:BB", None, False))
    assert "not found" in out["error"]


def test_the_trigger_ops_are_named_in_every_report_as_not_sent(monkeypatch):
    _patch_scan(monkeypatch, [None] * 9)
    out = _run(probe.run("AA:BB", None, False))
    assert set(out["not_sent"]) == {"0x08", "0x09"}


def test_a_sweep_failure_does_not_cancel_the_clock_experiment(monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("device wandered off")

    async def clock(*a, **k):
        return {"conclusion": "measured anyway"}
    monkeypatch.setattr(probe, "_sweep_phase", boom)
    monkeypatch.setattr(probe, "clock_experiment", clock)
    out = _run(probe.run("AA:BB", None, True))
    assert "wandered off" in out["sweep_error"]
    assert out["clock_experiment"]["conclusion"] == "measured anyway"


def test_a_clock_failure_is_recorded_rather_than_raised(monkeypatch):
    async def ok(*a, **k):
        return None

    async def boom(*a, **k):
        raise RuntimeError("no link")
    monkeypatch.setattr(probe, "_sweep_phase", ok)
    monkeypatch.setattr(probe, "clock_experiment", boom)
    out = _run(probe.run("AA:BB", None, True))
    assert "no link" in out["clock_experiment"]["error"]


def test_clock_only_does_not_spend_the_window_on_the_sweep(monkeypatch):
    """Three windows in a row were lost to the sweep's timeout before the clock leg was reached."""
    called = {"sweep": False}

    async def sweep(*a, **k):
        called["sweep"] = True                       # pragma: no cover — must not run

    async def clock(*a, **k):
        return {"conclusion": "x"}
    monkeypatch.setattr(probe, "_sweep_phase", sweep)
    monkeypatch.setattr(probe, "clock_experiment", clock)
    _run(probe.run("AA:BB", None, True, do_sweep=False))
    assert called["sweep"] is False


def test_the_feature_read_is_retried_because_the_plan_is_built_from_it(monkeypatch):
    """One lost feature read silently demoted a sweep to the fallback type list — the one list that
    cannot contain a type we do not already know about."""
    bad, good = _FakeClient(), _FakeClient(reads={pmd.PMD_CONTROL: bytes.fromhex("0f6e620000")})
    made = iter([bad, good])
    _patch_scan(monkeypatch, ["dev"] * 6)
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: next(made))

    async def noop(*a, **k):
        return []
    monkeypatch.setattr(probe, "execute_plan", noop)
    out: dict = {}
    _run(probe._sweep_phase("AA:BB", None, out, False))
    assert set(out["flag_bits"]) == {"0x09", "0x0d", "0x0e"}


def test_a_lost_feature_read_falls_back_and_says_that_it_did(monkeypatch):
    _patch_scan(monkeypatch, ["dev"] * 6)
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: _FakeClient())

    async def noop(*a, **k):
        return []
    monkeypatch.setattr(probe, "execute_plan", noop)
    out: dict = {}
    _run(probe._sweep_phase("AA:BB", None, out, False))
    assert "feature bitmask unavailable" in out["features"]["note"]
    assert out["measurement_types_swept"] == [pmd.MEAS_NAME[m] for m in sorted(pmd.MEAS_NAME)]


def test_flag_bits_are_named_by_what_they_are_not_left_as_a_mystery(monkeypatch):
    """0x09/0x0D/0x0E are MODES, not measurements — webmon.py:606 knew this before the sweep did, and a
    test already pinned it. The probe reporting them as unknown turned settled knowledge back into an
    open question, which is worse than not having asked."""
    _patch_scan(monkeypatch, ["dev"] * 6)
    monkeypatch.setattr(probe, "BleakClient",
                        lambda dev, **kw: _FakeClient(reads={pmd.PMD_CONTROL: bytes.fromhex("0f6e620000")}))

    async def noop(*a, **k):
        return []
    monkeypatch.setattr(probe, "execute_plan", noop)
    out: dict = {}
    _run(probe._sweep_phase("AA:BB", None, out, False))
    assert out["flag_bits"] == {"0x09": "SDK_MODE", "0x0d": "OFFLINE_RECORDING", "0x0e": "OFFLINE_HR"}


def test_a_flag_bit_we_cannot_name_is_still_reported(monkeypatch):
    """A future firmware may set a bit this table does not know. Dropping it would hide exactly the
    thing worth noticing."""
    _patch_scan(monkeypatch, ["dev"] * 6)
    monkeypatch.setattr(probe, "BleakClient",
                        lambda dev, **kw: _FakeClient(reads={pmd.PMD_CONTROL: bytes.fromhex("0f0080")}))

    async def noop(*a, **k):
        return []
    monkeypatch.setattr(probe, "execute_plan", noop)
    out: dict = {}
    _run(probe._sweep_phase("AA:BB", None, out, False))
    assert out["flag_bits"] == {"0x0f": "unrecognised"}


def test_the_flag_names_must_not_leak_into_MEAS_NAME():
    """webmon decides what is capturable with `not startswith('0x')`, so naming these in pmd.MEAS_NAME
    would offer three MODES to the user as capturable streams. The separate table IS the safeguard."""
    for bit in probe.FLAG_NAME:
        assert bit not in pmd.MEAS_NAME, f"{bit:#04x} became a measurement name — webmon will offer it"


def test_undocumented_types_are_only_swept_when_asked_for(monkeypatch):
    _patch_scan(monkeypatch, ["dev"] * 6)
    monkeypatch.setattr(probe, "BleakClient",
                        lambda dev, **kw: _FakeClient(reads={pmd.PMD_CONTROL: bytes.fromhex("0f6e620000")}))

    async def noop(*a, **k):
        return []
    monkeypatch.setattr(probe, "execute_plan", noop)
    off: dict = {}
    _run(probe._sweep_phase("AA:BB", None, off, False))
    assert "0x0e" not in off["measurement_types_swept"]
    on: dict = {}
    _run(probe._sweep_phase("AA:BB", None, on, True))
    assert "0x0e" in on["measurement_types_swept"]


def test_a_device_that_never_appears_stops_the_sweep_phase(monkeypatch):
    _patch_scan(monkeypatch, [None] * 9)
    out: dict = {}
    _run(probe._sweep_phase("AA:BB", None, out, False))
    assert "not found" in out["error"]


def test_main_writes_the_json_and_reports_success(monkeypatch, capsys, tmp_path):
    async def fake(*a, **k):
        return {"control_point": {}}
    monkeypatch.setattr(probe, "run", fake)
    path = tmp_path / "out.json"
    assert probe.main(["--address", "AA:BB", "--json", str(path)]) == 0
    assert "control_point" in path.read_text()
    assert "control_point" in capsys.readouterr().out


def test_a_partial_sweep_exits_nonzero(monkeypatch, capsys):
    """`sweep_error` used to leave the status at 0 — a run that collected nothing reported success to
    the shell, which is the one signal an operator actually reads."""
    async def fake(*a, **k):
        return {"sweep_error": "link died"}
    monkeypatch.setattr(probe, "run", fake)
    assert probe.main(["--address", "AA:BB"]) == 1
    capsys.readouterr()


def test_a_crash_still_hands_over_what_it_collected(monkeypatch, capsys):
    """Getting the link at all costs a daemon stop; dying at reply 30 of 40 must not throw away 29."""
    probe.PARTIAL.clear()
    probe.PARTIAL["transcript"] = [{"sent": "05", "reply": "f00500"}]

    async def boom(*a, **k):
        raise RuntimeError("link died")
    monkeypatch.setattr(probe, "run", boom)
    assert probe.main(["--address", "AA:BB"]) == 1
    assert "f00500" in capsys.readouterr().out


# ── the last three arms: exhaustion, a doubly-failed teardown, a second frame ────────────────────────

def test_a_link_that_is_down_and_will_not_close_is_still_retried(monkeypatch):
    """Both halves fail: the client reports itself disconnected AND refuses to disconnect. Neither may
    abort the retry — the teardown of a link we already know is dead cannot be the thing that stops us
    taking a new one."""
    class _Zombie(_FakeClient):
        def __init__(self):
            super().__init__()
            self.is_connected = False

        async def disconnect(self):
            raise RuntimeError("already gone")
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: _Zombie())

    async def use():
        async with probe._client("dev", None, attempts=2):
            pass                                     # pragma: no cover — never connects
    with pytest.raises(RuntimeError, match="already down"):
        _run(use())


def test_a_sweep_that_never_progresses_gives_up_after_its_link_budget(monkeypatch):
    """Every write refused on every link. The run must END — bounded by max_links — and still report
    exactly how far it got, rather than looping on a device that will not answer."""
    _patch_scan(monkeypatch, ["dev"] * 12)
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: _FakeClient(refuse_after=0))
    out: dict = {}
    rows = _run(probe.execute_plan("AA:BB", None, probe.plan_sweep([]), out, max_links=3))
    assert rows == []
    assert out["commands_completed"] == "0/4"
    assert out["links_used"] == 3


def test_only_the_first_frame_is_kept_as_the_sample_stamp(monkeypatch):
    """A stream delivers frames continuously; the experiment wants ONE. Taking the latest instead would
    make the stamp depend on how long teardown happened to take."""
    first, second = 835_228_200_000_000_000, 835_228_299_000_000_000
    c = _FakeClient([bytes.fromhex("f001020000000134000101100002010800040103")])
    _patch_scan(monkeypatch, ["dev"])
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: c)

    async def notify(char, cb):
        if char == pmd.PMD_DATA:
            loop = asyncio.get_running_loop()
            loop.call_soon(cb, 0, bytearray(_acc_frame(first)))
            loop.call_soon(cb, 0, bytearray(_acc_frame(second)))
    monkeypatch.setattr(c, "start_notify", notify)
    assert _run(probe.sample_stamp("AA:BB", None)) == probe.device_time(first)

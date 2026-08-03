# tepna-capture — tests/test_probe_verity_survey.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The whole-device survey. It writes to the device, so what is pinned first is the SAFETY, and then the
# specific mistakes this module already made once against real hardware:
#
#   * 0x08/0x09 are never sent — an armed trigger persists across power cycles and makes the device
#     record by itself on every boot. `_check` guards every write, including the ones built elsewhere.
#   * NOTHING IS LEFT RUNNING. The `finally` stop is not trusted on its own; `stop_everything` re-reads
#     status on its own links and reports honestly when it could not verify.
#   * VERIFY BY CONSEQUENCE, NOT BY THE ACK. `start returned ok` is not `it is recording` — only status
#     (0x05) says that, and a recording asked to stop has been measured running on for another 26 s.
#   * A CODE BUG IS NOT A FLAKY LINK. `_with_link` must abort on AttributeError/TypeError/… rather than
#     burn three BLE windows re-running the same broken frame.
#   * The `.REC` decoders re-earn the two corrections that cost the most: TLVs start at 0x26 (reading
#     from 0x22 yields interleaved ids-as-values that look like real settings), and a frame search must
#     be constrained to the recording's own window (an unconstrained scan found 6 frames of 49 and
#     reported a span ending in 2034).

import asyncio
import datetime as _dt
import json
import os
import struct

import polar_pmd as pmd
import probe_verity_survey as psv

PPG, ACC = pmd.PPG, pmd.ACC
POLAR_EPOCH = _dt.datetime(2000, 1, 1)


def _run(c):
    return asyncio.run(c)


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _fast_settle(monkeypatch):
    """The real 6 s inter-attempt settle is a hardware fact, not a test fact."""
    monkeypatch.setattr(psv, "SETTLE_SEC", 0.001)


# ── a Verity that keeps state ───────────────────────────────────────────────────────────────────────

SETTINGS_TLV = (bytes([0x00, 0x01]) + struct.pack("<H", 55) +
                bytes([0x01, 0x01]) + struct.pack("<H", 22) +
                bytes([0x04, 0x01, 4]))

DIS_VALUES = {"manufacturer": b"Polar Electro Oy", "model": b"INW4J", "serial": b"C1B2A3",
              "hardware_rev": b"1.0.0", "firmware_rev": b"2.2.1", "software_rev": b"2.2.1"}


class _Verity:
    """A fake control point with REAL state: START sets it, STOP clears it, 0x05 reports what is set.

    That matters because every claim the survey makes is supposed to be a re-read of the device — a fake
    that just acks would let `recording_confirmed_by_device` pass while proving nothing."""

    def __init__(self, features=b"\x0f\x02", start_status=0x00, silent=(), dis=None,
                 write_fails=(), stop_works=True):
        self.features, self.start_status = features, start_status
        self.silent, self.write_fails, self.stop_works = set(silent), set(write_fails), stop_works
        self.dis = DIS_VALUES if dis is None else dis
        self.active, self.writes, self._cb = {}, [], None
        self.is_connected, self.services = True, ["gatt"]

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def start_notify(self, _uuid, cb):
        self._cb = cb

    async def read_gatt_char(self, uuid):
        if uuid == pmd.PMD_CONTROL:
            return bytearray(self.features)
        if uuid == psv.BATTERY:
            return bytearray([87])
        for name, u in psv.DIS.items():
            if u == uuid:
                if name not in self.dis:
                    raise RuntimeError(f"no such characteristic {name}")
                return bytearray(self.dis[name])
        raise RuntimeError("unknown characteristic")

    async def write_gatt_char(self, _uuid, data, response=False):
        data = bytes(data)
        self.writes.append(data)
        if data[0] in self.write_fails:
            raise RuntimeError("GATT Protocol Error: Unlikely Error")
        r = self._answer(data)
        if r is not None and self._cb:
            self._cb(0, bytearray(r))

    def _status_reply(self):
        return bytes([0xF0, 0x05, 0xFF]) + bytes((st << 6) | m for m, st in sorted(self.active.items()))

    def _answer(self, data):
        op = data[0]
        if op in self.silent:
            return None
        if op == 0x05:
            return self._status_reply()
        if op in (0x01, 0x04):
            return bytes([0xF0, op, data[1], 0x00, 0x00]) + SETTINGS_TLV
        if op == 0x02:
            if self.start_status == 0x00:
                self.active[data[1] & 0x7F] = pmd.OFFLINE_ACTIVE if data[1] & 0x80 else pmd.ONLINE_ACTIVE
            return bytes([0xF0, 0x02, data[1], self.start_status, 0x00])
        if op == 0x03:
            if self.stop_works:
                self.active.pop(data[1] & 0x7F, None)
            return bytes([0xF0, 0x03, data[1], 0x00])
        return bytes([0xF0, op, 0xFF, 0x00])


def _patch_link(monkeypatch, client, found=True):
    async def find(_a, timeout=0):
        return object() if found else None
    monkeypatch.setattr(psv.BleakScanner, "find_device_by_address", find)
    monkeypatch.setattr(psv, "BleakClient", lambda dev, **kw: client)


# ══ the guard ════════════════════════════════════════════════════════════════════════════════════════

def test_the_persistent_trigger_writes_are_refused_at_the_choke_point():
    for op, name in psv.FORBIDDEN.items():
        with pytest.raises(ValueError) as e:
            psv._check(bytes([op, 0x01]))
        assert name in str(e.value) and "persists across power cycles" in str(e.value)


def test_an_empty_command_is_refused():
    with pytest.raises(ValueError):
        psv._check(b"")


def test_a_permitted_command_passes_through_unchanged():
    assert psv._check(b"\x05") == b"\x05"


def test_the_report_says_what_it_refused_to_send(monkeypatch):
    monkeypatch.setattr(psv, "daemon_holds_link", lambda: True)
    out = _run(psv.survey("AA:BB", None, PPG, 1.0, None, True))
    assert set(out["not_sent"]) == {"0x08", "0x09"}


# ══ Control ══════════════════════════════════════════════════════════════════════════════════════════

def test_a_refused_write_is_recorded_as_a_measurement_and_then_raised():
    c = _Verity(write_fails={0x05})
    cp = psv.Control(c)
    _run(cp.start())
    with pytest.raises(RuntimeError):
        _run(cp.send(b"\x05"))
    assert "refused" in cp.log[-1] and cp.log[-1]["sent"] == "05"


def test_a_silent_command_times_out_to_none_rather_than_hanging():
    c = _Verity(silent={0x07})
    cp = psv.Control(c)
    _run(cp.start())
    assert _run(cp.send(b"\x07", timeout=0.05)) is None
    assert cp.log[-1]["reply"] is None


def test_a_stale_reply_is_drained_so_answers_are_not_attributed_to_the_wrong_command():
    """Replies are paired by ARRIVAL ORDER — a leftover from a timed-out command would otherwise be
    returned as the next opcode's answer."""
    c = _Verity()
    cp = psv.Control(c)
    _run(cp.start())
    cp.q.put_nowait(b"\xde\xad")
    assert _run(cp.send(b"\x05"))[0] == 0xF0


# ══ the link ═════════════════════════════════════════════════════════════════════════════════════════

def test_find_gives_up_after_its_attempts(monkeypatch):
    n = {"i": 0}

    async def find(_a, timeout=0):
        n["i"] += 1
        return None
    monkeypatch.setattr(psv.BleakScanner, "find_device_by_address", find)
    assert _run(psv._find("AA:BB", attempts=3)) is None
    assert n["i"] == 3


def test_find_returns_the_first_hit(monkeypatch):
    sentinel = object()

    async def find(_a, timeout=0):
        return sentinel
    monkeypatch.setattr(psv.BleakScanner, "find_device_by_address", find)
    assert _run(psv._find("AA:BB")) is sentinel


def test_a_device_that_never_advertises_is_named_as_such(monkeypatch):
    _patch_link(monkeypatch, _Verity(), found=False)

    async def body(_c, _cp):
        raise AssertionError("must not be reached")
    with pytest.raises(RuntimeError) as e:
        _run(psv._with_link("AA:BB", None, body))
    assert "device not advertising" in str(e.value)


def test_a_code_bug_aborts_instead_of_burning_three_ble_windows(monkeypatch):
    """AttributeError/TypeError/… mean the survey is broken, not the radio. Retrying spends the scarce
    resource re-running the same wrong frame."""
    calls = {"n": 0}
    _patch_link(monkeypatch, _Verity())

    async def body(_c, _cp):
        calls["n"] += 1
        raise AttributeError("'NoneType' object has no attribute 'hex'")
    with pytest.raises(AttributeError):
        _run(psv._with_link("AA:BB", None, body))
    assert calls["n"] == 1


def test_a_link_failure_retries_and_keeps_the_traceback(monkeypatch):
    """Collapsing the failure to `type: message` cost four rounds of guessing — the message names
    BlueZ's state, the frame names the call."""
    calls = {"n": 0}
    _patch_link(monkeypatch, _Verity())

    async def body(_c, _cp):
        calls["n"] += 1
        raise RuntimeError("Service Discovery has not been performed yet")
    with pytest.raises(RuntimeError) as e:
        _run(psv._with_link("AA:BB", None, body, attempts=2))
    assert calls["n"] == 2
    assert "test_probe_verity_survey.py" in str(e.value), "the traceback frame must survive"


def test_a_working_link_returns_the_body_result(monkeypatch, capsys):
    _patch_link(monkeypatch, _Verity())

    async def body(_c, cp):
        return (await cp.send(b"\x05")).hex()
    assert _run(psv._with_link("AA:BB", None, body)).startswith("f005")
    capsys.readouterr()


# ══ the daemon precondition ══════════════════════════════════════════════════════════════════════════

def test_an_active_daemon_holds_the_link(monkeypatch):
    class _R:
        stdout = "active\n"
    import subprocess
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: _R())
    assert psv.daemon_holds_link() is True


def test_no_systemd_is_not_a_held_link(monkeypatch):
    import subprocess

    def boom(*a, **k):
        raise FileNotFoundError("systemctl")
    monkeypatch.setattr(subprocess, "run", boom)
    assert psv.daemon_holds_link() is False


def test_the_survey_stops_at_the_precondition_and_names_the_fix(monkeypatch):
    """Four survey runs were lost to this: every phase fails with an error that describes BlueZ's state
    and not its cause, so the report must say the cause instead of collecting six copies of the symptom."""
    monkeypatch.setattr(psv, "daemon_holds_link", lambda: True)
    out = _run(psv.survey("AA:BB", None, PPG, 1.0, None, True))
    assert "tepna-restart.sh stop" in out["precondition"]
    assert "identity" not in out, "nothing may be attempted once the link is known to be held"


# ══ the adapter cycle ════════════════════════════════════════════════════════════════════════════════

class _AsyncioShim:
    def __init__(self, **over):
        self._over = over

    def __getattr__(self, name):
        return self._over[name] if name in self._over else getattr(asyncio, name)


def test_the_adapter_cycle_is_best_effort_and_says_so(monkeypatch):
    seen = []

    async def spawn(*cmd, **kw):
        seen.append(cmd)

        class _P:
            async def wait(self):
                return 0
        return _P()

    async def nosleep(_s):
        return None
    monkeypatch.setattr(psv, "asyncio", _AsyncioShim(create_subprocess_exec=spawn, sleep=nosleep))
    assert _run(psv._cycle_adapter()) is True
    assert [c[2] for c in seen] == ["off", "on"], "power off then on — bonding survives it"


def test_a_failed_adapter_cycle_reports_false_rather_than_raising(monkeypatch):
    async def boom(*a, **k):
        raise FileNotFoundError("bluetoothctl")
    monkeypatch.setattr(psv, "asyncio", _AsyncioShim(create_subprocess_exec=boom))
    assert _run(psv._cycle_adapter()) is False


# ══ phase 1 · identity ═══════════════════════════════════════════════════════════════════════════════

def test_identity_reads_the_device_and_cross_checks_the_fcc_id(monkeypatch):
    """Polar puts the FCC ID in the model field, so comparing them ties the report to a public filing
    and catches a swapped unit for free."""
    _patch_link(monkeypatch, _Verity())
    out = {}
    _run(psv.phase_identity("AA:BB", None, out))
    assert out["identity"]["firmware_rev"] == "2.2.1"
    assert out["identity"]["battery_pct"] == 87
    assert out["identity"]["fcc_id_matches_model"] is True


def test_a_missing_characteristic_is_recorded_not_fatal(monkeypatch):
    _patch_link(monkeypatch, _Verity(dis={"model": b"INW4J"}))
    out = {}
    _run(psv.phase_identity("AA:BB", None, out))
    assert "unavailable" in out["identity"]["serial"]
    assert out["identity"]["fcc_id_matches_model"] is True


def test_an_unreadable_battery_does_not_cost_the_identity(monkeypatch):
    class _NoBattery(_Verity):
        async def read_gatt_char(self, uuid):
            if uuid == psv.BATTERY:
                raise RuntimeError("not permitted")
            return await _Verity.read_gatt_char(self, uuid)
    _patch_link(monkeypatch, _NoBattery())
    out = {}
    _run(psv.phase_identity("AA:BB", None, out))
    assert "unavailable" in str(out["identity"]["battery_pct"])
    assert out["identity"]["model"] == "INW4J"


# ══ phase 2 · capability ═════════════════════════════════════════════════════════════════════════════

def test_capability_names_the_mode_bits_separately_from_the_streams(monkeypatch):
    """The feature bitmask mixes MEASUREMENTS and MODES. Naming SDK_MODE in pmd.MEAS_NAME would make
    webmon offer three modes to the user as capturable streams, so they are named here instead."""
    _patch_link(monkeypatch, _Verity(features=b"\x0f\x02\x20"))     # PPG + bit 0x0D
    out = {}
    _run(psv.phase_capability("AA:BB", None, out))
    cap = out["capability"]
    assert cap["measurements"] == ["ppg"]
    assert cap["flag_bits"] == {"0x0d": "OFFLINE_RECORDING"}
    assert set(cap["settings_menus"]) == {"ppg"}
    assert cap["settings_menus"]["ppg"]["offline"]["rate_hz"] == [55]
    assert cap["measurement_status"]["active"] == {}
    assert cap["control_transcript"], "every exchange is written down"


def test_an_unrecognised_flag_bit_is_labelled_rather_than_dropped(monkeypatch):
    _patch_link(monkeypatch, _Verity(features=b"\x0f\x02\x80"))     # bit 15, nothing known
    out = {}
    _run(psv.phase_capability("AA:BB", None, out))
    assert out["capability"]["flag_bits"] == {"0x0f": "unrecognised"}


def test_a_silent_read_op_is_reported_as_no_reply(monkeypatch):
    _patch_link(monkeypatch, _Verity(features=b"\x0f\x02", silent={0x07}))
    out = {}
    _run(psv.phase_capability("AA:BB", None, out))
    assert out["capability"]["offline_trigger_status"]["raw"] is None


def test_a_failed_feature_read_falls_back_to_sweeping_every_known_type(monkeypatch):
    """A GATT READ OF THE CONTROL POINT COSTS THE LINK FOR SUBSEQUENT WRITES, so this phase gives the
    read its own link — and when the read fails anyway the menu sweep must still happen."""
    class _NoFeatures(_Verity):
        async def read_gatt_char(self, uuid):
            if uuid == pmd.PMD_CONTROL:
                raise RuntimeError("Service Discovery has not been performed yet")
            return await _Verity.read_gatt_char(self, uuid)
    _patch_link(monkeypatch, _NoFeatures())
    out = {}
    _run(psv.phase_capability("AA:BB", None, out))
    assert "unavailable" in out["capability"]["feature_bitmask"]
    assert set(out["capability"]["settings_menus"]) == set(pmd.MEAS_NAME.values())


# ══ phase 3 · the recording ══════════════════════════════════════════════════════════════════════════

def test_a_recording_is_confirmed_by_the_device_not_by_the_ack(monkeypatch):
    dev = _Verity()
    _patch_link(monkeypatch, dev)
    out = {}
    _run(psv.phase_record("AA:BB", None, PPG, 0.01, out))
    rec = out["record"]
    assert rec["start_ack"] == "ok"
    assert rec["recording_confirmed_by_device"] is True
    assert rec["status_during"]["ppg"] == "offline"
    assert rec["stopped_confirmed_by_device"] is True
    assert rec["status_after"] == {}
    assert rec["negotiated"] == {"rate_hz": [55], "resolution_bits": [22], "channels": [4]}
    assert psv.pmd.is_offline_cmd(bytes.fromhex(rec["start_cmd"])), "the offline bit is the whole trick"


def test_the_stop_is_sent_bare_never_with_the_offline_bit(monkeypatch):
    """START carries the recording-type bit; STOP does not. `03 82` on real hardware is refused at the
    GATT layer with Unlikely Error — the symmetry was an inference and the device disproved it."""
    dev = _Verity()
    _patch_link(monkeypatch, dev)
    _run(psv.phase_record("AA:BB", None, ACC, 0.01, {}))
    stops = [w for w in dev.writes if w[0] == 0x03]
    assert stops and all(w[1] == ACC for w in stops), f"a stop carried the offline bit: {stops}"


def test_a_device_that_lies_about_stopping_is_reported(monkeypatch):
    """Measured: a recording asked to stop after 20 s ran on to 46 s. The ACK is not the evidence."""
    _patch_link(monkeypatch, _Verity(stop_works=False))
    out = {}
    _run(psv.phase_record("AA:BB", None, PPG, 0.01, out))
    assert out["record"]["stopped_confirmed_by_device"] is False


def test_an_in_charger_refusal_is_recorded_and_never_generalised(monkeypatch):
    """One observation each way exists (wall charger at 12% accepted; USB at 100% refused), and the
    variables were not held fixed. The report records the refusal; it does not conclude from it."""
    _patch_link(monkeypatch, _Verity(start_status=pmd.IN_CHARGER))
    out = {}
    _run(psv.phase_record("AA:BB", None, PPG, 0.01, out))
    rec = out["record"]
    assert rec["in_charger_refusal"] is True
    assert rec["start_ack"] == "in_charger"
    assert "status_during" not in rec, "nothing was recording, so nothing is claimed about it"
    assert rec["stopped_confirmed_by_device"] is True, "the finally-stop still runs"


def test_a_lost_ack_is_no_response_not_a_rejection(monkeypatch):
    """NO ANSWER IS NOT A REJECTION — BlueZ drops indications that share a connection interval."""
    _patch_link(monkeypatch, _Verity(silent={0x02}))
    out = {}
    _run(psv.phase_record("AA:BB", None, PPG, 0.01, out))
    assert out["record"]["start_ack"] == "no_response"


def test_a_measurement_with_no_start_command_says_so_rather_than_guessing(monkeypatch):
    _patch_link(monkeypatch, _Verity())
    monkeypatch.setattr(psv.pmd, "START", {})
    monkeypatch.setattr(psv.pmd, "build_start", lambda *a, **k: None)
    out = {}
    _run(psv.phase_record("AA:BB", None, PPG, 0.01, out))
    assert "no START for ppg" in out["record"]["error"]


def test_the_start_tlv_decoder_stops_at_a_truncated_value():
    """A count of 2 with one value's worth of bytes left: keep the complete value, stop at the stub."""
    assert psv._settings_from_start(bytes([0x02, 0x01, 0x00, 0x02, 0x37, 0x00, 0x16])) == {"rate_hz": [55]}


def test_an_unknown_setting_id_is_still_reported_by_number():
    got = psv._settings_from_start(bytes([0x02, 0x01, 0x7F, 0x01, 0x09, 0x00]))
    assert got == {"setting_0x7f": [9]}


# ══ phase 4 · the flash ══════════════════════════════════════════════════════════════════════════════

def _patch_psftp(monkeypatch, recs=None, listing_error=None, pull_error=None):
    async def lst(_a, _ad):
        if listing_error:
            raise RuntimeError(listing_error)
        return recs or []

    async def pull(_a, session, dest, _ad):
        if pull_error:
            raise RuntimeError(pull_error)
        os.makedirs(dest, exist_ok=True)
        return {"files": [{"name": "PPG.REC", "bytes": 77434, "ok": True, "extra": "dropped"}]}
    monkeypatch.setattr(psv.psftp, "list_recordings", lst)
    monkeypatch.setattr(psv.psftp, "pull_recording", pull)


def test_the_flash_listing_is_reported_without_a_pull_dir(monkeypatch):
    _patch_psftp(monkeypatch, recs=[{"path": "/U/0/20260803/R/120000/"}])
    out = {}
    _run(psv.phase_flash("AA:BB", None, None, out))
    assert out["flash"]["n_recordings"] == 1 and "pulled" not in out["flash"]


def test_a_failed_listing_is_an_error_on_the_phase_not_a_crash(monkeypatch):
    _patch_psftp(monkeypatch, listing_error="link wedged")
    out = {}
    _run(psv.phase_flash("AA:BB", None, "/tmp/nope", out))
    assert "link wedged" in out["flash"]["error"]


def test_each_session_lands_in_its_own_flattened_directory(monkeypatch, tmp_path):
    _patch_psftp(monkeypatch, recs=[{"path": "/U/0/20260803/R/120000/"}])
    out = {}
    _run(psv.phase_flash("AA:BB", None, str(tmp_path / "pull"), out))
    p = out["flash"]["pulled"][0]
    assert p["dir"].endswith("U_0_20260803_R_120000")
    assert p["files"] == [{"name": "PPG.REC", "bytes": 77434, "ok": True}]


def test_a_failed_pull_does_not_lose_the_listing(monkeypatch, tmp_path):
    _patch_psftp(monkeypatch, recs=[{"path": "/U/0/20260803/R/120000/"}], pull_error="disconnected")
    out = {}
    _run(psv.phase_flash("AA:BB", None, str(tmp_path), out))
    assert "disconnected" in out["flash"]["pulled"][0]["error"]
    assert out["flash"]["n_recordings"] == 1


# ══ phase 5 · the .REC container ═════════════════════════════════════════════════════════════════════

STAMP = "2026-08-03 12:01:20"


def _rec_header(stamp=STAMP, tlv=SETTINGS_TLV):
    b = bytearray(b"\x00\x2b\x4c\x7c\x3d\x01" + b"\x00" * 7 + b"\x75\xba\x6d\xf9")
    b += stamp.encode("ascii")
    b += b"\x00\x0b"
    assert len(b) == 0x26, len(b)
    return bytes(b) + tlv


def _ns(dt):
    return int((dt - POLAR_EPOCH).total_seconds() * 1e9)


def _frame(meas, ns, payload=b"\x00" * 40):
    return bytes([meas]) + struct.pack("<Q", ns) + b"\x01" + payload


def _rec_file(tmp_path, stamp=STAMP, n=3, gap_ms=944, meas=PPG, name="PPG.REC"):
    t0 = _dt.datetime.fromisoformat(stamp) + _dt.timedelta(seconds=1)
    b = bytearray(_rec_header(stamp))
    for k in range(n):
        b += _frame(meas, _ns(t0 + _dt.timedelta(milliseconds=gap_ms * k)))
    p = tmp_path / name
    p.write_bytes(bytes(b))
    return str(p)


def test_the_settings_tlvs_are_read_from_0x26_and_are_the_ones_the_start_carried():
    """Reading from 0x22 instead — reusing the START parser, which skips a 2-byte [op, meas] prefix —
    misaligns everything and yields rate_hz: [256, 55, 257, 22, ...]: the ids and values interleaved.
    Plausible-looking garbage, no error, which is why the offset is pinned."""
    assert psv.parse_rec_tlv(_rec_header()) == {"rate_hz": [55], "resolution_bits": [22], "channels": [4]}


def test_tlv_parsing_stops_at_the_first_thing_it_does_not_recognise():
    assert psv.parse_rec_tlv(_rec_header(tlv=bytes([0x7F, 0x01, 0x00, 0x00]))) == {}
    assert psv.parse_rec_tlv(_rec_header(tlv=bytes([0x00, 0x00]))) == {}, "a zero count is not a setting"
    assert psv.parse_rec_tlv(_rec_header(tlv=bytes([0x00, 0x09]))) == {}, "nor an implausible one"


def test_a_tlv_truncated_mid_value_stops_rather_than_reading_past_the_end():
    assert psv.parse_rec_tlv(_rec_header(tlv=bytes([0x00, 0x02, 0x37, 0x00, 0x16]))) == {"rate_hz": [55]}


def test_no_anchor_means_no_frame_search_at_all():
    """An unconstrained scan over delta-compressed payload matches by chance — the first version found
    6 frames where there were 49 and reported a span ending in 2034."""
    assert psv.find_rec_frames(b"\x01" + b"\x00" * 200, None) == []


def test_frames_are_found_and_confined_to_the_recordings_own_window(tmp_path):
    path = _rec_file(tmp_path)
    got = psv.decode_rec(path)
    assert got["n_frames"] == 3 and got["stream"] == "ppg"
    assert got["median_frame_gap_ms"] == 944.0
    assert got["span_sec"] == 1.89
    assert got["frame_types"] == [1]
    assert got["stride_bytes"] == 50
    assert abs(got["header_vs_first_frame_sec"] - 1.0) < 0.01


def test_a_frame_outside_the_window_is_rejected(tmp_path):
    b = bytearray(open(_rec_file(tmp_path, n=2), "rb").read())
    b += _frame(PPG, _ns(_dt.datetime(2034, 1, 1)))
    p = tmp_path / "spur.REC"
    p.write_bytes(bytes(b))
    assert psv.decode_rec(str(p))["n_frames"] == 2


def test_a_backwards_frame_is_rejected(tmp_path):
    b = bytearray(open(_rec_file(tmp_path, n=2), "rb").read())
    b += _frame(PPG, _ns(_dt.datetime.fromisoformat(STAMP) - _dt.timedelta(seconds=30)))
    p = tmp_path / "back.REC"
    p.write_bytes(bytes(b))
    assert psv.decode_rec(str(p))["n_frames"] == 2


def test_a_single_frame_file_reports_no_cadence(tmp_path):
    got = psv.decode_rec(_rec_file(tmp_path, n=1))
    assert got["n_frames"] == 1 and "median_frame_gap_ms" not in got


def test_an_unreadable_stamp_yields_no_frames_rather_than_a_wild_scan(tmp_path):
    b = bytearray(open(_rec_file(tmp_path), "rb").read())
    b[0x11:0x11 + 6] = b"\xff\xfe\xfd\xfc\xfb\xfa"
    p = tmp_path / "bad.REC"
    p.write_bytes(bytes(b))
    got = psv.decode_rec(str(p))
    assert got["header_stamp"] is None and got["n_frames"] == 0


def test_the_timebase_verdict_needs_this_runs_own_host_clock(tmp_path):
    """Passing `expected_start_utc` for an OLD file compares a stamp to an unrelated `now` — the first
    version called a 13.6 h-old ACC file 'local civil' on exactly that error."""
    path = _rec_file(tmp_path)
    host = _dt.datetime.fromisoformat(STAMP)
    assert psv.decode_rec(path, host)["timebase"] == "UTC"
    off = psv.decode_rec(path, host - _dt.timedelta(hours=2))
    assert "NOT host UTC" in off["timebase"] and off["stamp_minus_host_utc_sec"] == 7200.0


def test_the_median_of_nothing_is_none():
    assert psv._median([]) is None


# ── phase_decode ────────────────────────────────────────────────────────────────────────────────────

def test_decode_skips_a_missing_pull_dir():
    out = {}
    psv.phase_decode(out, "/nonexistent/path")
    psv.phase_decode(out, None)
    assert out == {}


def _ours_dir(tmp_path, when):
    d = tmp_path / f"U_0_20260803_R_{when.strftime('%H%M%S')}"
    d.mkdir()
    return d


def test_only_the_session_this_run_created_gets_the_host_clock_comparison(tmp_path):
    now = _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None, microsecond=0)
    stamp = now.strftime("%Y-%m-%d %H:%M:%S")
    ours = _ours_dir(tmp_path, now)
    _rec_file(ours, stamp=stamp, name="PPG.REC")
    old = tmp_path / "U_0_20260701_R_030000"
    old.mkdir()
    _rec_file(old, name="ACC.REC")
    (old / "notes.txt").write_text("ignored")
    out = {"record": {"host_utc_start": now.isoformat()}}
    psv.phase_decode(out, str(tmp_path))
    by = {d["file"]: d for d in out["decoded"]}
    assert by["PPG.REC"]["timebase"] == "UTC"
    assert "timebase" not in by["ACC.REC"], "an unrelated file must not be judged against `now`"
    assert set(by) == {"PPG.REC", "ACC.REC"}


def test_decode_without_a_recording_phase_judges_nothing(tmp_path):
    _rec_file(tmp_path, name="PPG.REC")
    out = {}
    psv.phase_decode(out, str(tmp_path))
    assert "timebase" not in out["decoded"][0]


def test_an_undecodable_file_is_reported_against_its_name(tmp_path, monkeypatch):
    _rec_file(tmp_path, name="PPG.REC")

    def boom(*a, **k):
        raise ValueError("not a container")
    monkeypatch.setattr(psv, "decode_rec", boom)
    out = {}
    psv.phase_decode(out, str(tmp_path))
    assert "not a container" in out["decoded"][0]["error"]


def test_a_directory_that_is_not_a_session_is_not_ours():
    e = _dt.datetime(2026, 8, 3, 12, 0, 0)
    assert psv._session_matches("/pull/whatever", e) is False
    assert psv._session_matches("/pull/U_0_R_9999XX", e) is False
    assert psv._session_matches("/pull/U_0_R_995959", e) is False, "6 digits that are not a time"
    assert psv._session_matches("/pull/U_0_R_030000", e) is False, "the right shape, the wrong time"
    assert psv._session_matches("/pull/U_0_R_120059/", e) is True


def test_the_local_clock_helper_is_a_real_epoch():
    assert abs(psv._now_epoch() - _dt.datetime.now().timestamp()) < 5


# ══ the safety net ═══════════════════════════════════════════════════════════════════════════════════

def test_whatever_is_running_gets_stopped_and_verified(monkeypatch):
    dev = _Verity()
    dev.active = {PPG: pmd.OFFLINE_ACTIVE, ACC: pmd.ONLINE_ACTIVE}
    _patch_link(monkeypatch, dev)
    out = {}
    _run(psv.stop_everything("AA:BB", None, out))
    assert sorted(out["left_clean"]["was_active"]) == ["acc", "ppg"]
    assert out["left_clean"]["still_active"] == []


def test_a_stop_that_cannot_be_verified_says_so_loudly(monkeypatch):
    """The stop write can be refused by the same deafness that broke the run, so the guard cannot fire.
    Silence here would read as 'clean'."""
    _patch_link(monkeypatch, _Verity(), found=False)
    out = {}
    _run(psv.stop_everything("AA:BB", None, out))
    assert "COULD NOT VERIFY" in out["left_clean"]["error"]
    assert "--no-write" in out["left_clean"]["action"]


# ══ the driver ═══════════════════════════════════════════════════════════════════════════════════════

def _stub_phases(monkeypatch, failing=()):
    async def mk(name):
        if name in failing:
            raise RuntimeError(f"{name} died")

    for name in ("identity", "capability", "record", "flash"):
        def make(n):
            async def fn(*a, **k):
                a[-1][n] = "ran"
                await mk(n)
            return fn
        monkeypatch.setattr(psv, f"phase_{name}", make(name))
    monkeypatch.setattr(psv, "daemon_holds_link", lambda: False)

    async def stop(_a, _ad, out):
        out["left_clean"] = {"was_active": []}
    monkeypatch.setattr(psv, "stop_everything", stop)


def test_one_dead_phase_does_not_cost_the_others(monkeypatch):
    """Each phase writes its findings into the report as it goes, so a crash at phase 3 still hands over
    phases 1-2 — the link is the scarce resource, not the analysis."""
    _stub_phases(monkeypatch, failing={"capability"})
    out = _run(psv.survey("AA:BB", None, PPG, 1.0, None, True))
    assert out["identity"] == "ran" and out["record"] == "ran" and out["flash"] == "ran"
    assert "capability died" in out["phase_errors"]["capability"]
    assert out["left_clean"] == {"was_active": []}


def test_no_write_skips_the_recording_and_the_stop(monkeypatch):
    _stub_phases(monkeypatch)
    out = _run(psv.survey("AA:BB", None, PPG, 1.0, None, False))
    assert "record" not in out
    assert "left_clean" not in out, "nothing was started, so there is nothing to stand down"


def test_main_writes_the_report_and_signals_a_partial_run(monkeypatch, tmp_path, capsys):
    async def fake(*a, **k):
        return {"address": a[0], "phase_errors": {"flash": "boom"}}
    monkeypatch.setattr(psv, "survey", fake)
    p = str(tmp_path / "survey.json")
    assert psv.main(["--address", "AA:BB", "--json", p, "--meas", "acc"]) == 1
    capsys.readouterr()
    assert json.load(open(p))["address"] == "AA:BB"


def test_main_returns_zero_on_a_clean_run(monkeypatch, capsys):
    seen = {}

    async def fake(address, adapter, meas, seconds, pull_dir, do_write):
        seen.update(meas=meas, do_write=do_write, seconds=seconds)
        return {"ok": True}
    monkeypatch.setattr(psv, "survey", fake)
    assert psv.main(["--address", "AA:BB", "--no-write", "--record-seconds", "9"]) == 0
    assert "ok" in capsys.readouterr().out
    assert seen == {"meas": PPG, "do_write": False, "seconds": 9.0}

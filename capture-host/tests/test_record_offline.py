# tepna-capture — tests/test_record_offline.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `record_offline: [ppi]` — record a measurement to the DEVICE'S OWN FLASH instead of streaming it.
#
# The mechanism is the ordinary negotiated START with bit 7 set on the measurement byte
# (`polar_pmd.as_offline`), proven against hardware 2026-08-10: `02 83` acked ok and the device then
# reported `ppi: "offline"`. What needs pinning here is not the bit — that is one function with its own
# tests — but the four ways the surrounding session can get it wrong:
#
#   1. STOP IS SHARED. `stop_cmd` clears the online AND the offline measurement (`03 82` is refused
#      outright), and the negotiation loop issues a "clear any stale stream" STOP on EVERY reconnect. A
#      naive wiring therefore ENDS the flash recording each time the link flaps, splitting one night
#      into as many recordings as it had drops. An in-progress recording must be left strictly alone.
#   2. SDK MODE demands every stream stopped, so re-entering it mid-recording means killing the
#      recording. It must be skipped instead.
#   3. A TYPE CANNOT BE BOTH. An offline stream yields no live data, so a writer for it would produce a
#      header-only file that reads as "the stream ran and the device said nothing" — fabricated absence.
#   4. THE ACK IS NOT THE RECORDING. `ok` means the command was accepted; only measurement-status (op 5)
#      says the flash is being written. The card must publish what the DEVICE said.

import asyncio
import sys

import capture
import polar_pmd as pmd

sys.path.insert(0, __import__("os").path.dirname(__file__))
import test_capture_runners as T          # noqa: E402  — the shared Polar fixture family

# The SAME module-global reset the sibling runner files use, re-exported rather than re-implemented.
# `run_polar` leaves `_STOP` set, so without it the first test here finishes and every later one drives
# NOTHING — which surfaces as "no ECG START was issued", i.e. an accusation against the code under test
# rather than against the harness. Cost 20 minutes to that exact misreading before this line existed.
_clean_stop = T._clean_stop


class StatusPolarClient(T.FlexPolarClient):
    """A FlexPolarClient that answers MEASUREMENT-STATUS (op 5) honestly.

    The base fake routes every parameterless op to the SDK-mode envelope, so `status_cmd()` (one byte,
    `05`) came back as an SDK reply and `is_recording` was False no matter what. That is fine for the
    negative case and useless for the positive one — and the positive one is where the damage lives
    (§1: a recording already running must not be stopped)."""

    def __init__(self, *a, recording=(), **kw):
        super().__init__(*a, **kw)
        self.recording = set(recording)      # measurements the device reports as OFFLINE_ACTIVE

    async def write_gatt_char(self, uuid, cmd, response=False):
        if uuid == pmd.PMD_CONTROL and len(cmd) == 1 and cmd[0] == 0x05:
            self.writes.append(bytes(cmd))
            ctrl = self.cbs.get(pmd.PMD_CONTROL)
            if ctrl:
                # [0xF0, op, meas, status, moreFlag, <payload>] — FIVE header bytes, status at [3].
                # This fake emitted FOUR and passed, because the parser it was written against began
                # reading at the status byte. Fixing polar_pmd surfaced the malformed frame here.
                body = bytes([(pmd.OFFLINE_ACTIVE << 6) | m for m in sorted(self.recording)])
                ctrl(0, bytes([0xF0, 0x05, 0x00, 0x00, 0x00]) + body)
            return
        # A START that targets the flash makes it so, which is what lets a later status read agree with
        # the command that was sent rather than with a constant.
        if uuid == pmd.PMD_CONTROL and len(cmd) >= 2 and cmd[0] == 0x02 and (cmd[1] & pmd.OFFLINE_BIT):
            self.recording.add(cmd[1] & ~pmd.OFFLINE_BIT)
        if uuid == pmd.PMD_CONTROL and len(cmd) >= 2 and cmd[0] == 0x03:
            self.recording.discard(cmd[1] & ~pmd.OFFLINE_BIT)
        return await super().write_gatt_char(uuid, cmd, response=response)


def _run(monkeypatch, tmp_path, streams, record_offline, *, recording=(), sdk=False, sets=None):
    # PER-CALL, not per-test. `run_polar` leaves `_STOP` set, and the module-level `_clean_stop` fixture
    # only resets it once per test — so a test that drives TWO sessions (the SDK-mode one compares
    # recording vs not-recording) had its second session return immediately having done nothing, which
    # reads as "SDK mode was not entered" rather than "the harness never ran it".
    capture._STOP = asyncio.Event()
    T._polar_common(monkeypatch)
    if sets is not None:
        from test_run_polar_live_contract import _spy_set
        _spy_set(monkeypatch, sets)
    c = StatusPolarClient(data_frames=[T._ecg_frame()], recording=recording)
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    dev = T._pdev(streams=streams, record_offline=record_offline)
    if sdk:
        dev["sdk_mode"] = True
    asyncio.run(capture.run_polar(dev, str(tmp_path)))
    return c


def _starts(c):
    return [w for w in c.writes if len(w) >= 2 and w[0] == 0x02]


def _stops(c):
    return [w for w in c.writes if len(w) >= 2 and w[0] == 0x03]


def test_the_offline_START_carries_the_recording_bit_and_the_live_one_does_not(tmp_path, monkeypatch):
    """The bit is set on the MEASUREMENT byte of the same negotiated command, so the settings the device
    just agreed to travel with it verbatim. ECG stays live in the same session — the flag is per-stream,
    not per-device, and a session that flipped everything to flash would be a different bug."""
    c = _run(monkeypatch, tmp_path, ["ecg", "ppi"], ["ppi"])
    off = [w for w in _starts(c) if w[1] & pmd.OFFLINE_BIT]
    live = [w for w in _starts(c) if not (w[1] & pmd.OFFLINE_BIT)]
    assert off, "no offline START was issued for a stream configured to record to flash"
    assert all((w[1] & ~pmd.OFFLINE_BIT) == pmd.PPI for w in off), \
        f"something other than PPI was sent to the flash: {[w.hex() for w in off]}"
    assert any((w[1] & ~pmd.OFFLINE_BIT) == pmd.ECG for w in live), \
        "ECG must still be started as a LIVE stream in the same session"


def test_an_offline_stream_gets_NO_writer_and_NO_bus_entry(tmp_path, monkeypatch):
    """A type cannot be both, so nothing will arrive on the link for it. A writer would leave a
    header-only file that reads as "the device said nothing" — the fabricated-absence class — and a
    registered stream with no samples paints `stall` on a card that is working exactly as asked."""
    from test_run_polar_live_contract import _spy
    bus = _spy(monkeypatch)
    T._polar_common(monkeypatch)
    c = StatusPolarClient(data_frames=[T._ecg_frame()])
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    asyncio.run(capture.run_polar(T._pdev(streams=["ecg", "ppi"], record_offline=["ppi"]), str(tmp_path)))
    keys = [a[0] for a, _k in bus.seen["register"]]
    assert not any("ppi" in str(k) for k in keys), \
        f"a stream recorded to flash was registered on the live bus: {keys}"
    assert any("ecg" in str(k) for k in keys), "…while the live stream is still registered"
    assert not list(tmp_path.rglob("*_PPI.txt")), "a header-only PPI file was written for a flash recording"


def test_a_recording_ALREADY_RUNNING_is_not_stopped_and_not_restarted(tmp_path, monkeypatch):
    """§1, the one that costs a night. `stop_cmd` serves both flavours, so the routine stale-stream STOP
    would end the recording on every reconnect. The device is asked FIRST (status op 5) and an active
    measurement is skipped entirely — no STOP, no re-START."""
    c = _run(monkeypatch, tmp_path, ["ecg", "ppi"], ["ppi"], recording={pmd.PPI})
    assert not [w for w in _stops(c) if (w[1] & ~pmd.OFFLINE_BIT) == pmd.PPI], \
        "an in-progress flash recording was STOPPED — the night is now split at every reconnect"
    assert not [w for w in _starts(c) if (w[1] & ~pmd.OFFLINE_BIT) == pmd.PPI], \
        "an in-progress flash recording was re-STARTED rather than left alone"
    assert [w for w in _starts(c) if (w[1] & ~pmd.OFFLINE_BIT) == pmd.ECG], \
        "…and the live streams are negotiated as usual around it"


def test_SDK_mode_is_NOT_re_entered_while_a_recording_runs(tmp_path, monkeypatch):
    """§2. Entering SDK mode requires every stream stopped, and the only way to grant that mid-recording
    is to end the recording. A rate menu is not worth a night: the mode lasts until a power cycle, and a
    power cycle would have taken the recording anyway."""
    c = _run(monkeypatch, tmp_path, ["ecg", "ppi"], ["ppi"], recording={pmd.PPI}, sdk=True)
    assert not [w for w in _starts(c) if w[1] == pmd.SDK_MODE], \
        "SDK mode was entered while the device was recording — that requires stopping the recording"

    # …and with nothing recording it IS entered, so the guard is the recording and not a disabled switch.
    c2 = _run(monkeypatch, tmp_path, ["ecg", "ppi"], ["ppi"], sdk=True)
    assert [w for w in _starts(c2) if w[1] == pmd.SDK_MODE], \
        "SDK mode must still be entered when no recording is in progress"


def test_the_card_reports_what_the_DEVICE_said_not_the_ACK(tmp_path, monkeypatch):
    """§4. An ack of `ok` means the command was accepted. Only measurement-status says the flash is
    actually being written, and publishing the ack instead is how a recording that never started reads
    as one that did."""
    sets: list = []
    _run(monkeypatch, tmp_path, ["ecg", "ppi"], ["ppi"], sets=sets)
    seen = {}
    for _name, kv in sets:
        if "recording_offline" in kv:
            seen.update(kv["recording_offline"])
    assert seen.get("ppi") is True, f"the device confirmed the recording but the card does not say so: {seen}"


def test_a_device_that_does_NOT_confirm_is_reported_as_unconfirmed(tmp_path, monkeypatch):
    """The mirror image, and the one that matters: the START is acked `ok` but status never shows the
    measurement as active. That must publish False — 'accepted' is not 'recording'."""
    class NeverRecords(StatusPolarClient):
        async def write_gatt_char(self, uuid, cmd, response=False):
            r = await super().write_gatt_char(uuid, cmd, response=response)
            self.recording.clear()          # ack ok, but the flash never actually starts
            return r

    sets: list = []
    T._polar_common(monkeypatch)
    from test_run_polar_live_contract import _spy_set
    _spy_set(monkeypatch, sets)
    c = NeverRecords(data_frames=[T._ecg_frame()])
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    asyncio.run(capture.run_polar(T._pdev(streams=["ecg", "ppi"], record_offline=["ppi"]), str(tmp_path)))
    seen = {}
    for _name, kv in sets:
        if "recording_offline" in kv:
            seen.update(kv["recording_offline"])
    assert seen.get("ppi") is False, f"an unconfirmed recording was not reported as unconfirmed: {seen}"


def test_no_record_offline_config_changes_nothing(tmp_path, monkeypatch):
    """The control. With the key absent the session must be byte-for-byte the old one: no status query,
    no offline bit, and a writer for every requested stream."""
    c = _run(monkeypatch, tmp_path, ["ecg", "ppi"], [])
    assert not [w for w in _starts(c) if w[1] & pmd.OFFLINE_BIT], "an offline START was issued unasked"
    assert not [w for w in c.writes if len(w) == 1 and w[0] == 0x05], \
        "measurement-status was queried for a device with nothing recording to flash"

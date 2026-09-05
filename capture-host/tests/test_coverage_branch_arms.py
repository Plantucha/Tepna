# tepna-capture — tests/test_coverage_branch_arms.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The unexercised ARM of an otherwise-covered branch — the residue that only branch coverage sees.

Statement coverage was already 100% on every module here. Each of these is a condition that had only
ever been observed true (or only ever false), which is the shape a decoder bug hides in: the loop that
skips a malformed slot, the cache that must forget a vanished adapter, the second occurrence that must
not re-log. Nothing below is a new code path — it is the half of an existing one nothing had run.
"""
import asyncio
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bonding  # noqa: E402
import clockcfg  # noqa: E402
import link_rssi  # noqa: E402
import oxyii  # noqa: E402
import polar_pmd as pmd  # noqa: E402
import polar_psftp as ps  # noqa: E402
import pull_session  # noqa: E402
import telemetry  # noqa: E402
import writers  # noqa: E402
from test_polar_psftp_client import FakeClient, _install  # noqa: E402
from test_pull_session import FakeRing  # noqa: E402
from test_pull_session import _install as _install_ring  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


# ── bonding.scan: an RSSI line for a device that never announced itself ────────────────────────────
def test_scan_ignores_an_rssi_line_for_a_device_it_never_saw_announce(monkeypatch):
    """bluetoothctl streams [CHG] RSSI updates for devices it already knew from a PREVIOUS scan, which
    never emit a `Device <addr> <name>` announcement in this run. Those must not conjure a Found with no
    name — the RSSI enrichment attaches to discovered devices or is dropped."""
    out = ("Device AA:BB:CC:DD:EE:01 O2Ring 0123\n"
           "Device AA:BB:CC:DD:EE:01 RSSI: 0xffffffb2 (-78)\n"
           "Device 11:22:33:44:55:66 RSSI: 0xffffffc4 (-60)\n")   # never announced

    async def fake_script(_lines):
        return out
    monkeypatch.setattr(bonding, "_delayed_script", fake_script)

    # `scan` ALSO runs a per-device `info` after the RSSI pass. Left unpatched that spawns a real
    # bluetoothctl, which a dev box has and CI does not — the test then passes locally and dies with
    # FileNotFoundError in CI. Nothing in this suite may depend on a binary being installed.
    async def fake_btctl(_script, timeout=8):
        return "Bonded: yes\nConnected: no\n"
    monkeypatch.setattr(bonding, "_btctl", fake_btctl)
    found = _run(bonding.scan())
    assert [f.address for f in found] == ["AA:BB:CC:DD:EE:01"]
    assert found[0].rssi == -78


# ── clockcfg._kv: timedatectl output is not all key=value ──────────────────────────────────────────
def test_kv_skips_lines_that_are_not_assignments():
    """`timedatectl show` is clean key=value, but the same parser reads output that can carry a blank
    line or a warning banner. A line with no `=` must be skipped, not split into a bogus key."""
    assert clockcfg._kv("NTP=yes\n\nWarning: something\nNTPSynchronized=no\n") == {
        "NTP": "yes", "NTPSynchronized": "no"}


# ── link_rssi.resolve_hci: the configured adapter vanished ─────────────────────────────────────────
def test_resolve_hci_forgets_a_cached_index_when_the_adapter_disappears(monkeypatch):
    """hci indices RE-ENUMERATE, and a controller can also simply go away (an unplugged dongle). Serving
    the last-known index for an adapter that is no longer present pins connections to a DIFFERENT radio —
    the 2026-07-18 hci0/hci2 swap. The cache entry has to go."""
    key = "AA:BB:CC:DD:EE:FF"
    monkeypatch.setitem(link_rssi._HCI_CACHE, key, "hci0")
    monkeypatch.setattr(link_rssi, "sysfs_hci", lambda: {"00:11:22:33:44:55": "hci1"})

    async def no_dbus():
        return {}
    monkeypatch.setattr(link_rssi, "dbus_hci", no_dbus)
    assert _run(link_rssi.resolve_hci(key, refresh=True)) is None
    assert key not in link_rssi._HCI_CACHE, "a vanished adapter must not keep serving a stale index"


def test_resolve_hci_is_a_no_op_on_a_miss_that_was_never_cached(monkeypatch):
    """The other arm: nothing cached, nothing to delete, and still no crash."""
    monkeypatch.setattr(link_rssi, "sysfs_hci", lambda: {"00:11:22:33:44:55": "hci1"})

    async def no_dbus():
        return {}
    monkeypatch.setattr(link_rssi, "dbus_hci", no_dbus)
    link_rssi._HCI_CACHE.pop("99:99:99:99:99:99", None)
    assert _run(link_rssi.resolve_hci("99:99:99:99:99:99", refresh=True)) is None


# ── oxyii.parse_file_list: a truncated final slot ──────────────────────────────────────────────────
def test_parse_file_list_drops_a_slot_the_reply_was_cut_short_in():
    """The count byte is the DEVICE's claim; the payload is what actually arrived. A reply truncated
    mid-slot must yield the whole sessions it does have, not an index error and not a garbage stamp
    built from the fragment."""
    good = b"20260725020723\x00\x00"
    payload = bytes([2]) + good + b"2026072503"          # second slot is 10 bytes, not 16
    assert oxyii.parse_file_list(payload) == ["20260725020723"]


# ── polar_pmd.build_start: a device that reports no sample-rate option ─────────────────────────────
def test_build_start_omits_a_setting_the_device_does_not_report():
    """"Only settings the device actually reports are included." A device offering resolution but no
    sample-rate list must not have a rate TLV invented for it — the START would then advertise a rate
    the firmware never offered, and it is rejected whole (the 0x05 ERROR_INVALID_PARAMETER class)."""
    assert pmd.build_start(pmd.ECG, {0x01: [14]}) == pmd._start_cmd(pmd.ECG, (0x01, 14))
    # ...and with the rate present, it is included — so the omission above is the reported settings
    # talking, not the builder dropping a TLV it should have sent.
    assert pmd.build_start(pmd.ECG, {0x00: [130], 0x01: [14]}) == pmd.START[pmd.ECG]


# ── telemetry: a shape breach logs ONCE per stream ────────────────────────────────────────────────
def test_a_repeated_shape_breach_is_flagged_every_time_but_logged_only_once(caplog):
    """This path can run at 130 Hz. The flag must stay raised for the monitor while the log line is
    emitted once — a per-frame log on a corrupt ECG decoder floods the journal off the disk, which is
    the failure mode the once-per-stream guard exists for."""
    bus = telemetry.TelemetryBus()
    bus.push("ecg", [1.0, 2.0], fs=130)                     # declares 1 channel
    with caplog.at_level("ERROR"):
        bus.push("ecg", [[1.0, 2.0], [3.0, 4.0]], fs=130)   # breach 1 — logs
        first = len([r for r in caplog.records if "SHAPE BREACH" in r.getMessage()])
        bus.push("ecg", [[5.0, 6.0], [7.0, 8.0]], fs=130)   # breach 2 — must NOT log again
        second = len([r for r in caplog.records if "SHAPE BREACH" in r.getMessage()])
    assert first == 1 and second == 1
    assert "ecg" in bus.shape_errors(), "the flag stays raised for the monitor either way"


# ── writers: write_hr on a writer that owns no RR sibling ─────────────────────────────────────────
def test_write_hr_on_a_non_hr_writer_writes_no_orphan_rr_file(tmp_path):
    """Only the `hr` stream opens the sibling `_RR.txt`. The guard in write_hr is what stops a caller
    that reached for the wrong writer from silently producing a half-written RR file with no HR beside
    it — the orphan shape §C8 had to clean up 4 of."""
    p = tmp_path / "Polar_H10_02849638_20260725223000_PPI.txt"
    w = writers.StreamWriter(str(p), "ppi", fsync=False)
    w.write_hr(dt.datetime(2026, 7, 25, 22, 30, 0), 0, 55, [800, 810])
    w.close()
    assert w.paths == [str(p)], "no RR sibling is owned, so none may be reported"
    assert not any(f.endswith("_RR.txt") for f in os.listdir(tmp_path))


# ── polar_psftp ───────────────────────────────────────────────────────────────────────────────────
def test_directory_entry_with_an_unknown_field_number_still_parses():
    """The directory protobuf is a device's, not ours: a firmware that adds a field must not break the
    listing. Only name(1)/size(2) are read; anything else is skipped."""
    entry = ps._pb_msg(1, ps._pb_msg(1, b"20260725/") + ps._pb_uint(7, 99) + ps._pb_uint(2, 512))
    assert ps._parse_directory(entry) == [("20260725/", 512)]


def test_a_client_without_acquire_mtu_still_connects(monkeypatch):
    """`_acquire_mtu` is a bleak INTERNAL — it is not in the public API and has come and gone between
    versions. Its absence must degrade to the 23-byte default, not raise on connect."""
    c = FakeClient()
    monkeypatch.delattr(FakeClient, "_acquire_mtu")
    c.mtu_size = None                               # and no negotiated MTU to read either
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            assert fs._frame_mtu == 20              # max(20, 23-3)
            assert fs.mtu is None
    _run(go())


def test_the_mtu_property_reports_the_negotiated_size(monkeypatch):
    """`mtu` is what the operator reads to see whether a pull will run at 250 or crawl at 23."""
    c = FakeClient()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            assert fs.mtu == 250
    _run(go())


def test_aexit_on_a_session_that_never_connected_is_a_no_op():
    """__aexit__ runs whatever happened inside the `async with`. If the connect itself raised, there is
    no client to tear down, and the teardown must not raise a second exception over the first — that
    replaces the real cause with an AttributeError."""
    fs = ps.PolarPsFtp("AA:BB")
    assert fs._client is None
    _run(fs.__aexit__(None, None, None))


def test_set_local_time_honours_an_explicit_offset_and_skips_the_system_clock(monkeypatch):
    """Both arms of set_local_time in one pass. `tz_offset_min=0` is the DEFAULT the None branch picks;
    an explicit non-zero offset must be passed through rather than overwritten. And the H10 gets
    `with_system_time=False` because SET_SYSTEM_TIME answers NOT_IMPLEMENTED (error 201) there — sending
    it anyway turns a working clock set into a failed one."""
    c = FakeClient()
    _install(monkeypatch, c)
    sent = []
    real_query = ps.PolarPsFtp.query

    async def spy(self, query_id, params=b"", timeout=20.0):
        sent.append(query_id)
        return await real_query(self, query_id, params, timeout)
    monkeypatch.setattr(ps.PolarPsFtp, "query", spy)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            await fs.set_local_time(dt.datetime(2026, 7, 25, 22, 30), tz_offset_min=-240,
                                    with_system_time=False)
    _run(go())
    assert sent == [ps.SET_LOCAL_TIME], "the H10 path must not send SET_SYSTEM_TIME"


def test_session_meta_leaves_start_local_none_when_the_path_carries_no_stamp():
    """A recording path that does not follow /U/0/<date>/E/<time>/ has no start time to report. None is
    the honest answer — a fabricated one would sort the recording into the wrong night."""
    m = ps._session_meta("/U/0/SOMETHING/R/")
    assert m["start_local"] is None and m["date"] is None
    m2 = ps._session_meta("/U/0/20260725/E/170114/")
    assert m2["start_local"] == "2026-07-25T17:01:14" and m2["kind"] == "exercise"


# ── pull_session ──────────────────────────────────────────────────────────────────────────────────
class _CorruptingRing(FakeRing):
    """Emits one CRC-broken frame ahead of every real reply. It reassembles cleanly — the declared
    length is right — and then fails to decode, which is the case the notify callback's `if r:` guards.
    Real cause: a partially-corrupted BLE notification, seen on a marginal link."""

    def _reply(self, op, payload):
        bad = bytearray(oxyii.encode(op, payload))
        bad[-1] ^= 0xFF                    # break the CRC only — framing stays valid
        self.notify(0, bytes(bad))
        super()._reply(op, payload)


def test_a_frame_that_fails_its_crc_is_dropped_rather_than_queued(tmp_path, monkeypatch):
    """A corrupt frame must not reach the queue. If it did, `_wait` would take it for the reply it was
    waiting on and the download would proceed on garbage — the exact failure the CRC exists to catch."""
    blob = b"\x01\x03" + bytes(range(256)) * 4
    ring = _CorruptingRing(["20260719010000"], blob)
    _install_ring(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert len(got) == 1
    assert open(got[0], "rb").read() == blob, "the good frames still round-trip exactly"


def test_a_large_transfer_without_a_progress_hook_still_completes(tmp_path, monkeypatch):
    """`on_progress` is a UI concern and the CLI passes none — but the progress branch only runs on a
    transfer big enough to cross a report point, so 'no hook' had only ever been exercised on downloads
    too small to reach it. This is the operator's `python pull_session.py` on a real night."""
    blob = b"\x01\x03" + b"n" * 60000
    ring = FakeRing(["20260719010000"], blob, chunk=512)
    _install_ring(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert len(got) == 1 and os.path.getsize(got[0]) == len(blob)

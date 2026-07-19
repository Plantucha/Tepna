# tepna-capture — tests/test_coverage_medium_modules.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Closes the remaining branches in writers (fsync + the OSError/ValueError close guards), link_rssi
# (the hci resolver + its cache eviction), pull_session (the best-effort MTU acquire), and bonding's
# timed-script reader. Each asserts the behaviour of the specific edge — a durability fsync, a vanished
# adapter, a raising _acquire_mtu — that the happy path never reaches.

import asyncio
import datetime as dt

import pytest

import bonding
import link_rssi
import pull_session
import writers


def _run(coro):
    return asyncio.run(coro)


# ── writers: fsync path + double-close/flush-after-close guards ─────────────────────────────────────
WHEN = dt.datetime(2026, 7, 19, 3, 4, 5, 678000)


def test_polar_ns_to_t_ms():
    assert writers.polar_ns_to_t_ms(7_692_308) == pytest.approx(7.692308)


def test_stream_writer_fsync_path_and_idempotent_close(tmp_path):
    """fsync=True forces the durability path (flush + os.fsync). close() twice, and flush after close,
    must not raise — the OSError/ValueError guards catch the already-closed handle."""
    p = tmp_path / "x_ECG.txt"
    w = writers.StreamWriter(str(p), "ecg", fsync=True)      # real fsync on a real fd
    w.write_ecg(WHEN, 1_000_000_000, 0.0, 42)
    w.flush()
    w.close()
    w.close()                                                # -> the except guard
    w.flush()                                                # flush after close -> guard
    assert p.exists()


@pytest.mark.parametrize("make,write", [
    (lambda p: writers.OxyFrameLogWriter(p, fsync=True), lambda w: w.write(WHEN, {"spo2": 95})),
    (lambda p: writers.HostClockLogWriter(p, fsync=True), lambda w: w.write(WHEN, {"trust": "ntp"})),
    (lambda p: writers.LinkLogWriter(p, fsync=True), lambda w: w.write(WHEN, "D", True, -50, 90)),
    (lambda p: writers.Spo2CsvWriter(p, fsync=True), lambda w: w.write(WHEN, 96, 54, 0)),
])
def test_every_sidecar_fsyncs_and_survives_double_close(tmp_path, make, write):
    w = make(str(tmp_path / "s.csv"))
    write(w)
    w.flush()
    w.close()
    w.close()
    w.flush()


# ── link_rssi.resolve_hci ───────────────────────────────────────────────────────────────────────────
def test_parse_hci_dev():
    assert link_rssi.parse_hci_dev("Devices:\n\thci0\tAC:A7:F1:29:9D:1D\n\thci2\t58:10:31:F3:2C:30\n") == {
        "AC:A7:F1:29:9D:1D": "hci0", "58:10:31:F3:2C:30": "hci2"}


def _stub_hcitool(monkeypatch, out):
    async def fake(cmd, timeout=4.0):
        return out
    monkeypatch.setattr(link_rssi, "_run", fake)


def test_resolve_hci_maps_a_configured_mac_and_caches_it(monkeypatch):
    link_rssi._HCI_CACHE.clear()
    _stub_hcitool(monkeypatch, "\thci2\tAC:A7:F1:29:9D:1D\n")
    assert _run(link_rssi.resolve_hci("AC:A7:F1:29:9D:1D")) == "hci2"
    assert link_rssi._HCI_CACHE.get("AC:A7:F1:29:9D:1D") == "hci2"     # cached


def test_resolve_hci_uses_the_cache_without_refresh(monkeypatch):
    link_rssi._HCI_CACHE.clear()
    link_rssi._HCI_CACHE["AA:BB:CC:DD:EE:FF"] = "hci9"
    called = {"n": 0}
    async def fake(cmd, timeout=4.0):
        called["n"] += 1; return ""
    monkeypatch.setattr(link_rssi, "_run", fake)
    assert _run(link_rssi.resolve_hci("AA:BB:CC:DD:EE:FF")) == "hci9"
    assert called["n"] == 0, "a cached lookup must not shell out"


def test_resolve_hci_none_adapter_takes_the_first_controller(monkeypatch):
    link_rssi._HCI_CACHE.clear()
    _stub_hcitool(monkeypatch, "\thci0\tAA:AA:AA:AA:AA:AA\n")
    assert _run(link_rssi.resolve_hci(None)) == "hci0"


def test_resolve_hci_returns_none_when_no_controllers(monkeypatch):
    link_rssi._HCI_CACHE.clear()
    _stub_hcitool(monkeypatch, "")
    assert _run(link_rssi.resolve_hci("AC:A7:F1:29:9D:1D")) is None


def test_resolve_hci_evicts_a_vanished_adapter_from_the_cache(monkeypatch):
    """A configured adapter that used to resolve but is now absent must be dropped from the cache, not
    keep serving a stale index — the exact 2026-07-18 hci re-enumeration bug."""
    link_rssi._HCI_CACHE.clear()
    link_rssi._HCI_CACHE["AC:A7:F1:29:9D:1D"] = "hci2"       # stale entry
    _stub_hcitool(monkeypatch, "\thci0\t58:10:31:F3:2C:30\n")  # our adapter no longer listed
    assert _run(link_rssi.resolve_hci("AC:A7:F1:29:9D:1D", refresh=True)) is None
    assert "AC:A7:F1:29:9D:1D" not in link_rssi._HCI_CACHE, "stale index must be evicted"


def test_read_rssi_returns_none_without_a_helper_or_device(monkeypatch):
    monkeypatch.setattr(link_rssi.os.path, "exists", lambda _p: False)
    assert _run(link_rssi.read_rssi("AC:A7:F1:29:9D:1D", "24:AC:AC:02:84:96")) is None
    assert _run(link_rssi.read_rssi("AC:A7:F1:29:9D:1D", "")) is None


# ── pull_session: the best-effort MTU acquire ───────────────────────────────────────────────────────
def test_pull_acquires_mtu_when_the_backend_offers_it(tmp_path, monkeypatch):
    """The _backend._acquire_mtu() call (best-effort, reporting only). Both the success and the
    raising path must leave the pull unaffected."""
    from tests.test_pull_session import FakeRing, FakeDevice

    class _Backend:
        def __init__(self, boom): self.boom = boom
        async def _acquire_mtu(self):
            if self.boom: raise RuntimeError("mtu nope")

    for boom in (False, True):
        ring = FakeRing(["20260719010000"], b"\x01\x03" + b"z" * 90)
        ring._backend = _Backend(boom)
        async def find(*a, **k): return FakeDevice()
        monkeypatch.setattr(pull_session.BleakScanner, "find_device_by_filter", find)
        monkeypatch.setattr(pull_session, "BleakClient", lambda dev, **kw: ring)
        async def no_sleep(_s): return None
        monkeypatch.setattr(pull_session.asyncio, "sleep", no_sleep)
        got = _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000"))
        assert len(got) == 1, f"acquire boom={boom} must not affect the pull"


# ── bonding._delayed_script: data drain + timeout kill ──────────────────────────────────────────────
def test_delayed_script_collects_stdout_and_survives_a_wait_timeout(monkeypatch):
    reads = [b"Device AA:BB Polar\n", b""]     # one chunk then EOF

    class _P:
        returncode = None
        class _S:
            async def read(self, _n):
                return reads.pop(0) if reads else b""
        stdout = _S()
        class _I:
            def write(self, _b): pass
            async def drain(self): pass
            def close(self): pass
        stdin = _I()
        async def wait(self):
            raise asyncio.TimeoutError          # -> the except: proc.kill()
        def kill(self): pass
    async def fake(*a, **k): return _P()
    monkeypatch.setattr(bonding.asyncio, "create_subprocess_exec", fake)
    async def no_sleep(_s): return None
    monkeypatch.setattr(bonding.asyncio, "sleep", no_sleep)
    out = _run(bonding._delayed_script([(0.1, "scan on"), (0, "quit")]))
    assert "Polar" in out, "collected stdout must survive the wait-timeout kill path"


# ── writers: periodic-flush cadence + the close-guard excepts ────────────────────────────────────────
class _RaisingFh:
    """A file handle that raises on flush/close/fileno — drives the writers' OSError/ValueError guards,
    which closing an already-closed real file cannot (Python's fh.close() is idempotent, never raises)."""
    def write(self, _s): pass
    def flush(self): raise OSError("disk gone")
    def fileno(self): raise ValueError("closed")
    def close(self): raise OSError("close failed")


@pytest.mark.parametrize("make,write", [
    (lambda p: writers.StreamWriter(p, "ecg", fsync=False), lambda w: w.write_ecg(WHEN, 1, 0.0, 1)),
    (lambda p: writers.OxyFrameLogWriter(p, fsync=False), lambda w: w.write(WHEN, {"spo2": 95})),
    (lambda p: writers.HostClockLogWriter(p, fsync=False), lambda w: w.write(WHEN, {"trust": "x"})),
    (lambda p: writers.LinkLogWriter(p, fsync=False), lambda w: w.write(WHEN, "D", True, -1, 1)),
    (lambda p: writers.Spo2CsvWriter(p, fsync=False), lambda w: w.write(WHEN, 96, 54, 0)),
])
def test_a_writer_close_swallows_a_raising_handle(tmp_path, make, write):
    """close() must never propagate — a failing flush/fsync/close during teardown would mask the real
    error that caused the shutdown."""
    w = make(str(tmp_path / "w.txt"))
    write(w)
    w._fh = _RaisingFh()
    w.close()            # must not raise despite the handle raising on flush AND close


@pytest.mark.parametrize("make,write", [
    (lambda p: writers.OxyFrameLogWriter(p, flush_interval=0, fsync=False), lambda w: w.write(WHEN, {"spo2": 9})),
    (lambda p: writers.HostClockLogWriter(p, flush_interval=0, fsync=False), lambda w: w.write(WHEN, {"trust": "x"})),
    (lambda p: writers.LinkLogWriter(p, flush_interval=0, fsync=False), lambda w: w.write(WHEN, "D", True, -1, 1)),
    (lambda p: writers.Spo2CsvWriter(p, flush_interval=0, fsync=False), lambda w: w.write(WHEN, 96, 54, 0)),
])
def test_zero_flush_interval_flushes_on_every_write(tmp_path, make, write):
    w = make(str(tmp_path / "w.txt"))
    write(w)                                  # flush_interval=0 -> the periodic-flush branch runs
    w.close()


# ── link_rssi.read_rssi full path ───────────────────────────────────────────────────────────────────
def test_read_rssi_parses_a_helper_reading(monkeypatch):
    monkeypatch.setattr(link_rssi.os.path, "exists", lambda _p: True)
    async def fake_resolve(mac, refresh=False): return "hci0"
    monkeypatch.setattr(link_rssi, "resolve_hci", fake_resolve)
    async def fake_run(cmd, timeout=4.0): return "RSSI return value: -63"
    monkeypatch.setattr(link_rssi, "_run", fake_run)
    monkeypatch.setattr(link_rssi, "_MODE", None)
    v = _run(link_rssi.read_rssi("AC:A7:F1:29:9D:1D", "24:AC:AC:02:84:96"))
    assert v == -63


def test_read_rssi_none_when_the_adapter_cannot_be_resolved(monkeypatch):
    monkeypatch.setattr(link_rssi.os.path, "exists", lambda _p: True)
    async def no_hci(mac, refresh=False): return None
    monkeypatch.setattr(link_rssi, "resolve_hci", no_hci)
    assert _run(link_rssi.read_rssi("AC:A7:F1:29:9D:1D", "24:AC:AC:02:84:96")) is None


def test_read_rssi_none_when_both_privilege_modes_fail(monkeypatch):
    monkeypatch.setattr(link_rssi.os.path, "exists", lambda _p: True)
    async def fake_resolve(mac, refresh=False): return "hci0"
    monkeypatch.setattr(link_rssi, "resolve_hci", fake_resolve)
    async def fake_run(cmd, timeout=4.0): return ""       # helper yields nothing -> parse None
    monkeypatch.setattr(link_rssi, "_run", fake_run)
    monkeypatch.setattr(link_rssi, "_MODE", "direct")
    assert _run(link_rssi.read_rssi("AC:A7:F1:29:9D:1D", "24:AC:AC:02:84:96")) is None
    assert link_rssi._MODE is None, "both modes failing must clear the cached mode for a fresh re-probe"


def test_pull_session_main_parses_argv_and_drives_pull(monkeypatch):
    seen = {}
    async def fake_pull(*a, **k):
        seen["args"] = a
        return []
    monkeypatch.setattr(pull_session, "pull", fake_pull)
    import sys as _sys
    monkeypatch.setattr(_sys, "argv",
                        ["pull_session.py", "--address", "AA:BB", "--out", "/tmp/x", "--which", "all"])
    pull_session.main()
    assert seen["args"][0] == "AA:BB" and seen["args"][2] == "all"    # address, ..., which

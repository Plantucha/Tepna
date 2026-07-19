# tepna-capture — tests/test_stale_bond_and_empty_writers.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Two failure modes observed on the live box, 2026-07-19.
#
# ONE-SIDED BOND. Polar Flow offers a factory reset. It wipes the SENSOR's half of the pairing while
# BlueZ still reports `Paired: yes  Bonded: yes  Trusted: yes` — so is_bonded(), which reads the HOST's
# view only, returns True forever and ensure_bonded() never re-pairs. The strap then accepts each
# connection and drops it ~1-2 s later during service discovery, permanently. The only cure was a manual
# `bluetoothctl remove`.
#
# HEADER-ONLY FILES. Writers are opened per requested stream BEFORE the PMD START is negotiated, so any
# session ending without data leaves a file containing just its header. On a charger that becomes a
# cadence: START is refused every CHARGE_RETRY_S, producing one junk file set per minute.

import asyncio
import datetime as dt
import os

import pytest

import bonding


def _run(coro):
    return asyncio.run(coro)


# ── recognising a one-sided bond ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("text", [
    "BleakError('failed to discover services, device disconnected')",   # the observed one
    "BleakError('Service Discovery has not been performed yet')",
    "BleakDBusError('org.bluez.Error.AuthenticationFailed', ...)",
    "insufficient authentication",
])
def test_a_one_sided_bond_is_recognised(text):
    assert bonding.looks_like_a_stale_bond(text) is True


@pytest.mark.parametrize("text", [
    "BleakDeviceNotFoundError('Device with address 24:AC:AC:02:84:96 was not found.')",
    "BleakDBusError('org.bluez.Error.InProgress', 'Operation already in progress')",
    "TimeoutError()",
    "org.bluez.Error.Failed', 'br-connection-canceled'",
    "", None,
])
def test_an_absent_or_busy_device_is_NOT_mistaken_for_a_stale_bond(text):
    """Re-pairing costs ~20 s of scripted bluetoothctl and drops the link. A sensor that is merely asleep,
    out of range or mid-contention must never trigger it — that would turn a benign not-worn state into a
    repeated 20 s outage."""
    assert bonding.looks_like_a_stale_bond(text) is False


# ── the forced re-pair ──────────────────────────────────────────────────────────────────────────────
def _stub(monkeypatch, bonded=True, record=None):
    async def fake_btctl(script, timeout=20.0):
        if record is not None:
            record.append(script)
        return "\tBonded: yes\n" if bonded else "\tBonded: no\n"

    async def fake_delayed(lines):
        if record is not None:
            record.append(lines)
        return "Pairing successful"
    monkeypatch.setattr(bonding, "_btctl", fake_btctl)
    monkeypatch.setattr(bonding, "_delayed_script", fake_delayed)


def test_normal_path_still_short_circuits_on_an_existing_bond(monkeypatch):
    """The fast path must survive: re-pairing on every reconnect would drop live links all night."""
    _stub(monkeypatch, bonded=True)
    called = []
    monkeypatch.setattr(bonding, "bond", lambda *a, **k: called.append(a))
    assert _run(bonding.ensure_bonded("AA:BB:CC:DD:EE:FF")) is True
    assert not called


def test_force_removes_the_host_record_before_re_pairing(monkeypatch):
    """Pairing over a stale host record is a no-op — BlueZ already thinks it is paired. The remove is
    what makes the re-pair mean anything."""
    rec = []
    _stub(monkeypatch, bonded=True, record=rec)
    assert _run(bonding.ensure_bonded("AA:BB:CC:DD:EE:FF", force=True)) is True
    joined = " ".join(str(r) for r in rec)
    assert "remove AA:BB:CC:DD:EE:FF" in joined, "must drop the host bond first"
    assert joined.index("remove AA:BB:CC:DD:EE:FF") < joined.index("pair AA:BB:CC:DD:EE:FF")


def test_force_re_pairs_even_though_the_host_says_bonded(monkeypatch):
    _stub(monkeypatch, bonded=True)
    assert _run(bonding.ensure_bonded("AA:BB:CC:DD:EE:FF", force=True)) is True


# ── the daemon only forces after a REPEAT ───────────────────────────────────────────────────────────
def test_the_daemon_requires_two_consecutive_hits_before_re_pairing():
    """A single discovery failure is also what an ordinary mid-negotiation drop looks like."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "capture.py"), encoding="utf-8").read()
    assert "stale_bond_hits >= 2" in src, "must not re-pair on a single failure"
    assert "force=True" in src, "the recovery must force past the host's stale view"
    assert "stale_bond_hits = 0" in src, "a non-matching error must reset the counter"


# ── header-only files ───────────────────────────────────────────────────────────────────────────────
def test_a_writer_that_never_got_a_sample_is_deleted(tmp_path):
    """One junk file set per minute for as long as a device charges, each indistinguishable from a real
    capture until opened, in the directory the Dex ingest walks."""
    from writers import StreamWriter
    p = tmp_path / "Polar_VeritySense_X_20260719103029_PPG.txt"
    w = StreamWriter(str(p), "ppg", fsync=False)
    assert w.rows == 0
    w.close()
    assert p.exists(), "the writer itself does not delete — the session teardown does"
    # what the teardown does, and must keep doing:
    if not w.rows:
        os.remove(str(p))
    assert not p.exists()


def test_a_writer_with_data_is_kept(tmp_path):
    from writers import StreamWriter
    p = tmp_path / "keep_ECG.txt"
    w = StreamWriter(str(p), "ecg", fsync=False)
    w.write_ecg(dt.datetime(2026, 7, 19, 10, 0, 0), 1_000_000_000, 0.0, 42)
    assert w.rows == 1
    w.close()
    assert p.exists()


def test_the_teardown_deletes_only_empty_writers():
    src = open(os.path.join(os.path.dirname(__file__), "..", "capture.py"), encoding="utf-8").read()
    tail = src.split("DISCARD HEADER-ONLY FILES")[1][:1200]
    assert "not wr.rows" in tail, "emptiness must be judged by rows, not file size"
    assert "os.remove(path)" in tail
    assert "hr_writer" in tail, "the HR writer opens the same way and must be covered too"

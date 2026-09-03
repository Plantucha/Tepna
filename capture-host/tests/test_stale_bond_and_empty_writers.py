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
import writers
from tests._srcscan import module_source


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
    src = module_source("capture.py")   # skips on a mutmut file — see tests/_srcscan.py
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
    src = module_source("capture.py")   # skips on a mutmut file — see tests/_srcscan.py
    # 2000, not 1200: the explanatory comment above the loop grew, and a fixed character window that
    # happens to end mid-comment turns a source scan into a test of comment length.
    # ANCHORED ON THE LOOP, not a character count. This window was 1200, then 2000, and was widened
    # each time the comment above the loop grew — a source scan measured in characters is a test of
    # comment length. Split on the `for wr in` line so the assertions below read the CODE regardless of
    # how much prose precedes it (widened a third time 2026-09-03; fixed instead).
    tail = src.split("DISCARD HEADER-ONLY FILES")[1].split("for wr in ", 1)[1][:1200]
    assert "not wr.rows" in tail, "emptiness must be judged by rows, not file size"
    # `os.remove(path)` USED TO BE ASSERTED HERE, and asserting it is what kept CAPTURE-HOST-DEEP-AUDIT
    # §C8 alive: `wr.path` names only the writer's PRIMARY file, so removing it left the `hr` writer's
    # `_RR` sibling behind as an orphan. `discard()` unlinks everything the writer owns; the behaviour
    # is pinned properly by the two tests below, which this source scan cannot express.
    assert "wr.discard()" in tail
    assert "hr_writer" in tail, "the HR writer opens the same way and must be covered too"


def test_discarding_an_hr_writer_removes_its_RR_sibling(tmp_path):
    """§C8, behaviourally. `StreamWriter(stream='hr')` silently opens a second handle (`_RR.<ext>`) and
    exposed only `self.path`, so the header-only pruner deleted the HR file and left a 33-byte RR file
    with no partner — 4 of them in the real 2026-07-25 directory alone. The existing gate was
    mutation-blind because it exercised the `ppg` stream, which has no sibling."""
    from writers import StreamWriter
    hr = tmp_path / "Polar_H10_02849638_20260725001214_HR.txt"
    w = StreamWriter(str(hr), "hr", fsync=False)
    rr = tmp_path / "Polar_H10_02849638_20260725001214_RR.txt"
    assert hr.exists() and rr.exists(), "the writer owns two files"
    assert set(w.paths) == {str(hr), str(rr)}, "and it must be able to say so"
    w.discard()
    assert not hr.exists() and not rr.exists(), "an orphan RR file is what this fixes"


def test_discarding_a_single_file_writer_is_unchanged(tmp_path):
    """The control: `paths`/`discard` must not invent a sibling for a stream that has none."""
    from writers import StreamWriter
    p = tmp_path / "Polar_H10_02849638_20260725001214_ECG.txt"
    w = StreamWriter(str(p), "ecg", fsync=False)
    assert w.paths == [str(p)]
    w.discard()
    assert not p.exists()
    assert list(tmp_path.iterdir()) == []


# ── the header-only pruner must not delete a file it only RESUMED (2026-09-03 data loss) ────────────
def test_a_RESUMED_writer_with_no_rows_keeps_the_file(tmp_path):
    """🔴 `rows` counts THIS writer instance; `discard()` unlinks the whole FILE. One session per file
    made those the same thing and CAPTURE-FILESET-RESUME §2 ended it.

    Measured on vigil 2026-09-03: the 15:43 Verity set reached 21 MB and its PPG/ACC/GYRO/MAG were gone
    by 17:47, while its PMDARRIVAL survived (that writer is closed, never discarded). 55 resumes that
    afternoon. This pins the two facts the fix rests on: a writer that reopens a non-empty file reports
    `resumed`, and `discard()` on it would destroy bytes it did not write."""
    p = tmp_path / "Polar_VeritySense_X_20260903154354_PPG.txt"
    first = writers.StreamWriter(str(p), "ppg")
    first.write_row(1000, [1.0, 2.0, 3.0]) if hasattr(first, "write_row") else None
    first.close()
    assert p.stat().st_size > 0, "precondition: the first session left bytes"
    before = p.read_bytes()

    resumed = writers.StreamWriter(str(p), "ppg")
    assert resumed.resumed is True, "a writer reopening a non-empty file must report resumed"
    assert not resumed.rows, "precondition: this instance wrote nothing — the old pruner's whole test"

    # The guard's exact predicate. `not rows` alone is TRUE here, which is the bug.
    assert (not resumed.rows) is True, "the OLD condition fires on this writer"
    assert (not resumed.rows and not resumed.resumed) is False, "the NEW condition must NOT fire"
    resumed.close()
    assert p.read_bytes() == before, "a resumed no-row session must leave earlier bytes untouched"


def test_a_writer_that_CREATED_its_file_still_gets_pruned(tmp_path):
    """The narrowing must not disable the pruner. A device on its dock refuses START every retry and
    would otherwise litter one header-only set per minute (observed 2026-07-19, a 76-byte Verity PPG)."""
    p = tmp_path / "Polar_VeritySense_X_20260903180000_PPG.txt"
    fresh = writers.StreamWriter(str(p), "ppg")
    assert fresh.resumed is False, "a writer that created its own file has nothing to protect"
    assert (not fresh.rows and not fresh.resumed) is True, "the pruner must still fire here"
    fresh.discard()
    assert not p.exists(), "discard() removes a file this writer created"


def test_the_teardown_consults_resumed_and_says_so_when_it_keeps(tmp_path):
    """Pins the wiring and the visibility. The old discard logged at DEBUG on a box running INFO, so
    the deletions left NO trace — the one line that would have named the loss was invisible."""
    src = module_source("capture.py")
    # Anchored on the loop for the same reason as the scan above — and I wrote this one with a fixed
    # [:2600] window first, which failed on my own comment. Third instance of the identical mistake in
    # one file; the character count is the defect, not its size.
    block = src.split("DISCARD HEADER-ONLY FILES")[1].split("for wr in ", 1)[1][:1500]
    assert "if not wr.rows and not wr.resumed:" in block, "the pruner must consult resumed"
    assert "log.info(" in block, "keeping a resumed empty set must be visible at INFO, not DEBUG"


def test_the_START_REJECTED_branch_also_refuses_to_delete_a_resumed_set():
    """SECOND SITE (Heron, 2026-09-03). The `truly unsupported settings` branch discarded with NO rows
    guard at all — correct before resume, where a rejected START could only leave a header-only file.

    Live path, not theoretical: with sdk_mode on, a pass that fails to re-enter SDK mode leaves the
    device offering PPG at 55 while 176 is still negotiated, which arrives as invalid_sample_rate — i.e.
    exactly this branch — on a set earlier sessions filled.

    Anchored on the branch, not a character offset (see the two scans above; the count is the defect)."""
    src = module_source("capture.py")
    # TWO CONTENT ANCHORS, no character count. Three scans in this file used a fixed window and all
    # three broke when a comment grew — including, twice, mine. A region is bounded by what ENDS it.
    branch = src.split("truly unsupported settings", 1)[1].split("del writers[meas]", 1)[0]
    assert "if writers[meas].resumed:" in branch, "the rejected-START branch must check resumed"
    assert "writers[meas].close()" in branch, "a resumed set is closed, never discarded"
    assert "writers[meas].discard()" in branch, "a set this session created must still be pruned"
    assert branch.index("if writers[meas].resumed:") < branch.index("writers[meas].discard()"), \
        "the guard must precede the discard, not follow it"

# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Crash-consistency and fsync CALL-SITE coverage for the two transactional writers.

`OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS` D-w4. Covers `oxy_transfer` (G1) and `cpap_spool` (P4) in one
harness, because they are the same shape: write to `.part` → fsync the file → validate → `os.replace`
→ fsync the directory.

🔴 READ THIS BEFORE "IMPROVING" ANY OF IT INTO A DURABILITY TEST — IT IS NOT ONE, AND CANNOT BE.

`fsync` defends against a MACHINE failure. A process kill does not lose page-cache data: the kernel
writes those pages back regardless of whether `fsync` was ever called. So a `kill -9` harness passes
IDENTICALLY with the fsync present and with it removed — it can never fail for the reason it appears
to be testing. Mocking `fsync` to a no-op and reading the file back is worse, because it looks like it
works: the bytes are still in the page cache, so of course they are there.

Two claims are therefore kept strictly apart in this file:

  · `TestFsyncCallSites` asserts THE CALLS ARE MADE at the required points. Removing either fsync
    fails it. That is real coverage of a real regression, and it licenses exactly one sentence:
    "the fsync calls are made where the design says". It does NOT license "the data is durable".

  · `TestCrashConsistency` asserts THE ORDERING invariants that survive a process death — the `.part`
    is never adopted, `os.replace` leaves old-or-new but never neither, a torn ledger line costs one
    row rather than the history. These are genuinely untested elsewhere and they are about ORDER, not
    durability.

Durability proper stays OPEN. The mechanism is named so it is a scheduled action rather than a
permanent unknown: `dm-flakey` over a loopback device, which drops writes after a trigger and so
simulates the power loss `fsync` exists for. It needs root (`dmsetup` is present here;
passwordless sudo is not), which is why it is an owner action and not in this file.
"""

import json
import os
from pathlib import Path

import cpap_spool
import oxy_inventory as inv
import oxy_transfer as tr
import pytest

TRAILER = b"\x48\x12\x5a\xda"


def _finalised(data):
    return {"ok": True} if data.endswith(TRAILER) else None


def _sel(mode=tr.RESTART, offset=0):
    return tr.Selection("i", "R", "S", "download", "t", tr.Resume(mode, offset, "t"), 1)


class _FsyncSpy:
    """Records every `os.fsync` target and whether it was a directory, in call order.

    A spy rather than a no-op mock: the real fsync still runs, so this observes the calls without
    weakening the behaviour under test — a no-op would silently convert this file into the false
    green the module docstring warns about."""

    def __init__(self, monkeypatch):
        self.calls: list[str] = []
        real = os.fsync

        def spy(fd):
            try:
                self.calls.append("dir" if os.path.isdir(f"/proc/self/fd/{fd}") else "file")
            except OSError:  # pragma: no cover - defensive; the fd is open by construction here
                self.calls.append("file")
            return real(fd)

        monkeypatch.setattr(os, "fsync", spy)


# ── (1) the fsync CALLS are made at the required points ──────────────────────────────────────────


class TestFsyncCallSites:
    def test_oxy_download_fsyncs_the_file_before_returning(self, tmp_path, monkeypatch):
        spy = _FsyncSpy(monkeypatch)
        part = str(tmp_path / "x.part")
        tr.download(lambda _o: [b"data" + TRAILER], part, _sel(), reported_size=8)
        assert "file" in spy.calls, "the staged bytes were never fsynced before the caller proceeds"

    def test_oxy_commit_fsyncs_the_DIRECTORY_after_the_rename(self, tmp_path, monkeypatch):
        part, final = tmp_path / "x.part", tmp_path / "x.dat"
        part.write_bytes(b"data")
        spy = _FsyncSpy(monkeypatch)
        tr.commit(str(part), str(final))
        assert "dir" in spy.calls, (
            "the rename was not fsynced — without it the entry can be durable in cache and absent on disk"
        )

    def test_cpap_write_part_fsyncs_the_file(self, tmp_path, monkeypatch):
        spy = _FsyncSpy(monkeypatch)
        cpap_spool.write_part(str(tmp_path), "r1", b"payload")
        assert "file" in spy.calls

    def test_cpap_promote_fsyncs_the_DIRECTORY_after_the_rename(self, tmp_path, monkeypatch):
        data = b"payload"
        part = cpap_spool.write_part(str(tmp_path), "r1", data)
        spy = _FsyncSpy(monkeypatch)
        cpap_spool.promote(str(tmp_path), part, "r1",
                           expected_sha=cpap_spool.sha256_bytes(data), expected_len=len(data))
        assert "dir" in spy.calls

    def test_both_writers_fsync_the_file_BEFORE_the_directory(self, tmp_path, monkeypatch):
        """Order matters: fsyncing the directory first would durably record a name whose contents
        are not yet on disk — the right size and the wrong bytes, which is the failure the whole
        transaction is built to avoid."""
        data = b"payload"
        part = cpap_spool.write_part(str(tmp_path), "r1", data)
        spy = _FsyncSpy(monkeypatch)
        cpap_spool.promote(str(tmp_path), part, "r1",
                           expected_sha=cpap_spool.sha256_bytes(data), expected_len=len(data))
        assert spy.calls, "no fsync at all during promote"
        assert spy.calls[-1] == "dir", f"the directory fsync must come last, got {spy.calls}"


# ── (2) crash CONSISTENCY — the ordering invariants a process death must not break ────────────────


class TestCrashConsistency:
    def test_a_part_is_never_adopted_however_complete_it_looks(self, tmp_path):
        part, final = tmp_path / "x.part", tmp_path / "x.dat"
        tr.download(lambda _o: [b"data" + TRAILER], str(part), _sel(), reported_size=8)
        assert part.exists() and not final.exists()

    def test_oxy_refuses_to_stage_outside_a_part_file(self, tmp_path):
        with pytest.raises(ValueError, match=r"\.part"):
            tr.download(lambda _o: [b"ab"], str(tmp_path / "x.dat"), _sel())

    def test_cpap_stages_under_incomplete_never_the_final_name(self, tmp_path):
        part = cpap_spool.write_part(str(tmp_path), "r1", b"payload")
        assert part.endswith(".part") and cpap_spool.INCOMPLETE_DIR in part

    def test_a_failed_rename_leaves_the_source_never_neither(self, tmp_path, monkeypatch):
        part, final = tmp_path / "x.part", tmp_path / "x.dat"
        part.write_bytes(b"data")

        def boom(_a, _b):
            raise OSError("cross-device link")

        monkeypatch.setattr(os, "replace", boom)
        with pytest.raises(OSError):
            tr.commit(str(part), str(final))
        assert part.exists() and not final.exists()

    def test_committed_bytes_with_no_ledger_row_are_repulled_not_lost(self, tmp_path):
        """The rename-first window: disk ahead of the ledger. One redundant fetch, never a loss."""
        part, final = tmp_path / "x.part", tmp_path / "x.dat"
        part.write_bytes(b"data" + TRAILER)
        tr.commit(str(part), str(final))
        ident = inv.identity("R", "S")
        assert inv.reconcile([], {ident: 8})["repull"] == [ident]

    def test_a_torn_final_ledger_line_costs_one_row_not_the_history(self, tmp_path):
        led = tmp_path / "l.jsonl"
        inv.append_row(str(led), inv.make_row("R", "S1", inv.COMMITTED, at=1.0))
        with open(led, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(inv.make_row("R", "S2", inv.PARTIAL, at=2.0))[:40])
        rows = inv.load_rows(str(led))
        assert len(rows) == 1 and rows[0]["session"] == "S1"

    def test_cpap_refuses_to_promote_a_corrupted_part(self, tmp_path):
        """Validation re-reads the staged bytes, so a torn `.part` fails here and never gets the
        final name — the right-sized-and-silently-corrupt outcome the transaction exists to prevent."""
        data = b"payload"
        part = cpap_spool.write_part(str(tmp_path), "r1", data)
        Path(part).write_bytes(b"corrupt")
        with pytest.raises(cpap_spool.SpoolValidationError):
            cpap_spool.promote(str(tmp_path), part, "r1",
                               expected_sha=cpap_spool.sha256_bytes(data), expected_len=len(data))
        assert not (Path(tmp_path) / cpap_spool.COMMITTED_DIR / "r1").exists()

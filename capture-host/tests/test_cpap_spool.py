# tepna-capture — tests/test_cpap_spool.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# P4's planted controls (brief §5, C1–C5) plus the unit surface. Every control is a chaos injection
# with a PRE-STATED pass; the crash-window controls drive the module's own internals to the exact
# boundary and then abandon, exactly as a kill would.

import asyncio
import json
import os

import pytest

import cpap_spool as sp
from cpap_acq import FailureClass


class FakeAs11Error(RuntimeError):
    """Name-matched stand-in for as11_pull.As11Error (the module classifies by type name so it
    needs no import of the protocol module — same decoupling as the injected transport)."""


FakeAs11Error.__name__ = "As11Error"

T0 = "2026-01-01T00:00:00Z"
T1 = "2026-08-14T16:00:00Z"
T2 = "2026-08-20T09:30:00Z"


def scripted(rounds):
    """pull_round fake driven by a list of (bytes|Exception, more, next_from). Counts calls."""
    calls = []

    async def pull(spool_type, from_dt):
        calls.append((spool_type, from_dt))
        body, more, nxt = rounds[len(calls) - 1]
        if isinstance(body, Exception):
            raise body
        return body, more, nxt

    pull.calls = calls
    return pull


def run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


def committed_files(root):
    d = os.path.join(root, sp.COMMITTED_DIR)
    return sorted(os.listdir(d)) if os.path.isdir(d) else []


def sync(root, pull, **kw):
    kw.setdefault("device", "AS11-1")
    kw.setdefault("session", "acq-1")
    kw.setdefault("epoch_start", T0)
    kw.setdefault("wall", lambda: "2026-08-23T22:00:00+00:00")
    kw.setdefault("mono", lambda: 123.0)
    return run(sp.sync_spool(pull, root, **kw))


# ── the happy chain ───────────────────────────────────────────────────────────

def test_two_rounds_commit_and_the_cursor_walks_the_chain(tmp_path):
    root = str(tmp_path)
    pull = scripted([(b"round-one", True, T1), (b"round-two", False, None)])
    s = sync(root, pull)
    assert s["rounds_committed"] == 2 and s["stopped"] == "no-more-data"
    rows = sp.read_ledger(root)
    assert [r["round"]["from"] for r in rows] == [T0, T1]
    # committed_cursor is the fromDateTime to pull NEXT — never the round's own input
    assert rows[0]["committed_cursor"] == T1
    # a NO_MORE round re-arms its OWN cursor for the next sync
    assert rows[1]["committed_cursor"] == T1
    assert pull.calls == [("Summary", T0), ("Summary", T1)]
    assert len(committed_files(root)) == 2


def test_restart_resumes_from_the_last_committed_cursor_not_epoch(tmp_path):
    root = str(tmp_path)
    sync(root, scripted([(b"a", True, T1)]), max_rounds=1)
    pull2 = scripted([(b"b", False, None)])
    s = sync(root, pull2)
    assert pull2.calls[0] == ("Summary", T1)
    assert s["stopped"] == "no-more-data"


def test_cursors_are_verbatim_device_stamps_z_included(tmp_path):
    root = str(tmp_path)
    sync(root, scripted([(b"x", False, None)]), max_rounds=1)
    row = sp.read_ledger(root)[0]
    assert row["round"]["from"] == T0 and row["round"]["from"].endswith("Z")
    assert row["spool_type"] == "Summary"          # stream identity in every row (contract §3a)
    assert row["file"] in committed_files(root)    # row ⇒ named file exists


def test_max_rounds_bounds_the_pass(tmp_path):
    root = str(tmp_path)
    pull = scripted([(b"a", True, T1), (b"b", True, T2), (b"c", True, "2026-08-21T00:00:00Z")])
    s = sync(root, pull, max_rounds=3)
    assert s["stopped"] == "max-rounds" and s["rounds_committed"] == 3


# ── C1 · kill mid-round: the .part stays, no line, re-pull promotes clean ─────

def test_C1_kill_mid_round_leaves_part_and_repull_promotes_byte_identical(tmp_path):
    root = str(tmp_path)
    body = b"interrupted-round"
    sha = sp.sha256_bytes(body)
    name = sp.round_filename(T0, sha)
    sp.write_part(root, name, body)          # staged…
    # …and the process dies here: no promote, no ledger line.
    assert sp.read_ledger(root) == [] and committed_files(root) == []
    assert os.path.exists(os.path.join(root, sp.INCOMPLETE_DIR, name + ".part"))
    # next run: the device re-serves the SAME cursor byte-identically (the hardware pin)
    s = sync(root, scripted([(body, False, None)]))
    assert s["rounds_committed"] == 1
    assert committed_files(root) == [name]
    assert len(sp.read_ledger(root)) == 1


# ── C2 · a corrupted round never promotes ─────────────────────────────────────

def test_C2_corrupted_part_fails_validation_and_does_not_promote(tmp_path):
    root = str(tmp_path)
    body = b"good-bytes"
    sha = sp.sha256_bytes(body)
    name = sp.round_filename(T0, sha)
    part = sp.write_part(root, name, body)
    with open(part, "r+b") as fh:            # one flipped byte between stage and promote
        fh.seek(0)
        fh.write(b"X")
    with pytest.raises(sp.SpoolValidationError):
        sp.promote(root, part, name, expected_sha=sha, expected_len=len(body))
    assert committed_files(root) == [] and sp.read_ledger(root) == []


def test_C2_length_mismatch_also_refuses(tmp_path):
    root = str(tmp_path)
    body = b"good-bytes"
    sha = sp.sha256_bytes(body)
    name = sp.round_filename(T0, sha)
    part = sp.write_part(root, name, body)
    with pytest.raises(sp.SpoolValidationError):
        sp.promote(root, part, name, expected_sha=sha, expected_len=len(body) + 1)
    assert committed_files(root) == []


# ── C3 · crash between promote and ledger append: idempotent, no duplicate ────

def test_C3_crash_between_promote_and_ledger_is_idempotent_on_repull(tmp_path):
    root = str(tmp_path)
    body = b"round-bytes"
    sha = sp.sha256_bytes(body)
    name = sp.round_filename(T0, sha)
    part = sp.write_part(root, name, body)
    sp.promote(root, part, name, expected_sha=sha, expected_len=len(body))
    # …crash HERE: promoted file exists, ledger never advanced.
    assert committed_files(root) == [name] and sp.read_ledger(root) == []
    s = sync(root, scripted([(body, False, None)]))
    assert s["rounds_committed"] == 1
    assert committed_files(root) == [name]           # same content-addressed name — adopted, no dup
    assert len(sp.read_ledger(root)) == 1            # the missing line, appended exactly once


# ── C4 · committed content is never overwritten ───────────────────────────────

def test_C4_same_name_different_bytes_refuses_never_overwrites(tmp_path):
    root = str(tmp_path)
    body = b"committed"
    sha = sp.sha256_bytes(body)
    name = sp.round_filename(T0, sha)
    part = sp.write_part(root, name, body)
    final = sp.promote(root, part, name, expected_sha=sha, expected_len=len(body))
    part2 = sp.write_part(root, name, b"different")  # an attacker/partial wearing the same name
    with pytest.raises(sp.SpoolConflictError):
        sp.promote(root, part2, name, expected_sha=sp.sha256_bytes(b"different"),
                   expected_len=len(b"different"))
    with open(final, "rb") as fh:
        assert fh.read() == body                      # the evidence survived


def test_C4_by_construction_partials_never_reach_committed(tmp_path):
    root = str(tmp_path)
    sp.write_part(root, "x.bin", b"partial")
    assert committed_files(root) == []               # .part lives only under incomplete/


# ── C5 · the device's error terminal stops, it does not loop ──────────────────

def test_C5_data_unavailable_is_nonrecoverable_and_called_exactly_once(tmp_path):
    root = str(tmp_path)
    pull = scripted([(FakeAs11Error("spool Summary: data unavailable"), None, None)])
    states = []
    s = sync(root, pull, on_transition=lambda st, why: states.append(st))
    assert s["stopped"] == "data-unavailable"
    assert s["failure"] == FailureClass.PROTOCOL_FAILURE.label
    assert len(pull.calls) == 1                      # no retry loop
    assert states[-1] == "ERROR"
    assert sp.read_ledger(root) == [] and committed_files(root) == []


# ── transport loss is recoverable and preserves the committed prefix ──────────

def test_transport_loss_midsync_keeps_committed_rounds_and_recoverable_class(tmp_path):
    root = str(tmp_path)
    pull = scripted([(b"first", True, T1), (TimeoutError("link lost"), None, None)])
    states = []
    s = sync(root, pull, on_transition=lambda st, why: states.append(st))
    assert s["rounds_committed"] == 1
    assert s["stopped"] == "transport"
    assert s["failure"] == FailureClass.TRANSPORT_FAILURE.label
    assert states[-1] == "RECOVERING"
    assert sp.last_committed_cursor(root) == T1      # next pass resumes exactly here


# ── steady-state re-poll: no growth, clean stop ───────────────────────────────

def test_repolling_a_no_more_cursor_is_a_noop_not_a_leak(tmp_path):
    root = str(tmp_path)
    body = b"tail-round"
    sync(root, scripted([(body, False, None)]))
    s2 = sync(root, scripted([(body, False, None)]))
    assert s2["stopped"] == "no-new-data" and s2["rounds_committed"] == 0
    assert len(committed_files(root)) == 1
    assert len(sp.read_ledger(root)) == 1            # deduped by (cursor, sha)


def test_new_data_at_the_same_cursor_commits_as_a_new_round(tmp_path):
    root = str(tmp_path)
    sync(root, scripted([(b"old-tail", False, None)]))
    s2 = sync(root, scripted([(b"old-tail-plus-new", False, None)]))
    assert s2["rounds_committed"] == 1
    assert len(committed_files(root)) == 2           # different sha → different name, both kept
    rows = sp.read_ledger(root)
    assert [r["round_seq"] for r in rows] == [0, 1]  # seq continues across passes


# ── the between-rounds guard seam (brief §6) ─────────────────────────────────

def test_revalidate_hook_sees_every_cursor_the_loop_trusts(tmp_path):
    root = str(tmp_path)
    seen = []
    sync(root, scripted([(b"a", True, T1), (b"b", False, None)]),
         revalidate=seen.append)
    assert seen == [T0, T1]                          # the localized guard point, exercised


# ── ledger mechanics ─────────────────────────────────────────────────────────

def test_ledger_lines_are_byte_stable_for_identical_rows(tmp_path):
    kw = dict(device="d", session="s", spool_type="Summary", cursor_in=T0,
              committed_cursor=T1, round_seq=0, data=b"x", status=sp.STATUS_MORE,
              filename="f.bin", wall=lambda: "W", mono=lambda: 1.0)
    a = json.dumps(sp.make_row(**kw), sort_keys=True)
    b = json.dumps(sp.make_row(**kw), sort_keys=True)
    assert a == b


def test_torn_ledger_tail_is_skipped_not_fatal(tmp_path):
    root = str(tmp_path)
    sync(root, scripted([(b"a", True, T1)]), max_rounds=1)
    with open(sp.ledger_path(root), "a", encoding="utf-8") as fh:
        fh.write('{"torn": ')                        # crash mid-append
    assert sp.last_committed_cursor(root) == T1
    with open(sp.ledger_path(root), "a", encoding="utf-8") as fh:
        fh.write("\n\n")                             # blank lines tolerated too
    assert sp.last_committed_cursor(root) == T1


def test_empty_store_reports_no_cursor_and_no_rows(tmp_path):
    root = str(tmp_path)
    assert sp.read_ledger(root) == []
    assert sp.last_committed_cursor(root) is None


# ── names and cursors ────────────────────────────────────────────────────────

def test_round_filename_is_content_addressed_and_fs_safe():
    a = sp.round_filename(T1, "a" * 64)
    b = sp.round_filename(T1, "b" * 64)
    assert a != b and a.startswith("20260814T160000Z-")
    assert ":" not in a and "/" not in a


def test_compact_cursor_strips_only_separators():
    assert sp.compact_cursor(T1) == "20260814T160000Z"


def test_default_clocks_produce_wall_iso_and_monotonic(tmp_path):
    row = sp.make_row(device="d", session="s", spool_type="Summary", cursor_in=T0,
                      committed_cursor=T1, round_seq=0, data=b"x",
                      status=sp.STATUS_DONE, filename="f.bin")
    assert "T" in row["ts"] and isinstance(row["mono"], float)


# ── branch closure: every callback and adopt arm, both ways ──────────────────

def test_adopt_with_no_part_file_still_returns_committed(tmp_path):
    root = str(tmp_path)
    body = b"already-there"
    sha = sp.sha256_bytes(body)
    name = sp.round_filename(T0, sha)
    part = sp.write_part(root, name, body)
    final = sp.promote(root, part, name, expected_sha=sha, expected_len=len(body))
    ghost = os.path.join(root, sp.INCOMPLETE_DIR, "ghost.part")  # never created
    assert sp.promote(root, ghost, name, expected_sha=sha, expected_len=len(body)) == final


def test_C5_without_a_lifecycle_callback_still_stops_cleanly(tmp_path):
    root = str(tmp_path)
    pull = scripted([(FakeAs11Error("nope"), None, None)])
    s = sync(root, pull)
    assert s["stopped"] == "data-unavailable" and len(pull.calls) == 1


def test_transport_loss_without_a_callback_still_classifies(tmp_path):
    root = str(tmp_path)
    s = sync(root, scripted([(OSError("gone"), None, None)]))
    assert s["stopped"] == "transport"
    assert s["failure"] == FailureClass.TRANSPORT_FAILURE.label


def test_happy_path_with_lifecycle_reports_syncing_then_verified(tmp_path):
    root = str(tmp_path)
    states = []
    s = sync(root, scripted([(b"only", False, None)]),
             on_transition=lambda st, why: states.append(st))
    assert s["stopped"] == "no-more-data"
    assert states == ["SYNCING", "VERIFIED"]

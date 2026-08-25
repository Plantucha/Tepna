# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""G1 — the download as a transaction. `OXYII-G1-TRANSACTIONAL-SYNC-2026-08-23-BRIEF.md`.

The ten crash points of brief §3 are the test list, and they are the reason the module is five
functions instead of one: each boundary has a DIFFERENT correct recovery, so each gets a control
that pins the invariant which must survive a restart at exactly that point.
"""

import json
import os

import pytest

import oxy_inventory as inv
import oxy_transfer as tr
import oxyii
from cpap_acq import FailureClass

TRAILER_MAGIC = b"\x48\x12\x5a\xda"
# Derived, never spelled out: the separator is `identity()`'s business, and a literal here would be a
# second source of truth that passes while the real one changes underneath it.
IDENT = inv.identity("R", "S")


def _finalised(data):
    """Stand-in for `oxyii.parse_oxy_trailer`: finalised iff the sub-magic is present.

    Injected rather than used live so a verify test does not need a byte-exact 48-byte trailer —
    the CONTRACT being relied on (returns None for unfinalised, never raises) is pinned separately
    by `test_real_trailer_parser_returns_none_rather_than_raising`."""
    return {"ok": True} if data.endswith(TRAILER_MAGIC) else None


def _fmt_a(n_records, total_seconds=None):
    """A byte-real Format-A `.dat`: 10-byte header + n × 3-byte records + a 48-byte trailer carrying the
    finalisation sub-magic and a `total_seconds` field. `total_seconds` defaults to n_records (a
    consistent file); pass a different value to forge the shifted-grid a size+finalised check cannot
    see. Geometry measured against real 95 KB / 81 KB rings (`(size-10-48)/3 == total_seconds`)."""
    ts = n_records if total_seconds is None else total_seconds
    trailer = bytearray(48)
    trailer[4:8] = TRAILER_MAGIC  # sub-magic at [4:8] → oxyii.parse_oxy_trailer finalised
    trailer[12] = ts & 0xFF
    trailer[13] = (ts >> 8) & 0xFF  # total_seconds = t[12] | t[13]<<8
    trailer[42] = 0xFF  # o2_score_x10 = None (short-session convention)
    return bytes(tr._FMT_A_HEADER) + b"\x60\x40\x00" * n_records + bytes(trailer)


GOOD = _fmt_a(20)  # 10 + 60 + 48 = 118 B, total_seconds == 20 records
GOOD_SIZE = len(GOOD)


def _sel(*, mode=tr.RESTART, offset=0, attempt=1):
    return tr.Selection(IDENT, "R", "S", "download", "test", tr.Resume(mode, offset, "test"), attempt)


def _fetch(*chunks, seen=None):
    """`seen` records the offset the transport was actually asked for — the argument is part of the
    contract, and a test that ignores it cannot tell `fetch(0)` from `fetch(1)`."""

    def f(offset):
        assert isinstance(offset, int)
        if seen is not None:
            seen.append(offset)
        return list(chunks)

    return f


# ── the injected-parser contract ──────────────────────────────────────────────────────────────────


def test_real_trailer_parser_returns_none_rather_than_raising():
    """`verify` treats a None return as "not finalised". If the real parser RAISED on garbage
    instead, verify would propagate an exception where it promises a VerifyResult — so this pins the
    property that makes injection safe, using the real function rather than the double."""
    assert oxyii.parse_oxy_trailer(b"") is None
    assert oxyii.parse_oxy_trailer(b"\x00" * 8) is None


# ── resume_strategy — brief §5 ─────────────────────────────────────────────────────────────────────


def test_resume_restarts_when_no_partial_bytes():
    r = tr.resume_strategy(0, 500)
    assert r.mode == tr.RESTART and r.offset == 0
    # The reason is carried, not re-derived — the ledger records the sentence the policy used, so a
    # blank one is a real defect and not cosmetic.
    assert r.reason == "no partial bytes on disk"


def test_resume_boundary_is_zero_bytes_not_one():
    """`<= 0` vs `< 0` and `<= 1` differ only at 0 and 1, and both mutations are invisible to a test
    that checks the mode alone: every branch here returns RESTART by default. The REASON is what
    separates them, which is the second argument for carrying it."""
    assert tr.resume_strategy(0, 500).reason == "no partial bytes on disk"
    # one byte IS partial data — it must take the discarding path, not the nothing-on-disk path
    assert tr.resume_strategy(1, 500).reason != "no partial bytes on disk"
    assert "discarding 1 B" in tr.resume_strategy(1, 500).reason


def test_resume_restarts_when_size_complete_but_unfinalised():
    """The missing part is the TRAILER, which the ring flushes after reporting full size. Resuming
    from the end would append nothing and re-verify the same unfinalised file forever."""
    r = tr.resume_strategy(500, 500, allow_resume=True)
    assert r.mode == tr.RESTART and "trailer" in r.reason


def test_resume_default_is_re_serve_from_start():
    """The AS11 default. Unmeasured drop behaviour + an asymmetric cost = re-serve."""
    r = tr.resume_strategy(200, 500)
    assert r.mode == tr.RESTART and r.offset == 0 and "unmeasured" in r.reason


def test_resume_resumes_only_when_explicitly_allowed():
    r = tr.resume_strategy(200, 500, allow_resume=True)
    assert r.mode == tr.RESUME and r.offset == 200
    assert r.reason == "resuming at 200 B of 500 B"


# ── list_sessions — brief §2 ───────────────────────────────────────────────────────────────────────


def test_list_sessions_tolerates_an_empty_device():
    assert tr.list_sessions(lambda: None) == []


def test_list_sessions_drops_entries_with_no_formable_identity():
    """An identity we cannot form is one we could never reconcile against the ledger. Inventing one
    would put a fabricated key in an append-only file."""
    got = tr.list_sessions(
        lambda: [
            {"device_id": "R", "session": "S", "reported_size": 10},
            {"device_id": "", "session": "S"},
            {"device_id": "R"},
            # ⚠️ A GOOD ENTRY AFTER THE BAD ONES, deliberately: with the bad entries last, `continue`
            # and `break` produce identical output and the skip logic is untested. Ordering is the
            # whole test.
            {"device_id": "R2", "session": "S2", "reported_size": 20},
        ]
    )
    assert got == [
        {"device_id": "R", "session": "S", "reported_size": 10},
        {"device_id": "R2", "session": "S2", "reported_size": 20},
    ]


# ── select — PURE, brief §2/§15 ────────────────────────────────────────────────────────────────────


def _listing(size=500):
    return [{"device_id": "R", "session": "S", "reported_size": size}]


def test_select_downloads_what_the_ledger_has_never_seen():
    got = tr.select(_listing(), [])
    assert len(got) == 1 and got[0].action == "download" and got[0].attempt == 1
    # The Selection must CARRY a decision, not a hole: a None resume reaches download() as "start
    # from 0" by accident rather than by policy, and reads identically at the call site.
    assert got[0].resume is not None
    assert got[0].resume.mode == tr.RESTART and got[0].resume.offset == 0
    # A new recording has NO partial bytes — that specific reason, not the discarding one.
    assert got[0].resume.reason == "no partial bytes on disk"


def test_select_keeps_going_after_a_skip():
    """⚠️ The skipped entry comes FIRST. With it last, `continue` and `break` produce identical
    output and every skip branch in the loop is untested — the same ordering blindness as
    list_sessions. Three skip reasons are exercised ahead of a live download."""
    listing = [
        {"device_id": "R", "session": "DONE", "reported_size": 8},
        {"device_id": "R", "session": "PERM", "reported_size": 8},
        {"device_id": "R", "session": "SPENT", "reported_size": 8},
        {"device_id": "R", "session": "FRESH", "reported_size": 8},
    ]
    rows = [
        inv.make_row("R", "DONE", inv.COMMITTED, at=1.0),
        inv.make_row("R", "PERM", inv.FAILED, attempt=1, failure=FailureClass.VALIDATION_FAILURE.label, at=1.0),
        inv.make_row("R", "SPENT", inv.FAILED, attempt=9, failure=FailureClass.TIMEOUT.label, at=1.0),
    ]
    got = {g.session: g.action for g in tr.select(listing, rows)}
    assert got == {"DONE": "skip", "PERM": "skip", "SPENT": "skip", "FRESH": "download"}


def test_select_keeps_going_after_a_new_recording():
    """The mirror of the test above, for the branch it CANNOT reach. With the unledgered entry last,
    `continue` → `break` in the new-recording arm produces identical output — so the fresh one has to
    come FIRST for the loop to prove it kept going. Found by mutation, not by reading the code: the
    two arms look symmetrical and only one was actually covered."""
    listing = [
        {"device_id": "R", "session": "FRESH", "reported_size": 8},
        {"device_id": "R", "session": "DONE", "reported_size": 8},
    ]
    rows = [inv.make_row("R", "DONE", inv.COMMITTED, at=1.0)]
    got = {g.session: g.action for g in tr.select(listing, rows)}
    assert got == {"FRESH": "download", "DONE": "skip"}


def test_select_attempt_bound_is_exclusive_at_the_boundary():
    """`attempt > max_attempts` vs `>=` differ ONLY at equality, and a test at attempt=3/max=3 skips
    under both. The third attempt is one we are still owed."""
    rows = [inv.make_row("R", "S", inv.FAILED, attempt=2, failure=FailureClass.TIMEOUT.label, at=1.0)]
    got = tr.select(_listing(), rows)[0]
    assert got.action == "download" and got.attempt == 3


def test_select_feeds_the_ledger_size_and_the_reported_size_into_the_decision():
    """Both arguments reach `resume_strategy`, and dropping either leaves a decision that still says
    RESTART — so only the reason can tell them apart. With resume allowed and the bytes already
    size-complete, the answer must name the TRAILER, which is reachable only if BOTH values arrive."""
    rows = [inv.make_row("R", "S", inv.PARTIAL, size=500, at=1.0)]
    got = tr.select(_listing(size=500), rows, allow_resume=True)[0]
    assert got.action == "download" and got.resume.mode == tr.RESTART
    assert "trailer" in got.resume.reason


def test_select_passes_allow_resume_through():
    """A dropped `allow_resume` silently reverts every caller to re-serve — safe, and therefore
    invisible to any assertion that only checks the file is fetched."""
    rows = [inv.make_row("R", "S", inv.PARTIAL, size=200, at=1.0)]
    got = tr.select(_listing(size=500), rows, allow_resume=True)[0]
    assert got.resume.mode == tr.RESUME and got.resume.offset == 200


def test_select_reads_the_partial_size_from_the_row():
    """`row.get("size")` → `row.get(None)` yields 0, which still RESTARTS — the mode cannot see it."""
    rows = [inv.make_row("R", "S", inv.PARTIAL, size=200, at=1.0)]
    got = tr.select(_listing(size=500), rows)[0]
    assert "discarding 200 B" in got.resume.reason


@pytest.mark.parametrize("state", [inv.VERIFIED, inv.COMMITTED])
def test_select_skips_what_is_already_done(state):
    rows = [inv.make_row("R", "S", state, at=1.0)]
    assert tr.select(_listing(), rows)[0].action == "skip"


@pytest.mark.parametrize("state", [inv.DISCOVERED, inv.PARTIAL, inv.DOWNLOADING, inv.VERIFYING])
def test_select_retries_every_unfinished_state(state):
    """DOWNLOADING and VERIFYING are what a CRASH leaves behind, never a live transfer — nothing in
    this process can observe another's in-flight work, so they must be treated exactly as PARTIAL."""
    rows = [inv.make_row("R", "S", state, size=200, at=1.0)]
    got = tr.select(_listing(), rows)[0]
    assert got.action == "download" and got.resume.mode == tr.RESTART


def test_select_stops_retrying_a_permanent_failure_immediately():
    """`recoverable` is a FIELD of the class, not an inference from the message (brief §6). A
    validation failure is not made recoverable by having attempts left."""
    rows = [inv.make_row("R", "S", inv.FAILED, attempt=1, failure=FailureClass.VALIDATION_FAILURE.label, at=1.0)]
    got = tr.select(_listing(), rows)[0]
    assert got.action == "skip" and "permanent" in got.reason


def test_select_retries_a_recoverable_failure_within_the_bound():
    rows = [inv.make_row("R", "S", inv.FAILED, attempt=1, failure=FailureClass.TRUNCATED_TRANSFER.label, at=1.0)]
    got = tr.select(_listing(), rows)[0]
    assert got.action == "download" and got.attempt == 2


def test_select_stops_at_the_attempt_bound():
    """Every retry is a fresh ~69 s acquisition (brief §1), so the bound is the performance policy."""
    rows = [inv.make_row("R", "S", inv.FAILED, attempt=3, failure=FailureClass.TIMEOUT.label, at=1.0)]
    got = tr.select(_listing(), rows)[0]
    assert got.action == "skip" and "exhausted" in got.reason


def test_unknown_failure_label_is_retried_because_the_errors_cost_differently():
    """Retrying a permanent failure wastes one bounded acquisition; declining to retry a recoverable
    one loses the recording. The default belongs to the cheaper error."""
    assert tr._is_recoverable(None) is True
    assert tr._is_recoverable("not_a_real_class") is True
    assert tr._is_recoverable(FailureClass.AUTHENTICATION_FAILURE.label) is False


def test_select_uses_the_last_row_not_the_best_one():
    """A deliberate regression (VERIFIED → PARTIAL after a file is found corrupt) must be honoured,
    which is why the ledger's `current` is last-row-wins by position."""
    rows = [inv.make_row("R", "S", inv.VERIFIED, at=1.0), inv.make_row("R", "S", inv.PARTIAL, size=10, at=2.0)]
    assert tr.select(_listing(), rows)[0].action == "download"


# ── download ───────────────────────────────────────────────────────────────────────────────────────


def test_download_writes_all_the_bytes(tmp_path):
    part = str(tmp_path / "x.part")
    res = tr.download(_fetch(b"ab", b"cd"), part, _sel(), reported_size=4)
    assert res.complete and res.bytes_written == 4
    assert open(part, "rb").read() == b"abcd"
    # The reason travels into the ledger row; a blank one loses the only record of what was moved.
    assert res.reason == "4 B received"


def test_download_with_no_resume_decision_asks_the_transport_for_offset_zero(tmp_path):
    """A missing Resume must mean "from the start". Any other offset silently drops leading bytes and
    still produces a file, so the returned size cannot see it — only the transport's argument can."""
    seen = []
    part = str(tmp_path / "x.part")
    sel = tr.Selection("i", "R", "S", "download", "no resume", None, 1)
    tr.download(_fetch(b"abc", seen=seen), part, sel)
    assert seen == [0]


def test_download_with_no_resume_decision_starts_from_zero(tmp_path):
    part = str(tmp_path / "x.part")
    sel = tr.Selection(IDENT, "R", "S", "download", "no resume", None, 1)
    assert tr.download(_fetch(b"abc"), part, sel).bytes_written == 3


def test_download_resumes_at_the_offset_when_told_to(tmp_path):
    part = tmp_path / "x.part"
    part.write_bytes(b"AB")
    res = tr.download(_fetch(b"cd"), str(part), _sel(mode=tr.RESUME, offset=2), reported_size=4)
    assert res.complete and part.read_bytes() == b"ABcd"


def test_resume_truncates_a_longer_stale_part_rather_than_splicing(tmp_path):
    """`r+b` overwrites in place: without a truncate, resuming over a longer stale `.part` leaves
    the old tail attached. The result is the right shape and the wrong bytes — the precise failure
    §5 names as the reason re-serve-from-start is the default."""
    part = tmp_path / "x.part"
    part.write_bytes(b"ABXYZW")
    res = tr.download(_fetch(b"cd"), str(part), _sel(mode=tr.RESUME, offset=2), reported_size=4)
    assert part.read_bytes() == b"ABcd"
    assert res.bytes_written == part.stat().st_size == 4


def test_a_short_file_is_truncated_transfer_not_a_timeout(tmp_path):
    """The ring stopped sending: the link was alive and the bytes received are good. Collapsing this
    into TRANSPORT_FAILURE would discard the distinction the taxonomy exists to keep."""
    res = tr.download(_fetch(b"ab"), str(tmp_path / "x.part"), _sel(), reported_size=99)
    assert res.complete is False
    assert res.failure is FailureClass.TRUNCATED_TRANSFER
    assert res.failure.recoverable is True
    # How much arrived is what the retry decides from — losing it turns a resumable partial into an
    # unknown, and the reason is what a human reads in the ledger.
    assert res.bytes_written == 2
    assert res.reason == "short: 2 B of 99 B"


def test_download_refuses_a_target_that_is_not_a_part_file(tmp_path):
    """The invariant behind crash points 3 and 4 is that a kill mid-transfer leaves something no
    reader can adopt. "The caller passes a .part path" is a convention; this makes it a guarantee."""
    final = tmp_path / "x.dat"
    with pytest.raises(ValueError, match=r"\.part"):
        tr.download(_fetch(b"ab"), str(final), _sel())
    assert not final.exists()


def test_download_reports_a_write_failure_as_storage(tmp_path):
    res = tr.download(_fetch(b"ab"), str(tmp_path / "nope" / "x.part"), _sel())
    assert res.failure is FailureClass.STORAGE_FAILURE and res.failure.recoverable is False
    assert res.reason.startswith("write failed: ")


def test_download_reports_a_transport_exception_as_transport(tmp_path):
    def boom(_offset):
        raise ValueError("link dropped")

    res = tr.download(boom, str(tmp_path / "x.part"), _sel())
    assert res.failure is FailureClass.TRANSPORT_FAILURE and res.failure.recoverable is True
    assert "link dropped" in res.reason


# ── verify — brief §4 ──────────────────────────────────────────────────────────────────────────────


def test_verify_accepts_a_finalised_file_whose_record_grid_is_whole(tmp_path):
    p = tmp_path / "x.part"
    p.write_bytes(GOOD)
    res = tr.verify(str(p), GOOD_SIZE, oxyii.parse_oxy_trailer)
    assert res.ok and res.sha256 == inv.sha256_bytes(GOOD)
    assert res.size == GOOD_SIZE and res.reason == f"size+finalised+records: 20 records at {GOOD_SIZE} B"


def test_verify_records_the_depth_it_actually_checked(tmp_path):
    """🔴 A VERIFIED that means "size+finalised" is a DIFFERENT claim from one that means "parses".
    The depth is written into the result so no reader can silently widen it, and so rows stay honest
    about what they were checked against once layer 3 lands."""
    p = tmp_path / "x.part"
    p.write_bytes(GOOD)
    assert tr.verify(str(p), GOOD_SIZE, oxyii.parse_oxy_trailer).depth == "size+finalised+records"
    assert tr.VALIDATION_DEPTH == "size+finalised+records"


def test_verify_reds_on_a_shifted_grid_that_size_and_trailer_cannot_see(tmp_path):
    """THE layer-3 control (brief §4 / lead 2026-08-24). A file can be EXACTLY the reported size and
    carry a valid finalisation trailer while its record grid is shifted — a dropped or duplicated chunk
    layers 1-2 are blind to. Here the trailer claims 21 seconds but only 20 records fit between header
    and trailer. Layers 1-2 would accept it; the record-boundary walk reds. This is the assertion that
    proves the layer sees what size+finalised could not."""
    forged = _fmt_a(20, total_seconds=21)
    assert len(forged) == GOOD_SIZE and oxyii.parse_oxy_trailer(forged) is not None  # layers 1-2 pass
    p = tmp_path / "x.part"
    p.write_bytes(forged)
    res = tr.verify(str(p), GOOD_SIZE, oxyii.parse_oxy_trailer)
    # exact reason — a substring check survives a mutmut string-wrap ("XX…XX"); equality kills it
    assert res.ok is False and res.reason == "record boundary: 20 records != trailer total_seconds 21"
    assert res.sha256 is None


def test_verify_reds_when_the_record_region_is_not_a_whole_number_of_records(tmp_path):
    """A stray byte in the record region leaves length and trailer intact but makes the 3-byte grid
    non-integral — caught before the count check."""
    shifted = bytes(tr._FMT_A_HEADER) + b"\x60\x40\x00" * 20 + b"\x00" + GOOD[-48:]
    p = tmp_path / "x.part"
    p.write_bytes(shifted)
    res = tr.verify(str(p), len(shifted), oxyii.parse_oxy_trailer)
    assert res.ok is False and res.sha256 is None
    assert res.reason == "record boundary: 61 B between header and trailer is not a whole number of 3-B records"


def test_verify_reds_on_a_non_format_a_header(tmp_path):
    """The walk anchors on the Format-A header; a finalised, rightly-sized file with a foreign header
    is not this format and must not pass as one."""
    bad = b"\x02\x03" + bytes(tr._FMT_A_HEADER[2:]) + b"\x60\x40\x00" * 20 + GOOD[-48:]
    p = tmp_path / "x.part"
    p.write_bytes(bad)
    res = tr.verify(str(p), len(bad), oxyii.parse_oxy_trailer)
    assert res.ok is False and res.sha256 is None
    assert res.reason == "record boundary: not a Format-A header"


def test_verify_stops_at_the_size_layer_without_calling_the_parser(tmp_path):
    """Layer order is the contract: a short file never reaches the parser."""
    called = []

    def spy(data):
        called.append(data)
        return {"ok": True}

    p = tmp_path / "x.part"
    p.write_bytes(b"ab")
    res = tr.verify(str(p), 99, spy)
    assert res.ok is False and "size" in res.reason and called == []


def test_size_equality_is_not_completeness(tmp_path):
    """The ring reports full size BEFORE the trailer flushes, so a file can be exactly the right
    length and still be missing the only thing that proves it finished."""
    p = tmp_path / "x.part"
    p.write_bytes(b"12345678")
    res = tr.verify(str(p), 8, _finalised)
    assert res.ok is False and "not finalised" in res.reason and res.sha256 is None


def test_verify_reports_an_unreadable_part_rather_than_raising(tmp_path):
    res = tr.verify(str(tmp_path / "absent.part"), None, _finalised)
    assert res.ok is False and "unreadable" in res.reason


# ══ §8a THE ABORT DEADLINE ═════════════════════════════════════════════════════════════════════════


def test_no_scheduled_drop_means_no_deadline_not_a_refusal():
    """`power.drop_not_worn_sec = 0` disables the drop deliberately. Inventing a deadline to defend a
    drop that will never happen would abort healthy pulls for nothing."""
    d = tr.pull_deadline(100.0, None)
    assert d.ok is True and d.abort_at is None


def test_a_future_drop_yields_a_deadline_one_guard_band_early():
    """The pull must be OFF the link before the drop is due, not merely told to stop."""
    d = tr.pull_deadline(0.0, 180.0, guard_band=10.0)
    assert d.ok is True and d.abort_at == 170.0


def test_a_deadline_already_passed_REFUSES_to_start():
    """Starting a pull that must abort immediately spends a link acquisition to produce nothing."""
    d = tr.pull_deadline(175.0, 180.0, guard_band=10.0)
    assert d.ok is False and d.abort_at is None


def test_a_zero_length_budget_is_not_a_budget():
    """`>=`, not `>`. Exactly at the deadline there is no time to do anything, so it is a refusal —
    the boundary a `>` would quietly admit."""
    assert tr.pull_deadline(170.0, 180.0, guard_band=10.0).ok is False
    assert tr.pull_deadline(169.99, 180.0, guard_band=10.0).ok is True


def test_the_guard_band_is_subtracted_not_added():
    """A sign error here would place the deadline AFTER the drop, which is the failure this function
    exists to prevent and would look entirely healthy in every other test."""
    d = tr.pull_deadline(0.0, 100.0, guard_band=25.0)
    assert d.abort_at == 75.0 and d.abort_at < 100.0


def test_the_default_guard_band_is_ten_seconds():
    """Pinned because it is a safety margin justified by measurement (0.8 s BlueZ teardown, 0.009 s
    commit), not a taste — a silent change to it should have to edit this line."""
    assert tr.GUARD_BAND_S == 10.0
    assert tr.pull_deadline(0.0, 180.0).abort_at == 170.0


# ══ THE TEN CRASH POINTS (brief §3) ════════════════════════════════════════════════════════════════


def test_crash_1_before_any_request_leaves_nothing(tmp_path):
    """Nothing on disk, nothing in the ledger."""
    assert tr.select(_listing(), [])[0].action == "download"  # decided, not acted on
    assert list(tmp_path.iterdir()) == []


def test_crash_2_after_listing_before_download_has_a_row_and_no_bytes(tmp_path):
    led = str(tmp_path / "l.jsonl")
    inv.append_row(led, inv.make_row("R", "S", inv.DISCOVERED, reported_size=500, at=1.0))
    assert inv.current(inv.load_rows(led))[IDENT]["state"] == inv.DISCOVERED
    assert not list(tmp_path.glob("*.part")) and not list(tmp_path.glob("*.dat"))


def test_crash_3_mid_download_leaves_a_part_that_is_never_adopted(tmp_path):
    """The `.part` suffix is load-bearing: a crash here must leave something that is obviously NOT a
    recording, so no reader can adopt it."""
    part = tmp_path / "x.part"
    final = tmp_path / "x.dat"
    tr.download(_fetch(b"ab"), str(part), _sel(), reported_size=99)
    assert part.exists() and not final.exists()
    assert inv.reconcile([inv.make_row("R", "S", inv.DOWNLOADING, size=2, at=1.0)], {})["missing"] == [IDENT]


def test_crash_4_complete_looking_bytes_are_still_not_adopted(tmp_path):
    part = tmp_path / "x.part"
    final = tmp_path / "x.dat"
    res = tr.download(_fetch(b"data" + TRAILER_MAGIC), str(part), _sel(), reported_size=8)
    assert res.complete and part.exists() and not final.exists()


def test_crash_5_verify_writes_nothing_outside_the_part(tmp_path):
    """Verified by SNAPSHOT rather than by reading the source: the invariant is about the directory,
    so the test measures the directory."""
    p = tmp_path / "x.part"
    p.write_bytes(b"data" + TRAILER_MAGIC)
    (tmp_path / "other.dat").write_bytes(b"untouched")
    before = {f.name: (f.stat().st_size, f.stat().st_mtime_ns) for f in tmp_path.iterdir()}
    tr.verify(str(p), 8, _finalised)
    after = {f.name: (f.stat().st_size, f.stat().st_mtime_ns) for f in tmp_path.iterdir()}
    assert before == after


def test_crash_6_verified_but_not_committed_is_recoverable(tmp_path):
    """Bytes are good and the ledger says so, but the rename never happened — the file is still a
    `.part`, so reconcile must NOT report it as verified-and-present."""
    rows = [inv.make_row("R", "S", inv.VERIFIED, size=8, at=1.0)]
    assert inv.reconcile(rows, {})["missing"] == [IDENT]


def test_crash_7_a_failed_rename_leaves_the_source_never_neither(tmp_path, monkeypatch):
    """`os.replace` is atomic, so either the old or the new name exists. The control is the failure
    path: if the rename raises, the `.part` must still be there."""
    part = tmp_path / "x.part"
    part.write_bytes(b"data")
    final = tmp_path / "x.dat"

    def boom(_a, _b):
        raise OSError("cross-device link")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        tr.commit(str(part), str(final))
    assert part.exists() and not final.exists()


def test_crash_8_committed_bytes_with_a_stale_ledger_are_repulled_never_lost(tmp_path):
    """Rename-first opens a window where disk is AHEAD of the ledger. G3 classifies bytes with no
    row as `repull` — one redundant fetch, never a loss. That is the cost this ordering buys, and
    the reverse ordering costs exactly the same fetch while leaving a ledger that lies."""
    part = tmp_path / "x.part"
    part.write_bytes(b"data" + TRAILER_MAGIC)
    final = tmp_path / "x.dat"
    tr.commit(str(part), str(final))
    assert final.exists() and not part.exists()
    assert inv.reconcile([], {IDENT: 8})["repull"] == [IDENT]


def test_crash_9_after_the_ledger_write_everything_agrees(tmp_path):
    """The only clean stop."""
    led = str(tmp_path / "l.jsonl")
    inv.append_row(led, inv.make_row("R", "S", inv.COMMITTED, size=8, at=1.0))
    rec = inv.reconcile(inv.load_rows(led), {IDENT: 8})
    assert rec["verified"] == [IDENT] and rec["repull"] == [] and rec["missing"] == []
    # "Consistent" is half the claim: a committed recording whose bytes CHANGED underneath us is
    # not clean either, and must be neither re-trusted nor silently re-pulled. Found by planting the
    # defect — the control passed without this line, because it only ever tested the matching case.
    drift = inv.reconcile(inv.load_rows(led), {IDENT: 9})
    assert drift["size_drift"] == [IDENT] and drift["verified"] == []


def test_crash_10_a_torn_final_line_costs_one_row_not_the_history(tmp_path):
    """Append-only exists so a kill mid-write is survivable. Refusing to read the ledger because of
    a torn line would turn a recoverable partial write into a total loss of history."""
    led = tmp_path / "l.jsonl"
    inv.append_row(str(led), inv.make_row("R", "S1", inv.COMMITTED, at=1.0))
    with open(led, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(inv.make_row("R", "S2", inv.PARTIAL, at=2.0))[:40])
    rows = inv.load_rows(str(led))
    assert len(rows) == 1 and rows[0]["session"] == "S1"


# ── the transaction end to end ─────────────────────────────────────────────────────────────────────


def test_the_happy_path_commits_exactly_once(tmp_path):
    led = str(tmp_path / "l.jsonl")
    part, final = str(tmp_path / "x.part"), str(tmp_path / "x.dat")
    sel = tr.select(_listing(size=GOOD_SIZE), [])[0]
    inv.append_row(led, inv.make_row("R", "S", inv.DOWNLOADING, attempt=sel.attempt, at=1.0))
    dl = tr.download(_fetch(GOOD), part, sel, reported_size=GOOD_SIZE)
    assert dl.complete
    ver = tr.verify(part, GOOD_SIZE, oxyii.parse_oxy_trailer)
    assert ver.ok
    tr.commit(part, final)
    inv.append_row(
        led,
        inv.make_row("R", "S", inv.COMMITTED, size=ver.size, sha256=ver.sha256, reason=ver.depth, path=final, at=2.0),
    )
    rec = inv.reconcile(inv.load_rows(led), {IDENT: GOOD_SIZE})
    assert rec["verified"] == [IDENT]
    assert tr.select(_listing(size=GOOD_SIZE), inv.load_rows(led))[0].action == "skip"

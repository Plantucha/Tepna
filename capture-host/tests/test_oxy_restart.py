# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Restart-safe acquisition state (charter G3).

The charter's requirement is a negative one — "an interrupted transfer is re-queued or explicitly
restarted, NEVER SILENTLY TRUSTED" — so most of these tests are planted controls for states that
LOOK finished. A restart is the dangerous moment precisely because a killed transfer leaves bytes
with the right name and a plausible size, and every cheap check says "we have it"."""
import oxy_inventory as inv
import oxy_restart as rs

ID = inv.identity("S8AW2100", "20260813202245")
OTHER = inv.identity("S8AW2100", "20260814210101")
THIRD = inv.identity("S8AW2100", "20260815210101")
FOURTH = inv.identity("S8AW2100", "20260816210101")
FIFTH = inv.identity("S8AW2100", "20260817210101")


def _row(state, ident=ID, size=500):
    dev, sess = ident.split("/")
    return inv.make_row(dev, sess, state, size=size, at=1.0)


# ── the planted control the charter names ───────────────────────────────────────────────────────
def test_KILLED_BETWEEN_DOWNLOAD_AND_COMMIT_is_requeued_not_trusted():
    """🔴 THE CONTROL. The bytes are on disk, they are the right size, and they PASSED validation —
    the ledger's last word is VERIFIED. What never happened is the commit. Nothing on the filesystem
    records that difference, which is the whole reason the ledger is consulted at all.

    `reconcile()` alone calls this "verified" (it groups VERIFIED with COMMITTED), so a planner that
    stopped there would do nothing and the recording would never be committed."""
    planned = rs.plan([_row(inv.VERIFIED)], {ID: 500})
    assert planned[rs.COMMIT] == [ID], "a verified-but-uncommitted recording must be finished, not skipped"
    assert planned[rs.INTACT] == [], "and it must NOT be treated as done"
    assert rs.is_trusted(planned, ID) is False
    assert "never committed" in planned["reasons"][ID]


def test_a_committed_recording_with_matching_bytes_is_the_only_do_nothing():
    planned = rs.plan([_row(inv.COMMITTED)], {ID: 500})
    assert planned[rs.INTACT] == [ID]
    assert rs.is_trusted(planned, ID) is True
    assert planned[rs.COMMIT] == [] and planned[rs.REPULL] == []


def test_a_partial_transfer_is_repulled():
    planned = rs.plan([_row(inv.PARTIAL, size=40)], {ID: 40})
    assert planned[rs.REPULL] == [ID]
    assert "incomplete" in planned["reasons"][ID]


def test_bytes_with_NO_ledger_row_are_repulled_never_adopted():
    """Bytes nothing ever validated. Adopting them because they exist is the "size equality means
    complete" assumption `oxy_inventory` was built to refuse, re-entering one layer up."""
    planned = rs.plan([], {ID: 500})
    assert planned[rs.REPULL] == [ID]
    assert "no ledger row" in planned["reasons"][ID]
    assert rs.is_trusted(planned, ID) is False


def test_a_known_recording_absent_from_disk_is_repulled():
    planned = rs.plan([_row(inv.COMMITTED)], {})
    assert planned[rs.REPULL] == [ID]
    assert "disk does not" in planned["reasons"][ID]


def test_size_drift_is_QUARANTINED_neither_trusted_nor_overwritten():
    """Re-pulling would destroy the evidence; trusting would launder it. So it is neither — it gets
    its own action, and a human decides."""
    planned = rs.plan([_row(inv.COMMITTED, size=500)], {ID: 512})
    assert planned[rs.QUARANTINE] == [ID]
    assert planned[rs.REPULL] == [] and planned[rs.INTACT] == []
    assert rs.is_trusted(planned, ID) is False


# ── .part files: the debris of an interrupted transfer ──────────────────────────────────────────
def test_a_part_file_is_NEVER_adopted_however_plausible_its_size():
    """A `.part` is by definition a transfer that did not finish, so its bytes have passed no trailer
    check. Its size proves nothing — that is exactly what `classify` refuses."""
    planned = rs.plan([_row(inv.PARTIAL, size=500)], {}, part_files={ID: 500})
    assert planned[rs.REPULL] == [ID]
    assert rs.is_trusted(planned, ID) is False
    assert planned["stale_parts"] == [ID]


def test_a_part_file_beside_an_otherwise_VERIFIED_row_still_forces_a_repull():
    """The dangerous shape: a finished-looking file AND leftover debris. The debris wins — the row
    says verified, but a `.part` beside it means a later transfer was interrupted over the top."""
    planned = rs.plan([_row(inv.VERIFIED)], {ID: 500}, part_files={ID: 120})
    assert planned[rs.REPULL] == [ID], "the .part demotes it out of COMMIT"
    assert planned[rs.COMMIT] == []


def test_a_part_beside_a_COMMITTED_recording_leaves_the_recording_alone():
    """⚠️ The one place debris does NOT force work, and the asymmetry is deliberate: the recording is
    committed and its bytes match, so re-pulling a good recording to tidy up a stray file would be
    the more destructive of the two options. The `.part` is still reported for sweeping."""
    planned = rs.plan([_row(inv.COMMITTED)], {ID: 500}, part_files={ID: 120})
    assert planned[rs.INTACT] == [ID]
    assert planned["stale_parts"] == [ID], "still reported, just not acted on by re-pulling"


def test_a_part_for_a_recording_already_being_repulled_is_noted_not_duplicated():
    planned = rs.plan([_row(inv.PARTIAL, size=40)], {ID: 40}, part_files={ID: 40})
    assert planned[rs.REPULL] == [ID], "listed once"
    assert ".part present" in planned["reasons"][ID]
    # ⚠️ APPENDED, NOT REPLACED. `reasons[x] += …` mutated to `=` still leaves ".part present" in the
    # string, so a substring check alone cannot see it — and the original classification, which is
    # WHY the recording is being re-pulled at all, would be silently discarded.
    assert "incomplete" in planned["reasons"][ID], "the original reason must survive the append"


def test_a_committed_part_does_not_stop_the_scan_of_LATER_parts():
    """`continue` in the `.part` loop, not `break`. With `break`, the first committed-with-debris
    entry ends the loop and every later `.part` is never seen — the recording it belongs to would be
    silently trusted.

    Same shape as `reconcile`'s missing-branch: a classification loop that stops early produces a
    plan that LOOKS complete. Iteration order is not guaranteed, so both orderings are asserted."""
    rows = [_row(inv.COMMITTED), _row(inv.COMMITTED, OTHER, 700)]
    planned = rs.plan(rows, {ID: 500, OTHER: 700}, part_files={ID: 12, OTHER: 12})
    # Both are committed-with-debris, so both stay INTACT and both are reported for sweeping —
    # which only holds if the loop visited both.
    assert planned[rs.INTACT] == sorted([ID, OTHER])
    assert planned["stale_parts"] == sorted([ID, OTHER])

    # And the mixed case: one committed (skipped), one not (must still be re-pulled).
    rows2 = [_row(inv.COMMITTED), _row(inv.VERIFIED, OTHER, 700)]
    p2 = rs.plan(rows2, {ID: 500, OTHER: 700}, part_files={ID: 12, OTHER: 12})
    assert p2[rs.INTACT] == [ID], "the committed one keeps its file"
    assert p2[rs.REPULL] == [OTHER], "the later .part must still force a re-pull"


# ── the shape of the whole plan ─────────────────────────────────────────────────────────────────
def test_every_recording_lands_in_exactly_one_action():
    """A recording in two buckets is a planner that will both re-pull and trust the same file."""
    rows = [_row(inv.COMMITTED), _row(inv.VERIFIED, OTHER, 700)]
    planned = rs.plan(rows, {ID: 500, OTHER: 700}, part_files={})
    seen = planned[rs.INTACT] + planned[rs.COMMIT] + planned[rs.REPULL] + planned[rs.QUARANTINE]
    assert sorted(seen) == sorted({ID, OTHER}), seen
    assert len(seen) == len(set(seen)), "no recording may appear twice"


def test_every_classified_recording_carries_a_reason():
    """A plan whose reasoning is invisible gets overridden by whoever reads it.

    ⚠️ THE WORLD HERE MUST REACH EVERY ACTION, and the first version did not — it built only INTACT
    and REPULL, so mutation found `put(QUARANTINE, …, None)` and `put(REPULL, …, None)` on the
    `.part` path both surviving: the loop ran, found nothing in those buckets, and asserted over an
    empty set. A completeness test that does not construct the states it claims to cover is the
    "check that examined nothing" shape, wearing a for-loop."""
    rows = [
        _row(inv.COMMITTED),                                # -> intact
        _row(inv.PARTIAL, OTHER, 40),                       # -> repull
        _row(inv.VERIFIED, THIRD, 700),                     # -> commit
        _row(inv.COMMITTED, FOURTH, 900),                   # -> quarantine (size drifts below)
    ]
    planned = rs.plan(
        rows,
        {ID: 500, OTHER: 40, THIRD: 700, FOURTH: 950},
        part_files={FIFTH: 12},                             # -> repull via the .part path
    )
    for a in (rs.INTACT, rs.COMMIT, rs.REPULL, rs.QUARANTINE):
        assert planned[a], f"{a} is empty — this test cannot claim to cover it"
        for ident in planned[a]:
            assert planned["reasons"].get(ident), f"{ident} in {a} with no reason"


def test_plan_is_pure_and_does_not_mutate_its_inputs():
    rows = [_row(inv.COMMITTED)]
    listing = {ID: 500}
    parts = {OTHER: 10}
    before = (len(rows), dict(listing), dict(parts))
    rs.plan(rows, listing, parts)
    assert (len(rows), listing, parts) == before


def test_an_empty_world_plans_nothing():
    planned = rs.plan([], {})
    assert planned[rs.INTACT] == [] and planned[rs.REPULL] == []
    assert planned["stale_parts"] == []

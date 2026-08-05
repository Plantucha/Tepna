# tepna-capture — tests/test_nightarchive.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
import os

import nightarchive


def _night(cap, name, files):
    d = os.path.join(cap, name); os.makedirs(d, exist_ok=True)
    for fn, content in files.items():
        with open(os.path.join(d, fn), "w") as f:
            f.write(content)
    return d


def test_pending_nights_excludes_active_and_marked(tmp_path):
    cap = str(tmp_path / "captures")
    _night(cap, "2026-07-17", {"a_b_c_ECG.txt": "x"})
    _night(cap, "2026-07-18", {"a_b_c_ECG.txt": "x", nightarchive._MARKER: ""})   # already archived
    _night(cap, "2026-07-19", {"a_b_c_ECG.txt": "x"})                              # still being written
    # a bare string is accepted for the single-active-night case
    assert nightarchive.pending_nights(cap, "2026-07-19") == ["2026-07-17"]


def test_pending_nights_protects_every_active_night(tmp_path):
    # a session that ran past midnight leaves TWO in-progress date dirs — both must be skipped
    cap = str(tmp_path / "captures")
    _night(cap, "2026-07-17", {"a_b_c_ECG.txt": "x"})
    _night(cap, "2026-07-18", {"a_b_c_ECG.txt": "x"})                              # pre-midnight, still active
    _night(cap, "2026-07-19", {"a_b_c_ECG.txt": "x"})                              # post-midnight, still active
    assert nightarchive.pending_nights(cap, {"2026-07-18", "2026-07-19"}) == ["2026-07-17"]


def test_pending_nights_missing_dir_is_empty():
    assert nightarchive.pending_nights("/no/such/captures", "2026-07-19") == []


def test_archive_night_mirrors_files_and_marks_done(tmp_path):
    cap = str(tmp_path / "captures"); dest = str(tmp_path / "backup")
    _night(cap, "2026-07-17", {"Polar_H10_1_ECG.txt": "rows", "QC-SUMMARY.json": "{}",
                               nightarchive._MARKER: ""})       # a stale marker must be skipped, not copied
    os.mkdir(os.path.join(cap, "2026-07-17", "subdir"))          # a dir must be skipped (files only)
    copied = nightarchive.archive_night(cap, "2026-07-17", dest)
    assert copied == 2                                           # only the 2 real files; marker not mirrored
    assert not os.path.exists(os.path.join(dest, "2026-07-17", nightarchive._MARKER))
    assert os.path.exists(os.path.join(dest, "2026-07-17", "Polar_H10_1_ECG.txt"))
    assert os.path.exists(os.path.join(cap, "2026-07-17", nightarchive._MARKER))  # marker dropped in source
    # source is a MIRROR — never moved/deleted
    assert os.path.exists(os.path.join(cap, "2026-07-17", "Polar_H10_1_ECG.txt"))


def test_archive_night_is_idempotent_and_resumable(tmp_path):
    cap = str(tmp_path / "captures"); dest = str(tmp_path / "backup")
    _night(cap, "2026-07-17", {"a.txt": "hello", "b.txt": "world"})
    assert nightarchive.archive_night(cap, "2026-07-17", dest) == 2
    # pre-place one dest file identical → only the differing/new file is (re)copied on a resume
    os.remove(os.path.join(cap, "2026-07-17", nightarchive._MARKER))  # force a re-run
    with open(os.path.join(dest, "2026-07-17", "a.txt")) as f:
        assert f.read() == "hello"                              # a.txt already there, same size
    copied = nightarchive.archive_night(cap, "2026-07-17", dest)
    assert copied == 0                                          # both already mirrored unchanged → skipped


def test_archive_night_recopies_a_changed_file(tmp_path):
    cap = str(tmp_path / "captures"); dest = str(tmp_path / "backup")
    _night(cap, "2026-07-17", {"a.txt": "short"})
    nightarchive.archive_night(cap, "2026-07-17", dest)
    os.remove(os.path.join(cap, "2026-07-17", nightarchive._MARKER))
    with open(os.path.join(cap, "2026-07-17", "a.txt"), "w") as f:
        f.write("a much longer line")                           # size changed → must recopy
    assert nightarchive.archive_night(cap, "2026-07-17", dest) == 1


# ── RETENTION IS GATED ON A SECOND COPY (VIGIL-HARDENING-II §1.1) ──────────────────────────────
# diskguard.plan_prune deletes by AGE alone, which treats "old" as "safe to lose". It is not. On
# 2026-07-25 this box had `dest_present:false`: 4 of 10 nights had no marker at all and the other 6
# were marked against a volume that is no longer present. A second copy is the evidence, not the date.

import diskguard


def test_unarchived_nights_lists_exactly_the_single_copy_nights(tmp_path):
    cap = str(tmp_path / "captures")
    _night(cap, "2026-07-17", {"a_b_c_ECG.txt": "x", nightarchive._MARKER: ""})
    _night(cap, "2026-07-18", {"a_b_c_ECG.txt": "x"})
    _night(cap, "2026-07-19", {"a_b_c_ECG.txt": "x"})
    assert nightarchive.unarchived_nights(cap) == {"2026-07-18", "2026-07-19"}


def test_unarchived_is_empty_when_everything_is_mirrored(tmp_path):
    cap = str(tmp_path / "captures")
    for n in ("2026-07-17", "2026-07-18"):
        _night(cap, n, {"a_b_c_ECG.txt": "x", nightarchive._MARKER: ""})
    assert nightarchive.unarchived_nights(cap) == set()


def test_an_unmirrored_night_survives_the_retention_policy(tmp_path):
    """THE regression: keep_nights=1 over three nights would delete the two oldest. Because they were
    never mirrored, the archive gate must hold them."""
    cap = str(tmp_path / "captures")
    for n in ("2026-07-17", "2026-07-18", "2026-07-19"):
        _night(cap, n, {"a_b_c_ECG.txt": "x"})
    nights = diskguard.list_nights(cap)
    assert diskguard.plan_prune(nights, 1) == ["2026-07-17", "2026-07-18"], "age alone would delete both"
    blocked = nightarchive.unarchived_nights(cap)
    assert diskguard.plan_prune(nights, 1, protect=blocked) == [], "no second copy ⇒ nothing is deleted"


def test_a_mirrored_night_is_still_pruned_normally(tmp_path):
    """The gate must not become a permanent stay of execution — a night WITH a second copy still ages
    out, or the disk fills for a different reason."""
    cap = str(tmp_path / "captures")
    _night(cap, "2026-07-17", {"a_b_c_ECG.txt": "x", nightarchive._MARKER: ""})
    _night(cap, "2026-07-18", {"a_b_c_ECG.txt": "x", nightarchive._MARKER: ""})
    _night(cap, "2026-07-19", {"a_b_c_ECG.txt": "x"})
    blocked = nightarchive.unarchived_nights(cap)
    assert blocked == {"2026-07-19"}, "only the unmirrored night is held"
    # keep_nights=1 retains 07-19; 07-17 and 07-18 are both stale AND both have a second copy, so the
    # gate lets both go. It defers deletion, it does not forbid it.
    assert diskguard.plan_prune(diskguard.list_nights(cap), 1, protect=blocked) == \
        ["2026-07-17", "2026-07-18"]


def test_unreadable_marker_counts_as_unarchived(tmp_path, monkeypatch):
    """Fails SAFE: doubt about whether a second copy exists must protect the data, never license the
    delete — the same direction as diskguard.active_nights."""
    cap = str(tmp_path / "captures")
    _night(cap, "2026-07-17", {"a_b_c_ECG.txt": "x", nightarchive._MARKER: ""})
    monkeypatch.setattr(nightarchive.os.path, "exists",
                        lambda p: (_ for _ in ()).throw(OSError("EIO")))
    assert nightarchive.unarchived_nights(cap) == {"2026-07-17"}


# ── THE MARKER IS NOT PROOF THE COPY SURVIVES (VIGIL-HARDENING-II §1.3) ────────────────────────
# `.archived` records that a copy was once MADE. On the real box 2026-07-25, 6 of 10 nights carried
# the marker while the backup volume was ABSENT — so a marker-only gate would have deleted the on-box
# copy of a night whose mirror had gone away with the disk, losing both.

def test_a_marked_night_whose_mirror_vanished_is_treated_as_unarchived(tmp_path):
    cap = str(tmp_path / "captures")
    dest = str(tmp_path / "backup")
    os.makedirs(dest)
    _night(cap, "2026-07-17", {"a_b_c_ECG.txt": "x", nightarchive._MARKER: ""})
    _night(cap, "2026-07-18", {"a_b_c_ECG.txt": "x", nightarchive._MARKER: ""})
    # A REAL mirror, not just a directory: since CAPTURE-HOST-DEEP-AUDIT §C4 the gate confirms every
    # source file is present at the destination at the same size. An empty `dest/<night>/` is exactly
    # the premature-archive shape the audit found — it satisfied the old "isdir" test while holding
    # none of the night.
    _night(dest, "2026-07-17", {"a_b_c_ECG.txt": "x"})     # only THIS one still exists at the dest
    assert nightarchive.unarchived_nights(cap, dest) == {"2026-07-18"}


def test_an_absent_backup_volume_protects_every_night(tmp_path):
    """dest gone ⇒ nothing can be confirmed ⇒ nothing may be deleted, markers notwithstanding."""
    cap = str(tmp_path / "captures")
    for n in ("2026-07-17", "2026-07-18"):
        _night(cap, n, {"a_b_c_ECG.txt": "x", nightarchive._MARKER: ""})
    assert nightarchive.unarchived_nights(cap, str(tmp_path / "not-mounted")) == \
        {"2026-07-17", "2026-07-18"}


def test_a_confirmed_mirror_still_allows_the_prune(tmp_path):
    """The control on §C4: a mirror that really holds the night must still release it, or retention
    stalls forever and the disk fills — the failure VIGIL-HARDENING-II §1 deliberately traded for."""
    cap = str(tmp_path / "captures")
    dest = str(tmp_path / "backup")
    for n in ("2026-07-17", "2026-07-18"):
        _night(cap, n, {"a_b_c_ECG.txt": "x", nightarchive._MARKER: ""})
        _night(dest, n, {"a_b_c_ECG.txt": "x"})
    assert nightarchive.unarchived_nights(cap, dest) == set()


def test_marker_only_mode_is_still_available(tmp_path):
    """dest=None keeps the weaker marker-only behaviour for callers with no knowable destination."""
    cap = str(tmp_path / "captures")
    _night(cap, "2026-07-17", {"a_b_c_ECG.txt": "x", nightarchive._MARKER: ""})
    _night(cap, "2026-07-18", {"a_b_c_ECG.txt": "x"})
    assert nightarchive.unarchived_nights(cap) == {"2026-07-18"}


# ── the premature-archive window (CAPTURE-HOST-DEEP-AUDIT §C4) ──────────────────────────────────
def _touch(path, when):
    os.utime(path, (when, when))


def test_a_night_that_grew_after_the_marker_is_offered_again(tmp_path):
    """THE §C4 regression, and the only finding in the audit that DELETES data rather than mis-stating
    it. `writers.night_dir` keys a folder on the SESSION'S START DATE, so an early-morning session and
    that evening's session share one YYYY-MM-DD dir with a multi-hour daytime lull between them. During
    the lull the night looks finished, gets mirrored, and is marked done — and nothing anywhere removes
    the marker, so everything written that evening never reached the mirror.

    Measured on the real box: 7 of 11 nights have a genuine premature-archive window (2026-07-20 quiet
    for 5.08 h with 828.8 MB written afterwards; 2026-07-22 quiet 8.33 h, 652.5 MB)."""
    cap = str(tmp_path / "captures")
    d = _night(cap, "2026-07-20", {"morning_a_b_ECG.txt": "x", nightarchive._MARKER: ""})
    _touch(os.path.join(d, "morning_a_b_ECG.txt"), 1000)
    _touch(os.path.join(d, nightarchive._MARKER), 2000)          # mirrored after the morning session
    assert nightarchive.pending_nights(cap, set()) == [], "nothing has changed yet"

    # ...and then the evening session writes into the same folder.
    with open(os.path.join(d, "evening_a_b_ECG.txt"), "w") as f:
        f.write("y" * 100)
    _touch(os.path.join(d, "evening_a_b_ECG.txt"), 3000)
    assert nightarchive.pending_nights(cap, set()) == ["2026-07-20"], \
        "the night grew after it was marked — the mirror is now incomplete"


def test_an_unreadable_night_is_offered_again_rather_than_skipped(tmp_path):
    """Fails SAFE: a re-offer costs only the files that differ (archive_night is idempotent and
    size-diffed), while a wrong skip loses them."""
    cap = str(tmp_path / "captures")
    _night(cap, "2026-07-20", {"a_b_c_ECG.txt": "x"})            # marker absent entirely
    assert nightarchive.pending_nights(cap, set()) == ["2026-07-20"]


def test_a_short_mirror_does_not_release_the_night_to_the_pruner(tmp_path):
    """The destination half. `unarchived_nights` checked only that `dest/<night>/` EXISTS, which a
    mirror made mid-night satisfies while holding only part of it — so retention could delete the
    local, and only complete, copy. Confirmation is now per-file at matching size."""
    cap = str(tmp_path / "captures")
    dest = str(tmp_path / "backup")
    _night(cap, "2026-07-20", {"a_ECG.txt": "xxxx", "b_ACC.txt": "yyyy", nightarchive._MARKER: ""})
    _night(dest, "2026-07-20", {"a_ECG.txt": "xxxx"})            # the ACC file never made it
    assert nightarchive.unarchived_nights(cap, dest) == {"2026-07-20"}


def test_a_truncated_mirrored_file_does_not_release_the_night(tmp_path):
    """Present but SHORT — a copy interrupted by a full or unplugged backup volume."""
    cap = str(tmp_path / "captures")
    dest = str(tmp_path / "backup")
    _night(cap, "2026-07-20", {"a_ECG.txt": "x" * 1000, nightarchive._MARKER: ""})
    _night(dest, "2026-07-20", {"a_ECG.txt": "x" * 10})
    assert nightarchive.unarchived_nights(cap, dest) == {"2026-07-20"}


def test_re_archiving_a_grown_night_copies_only_the_new_files(tmp_path):
    """The re-offer must be cheap, or it would re-copy gigabytes every poll."""
    cap = str(tmp_path / "captures")
    dest = str(tmp_path / "backup")
    _night(cap, "2026-07-20", {"morning_ECG.txt": "x" * 50})
    assert nightarchive.archive_night(cap, "2026-07-20", dest) == 1
    with open(os.path.join(cap, "2026-07-20", "evening_ECG.txt"), "w") as f:
        f.write("y" * 50)
    assert nightarchive.archive_night(cap, "2026-07-20", dest) == 1, "only the new file"
    assert nightarchive.unarchived_nights(cap, dest) == set(), "and now the mirror is complete"


# ── the copier and the confirmer must agree about what a night CONTAINS (audit F1, 2026-08-01) ────────
#
# Every other branch in this module fails SAFE: an unreadable marker, an absent destination, any OSError
# all report the night unconfirmed so the doubt protects the data. `_mirror_matches` had one branch that
# failed OPEN. It skipped anything that was not a plain file, and so did `archive_night` — so a night
# holding a subdirectory was CONFIRMED mirrored while the subdirectory's contents had never been copied,
# which released it to `prune_old_nights`. The two functions agreeing was a coincidence of both skipping
# the same thing, not a property; now they share one enumerator and cannot disagree.

def _deep_night(cap, name):
    d = _night(cap, name, {"Polar_H10_1_20260701010101_ECG.txt": "x" * 100})
    sub = os.path.join(d, "Polar_Offline_1"); os.makedirs(sub, exist_ok=True)
    with open(os.path.join(sub, "SAMPLES.BPB"), "w") as f:
        f.write("irreplaceable device flash")
    return d


def test_a_nested_file_is_mirrored_not_silently_skipped(tmp_path):
    cap, dest = str(tmp_path / "captures"), str(tmp_path / "backup")
    _deep_night(cap, "2026-07-01")
    nightarchive.archive_night(cap, "2026-07-01", dest)
    mirrored = os.path.join(dest, "2026-07-01", "Polar_Offline_1", "SAMPLES.BPB")
    assert os.path.exists(mirrored), "the nested file was never copied"
    assert open(mirrored).read() == "irreplaceable device flash"


def test_a_night_whose_nested_file_is_missing_at_the_destination_is_NOT_confirmed(tmp_path):
    """THE data-loss path. Confirmation is what licenses `prune_old_nights` to delete the local copy."""
    cap, dest = str(tmp_path / "captures"), str(tmp_path / "backup")
    _deep_night(cap, "2026-07-01")
    nightarchive.archive_night(cap, "2026-07-01", dest)
    os.remove(os.path.join(dest, "2026-07-01", "Polar_Offline_1", "SAMPLES.BPB"))
    assert nightarchive.unarchived_nights(cap, dest) == {"2026-07-01"}, (
        "a night missing a nested file at the destination was confirmed as fully mirrored"
    )


def test_a_short_nested_file_is_not_confirmed_either(tmp_path):
    """Size parity applies at every depth, not just the top level."""
    cap, dest = str(tmp_path / "captures"), str(tmp_path / "backup")
    _deep_night(cap, "2026-07-01")
    nightarchive.archive_night(cap, "2026-07-01", dest)
    with open(os.path.join(dest, "2026-07-01", "Polar_Offline_1", "SAMPLES.BPB"), "w") as f:
        f.write("trunc")
    assert nightarchive.unarchived_nights(cap, dest) == {"2026-07-01"}


def test_growth_inside_a_subdirectory_re_offers_the_night(tmp_path):
    """`_grew_since_marker` scanned only the top level, so a night that gained data ONLY inside a
    subdirectory after being marked looked finished and was never re-offered."""
    cap = str(tmp_path / "captures")
    d = _deep_night(cap, "2026-07-01")
    marker = os.path.join(d, nightarchive._MARKER)
    open(marker, "w").close()
    old = os.stat(marker).st_mtime
    os.utime(os.path.join(d, "Polar_H10_1_20260701010101_ECG.txt"), (old - 100, old - 100))
    nested = os.path.join(d, "Polar_Offline_1", "SAMPLES.BPB")
    os.utime(nested, (old + 100, old + 100))            # the ONLY thing newer than the marker
    assert nightarchive.pending_nights(cap, set()) == ["2026-07-01"]


# ── the exposure the archive does NOT cover must be reported, not implied (audit F2) ─────────────────

def test_uncovered_subtrees_names_the_data_that_has_only_one_copy(tmp_path):
    cap = str(tmp_path / "captures")
    _night(cap, "2026-07-01", {"a_b_c_20260701010101_ECG.txt": "x"})
    for name, payload in (("stored", "onboard flash"), ("cpap", "edf bytes")):
        d = os.path.join(cap, name); os.makedirs(d)
        with open(os.path.join(d, "payload.bin"), "w") as f:
            f.write(payload)
    got = nightarchive.uncovered_subtrees(cap)
    assert [g["name"] for g in got] == ["cpap", "stored"], (
        "the subtrees outside the mirror must be named — 'backup working' otherwise means "
        "'backup working for some of your data'"
    )
    assert got[1] == {"name": "stored", "files": 1, "bytes": len("onboard flash")}


def test_a_night_only_box_reports_no_exposure(tmp_path):
    """No false alarm on the ordinary case, or the signal stops meaning anything."""
    cap = str(tmp_path / "captures")
    _night(cap, "2026-07-01", {"a_b_c_20260701010101_ECG.txt": "x"})
    assert nightarchive.uncovered_subtrees(cap) == []


def test_an_empty_or_hidden_directory_is_not_an_exposure(tmp_path):
    cap = str(tmp_path / "captures")
    _night(cap, "2026-07-01", {"a_b_c_20260701010101_ECG.txt": "x"})
    os.makedirs(os.path.join(cap, "incoming"))            # ineligible by name, holds nothing
    os.makedirs(os.path.join(cap, "scratch"))             # eligible by name, but genuinely empty —
    os.makedirs(os.path.join(cap, "scratch", "sub"))      # ...even with a subdirectory in it
    os.makedirs(os.path.join(cap, ".tmp"))
    with open(os.path.join(cap, ".tmp", "x"), "w") as f:
        f.write("scratch")
    assert nightarchive.uncovered_subtrees(cap) == []


def test_uncovered_subtrees_is_best_effort_on_an_unreadable_tree(tmp_path):
    assert nightarchive.uncovered_subtrees(str(tmp_path / "nope")) == []


def test_an_unreadable_subtree_is_skipped_not_reported_as_empty(tmp_path):
    """Best-effort means SKIP, not "0 files" — a count of zero for a directory we could not read would
    be the same fabricated-absence this suite exists to reject."""
    cap = str(tmp_path / "captures")
    _night(cap, "2026-07-01", {"a_b_c_20260701010101_ECG.txt": "x"})
    bad = os.path.join(cap, "stored"); os.makedirs(bad)
    with open(os.path.join(bad, "payload.bin"), "w") as f:
        f.write("data")
    os.chmod(bad, 0o000)
    try:
        assert nightarchive.uncovered_subtrees(cap) == []
    finally:
        os.chmod(bad, 0o755)


# ── the append-forever subtrees: mirrored, never pruned (audit F2, landed 2026-08-01) ────────────────
#
# `stored/` (onboard device-flash pulls) and `cpap/` (harvested EDFs) sat outside the mirror entirely.
# Measured before landing this: 1.5 MB and 534 MB respectively — 0.16 % and 0.28 % of ONE night — so the
# disk-budget question the exposure was deferred for turned out not to exist. `stored/` is the strong
# case: the O2Ring's flash is a small FIFO, so once it rotates the box copy is the only one anywhere.

def test_a_subtree_is_mirrored_file_for_file(tmp_path):
    cap, dest = str(tmp_path / "captures"), str(tmp_path / "backup")
    st = os.path.join(cap, "stored"); os.makedirs(st)
    with open(os.path.join(st, "Wellue_O2Ring-S_20260716154350_STORED.dat"), "w") as f:
        f.write("flash bytes")
    os.makedirs(os.path.join(st, "Polar_Offline_1"))
    with open(os.path.join(st, "Polar_Offline_1", "SAMPLES.BPB"), "w") as f:
        f.write("nested")
    assert nightarchive.mirror_subtree(cap, "stored", dest) == 2
    assert open(os.path.join(dest, "stored", "Polar_Offline_1", "SAMPLES.BPB")).read() == "nested"


def test_mirroring_a_subtree_is_size_diffed_so_a_repeat_copies_only_what_is_new(tmp_path):
    """These trees are APPEND-FOREVER, unlike a night — there is no 'finished' moment, so there is no
    `.archived` marker and the diff runs every cycle. It must therefore be cheap and idempotent."""
    cap, dest = str(tmp_path / "captures"), str(tmp_path / "backup")
    st = os.path.join(cap, "stored"); os.makedirs(st)
    with open(os.path.join(st, "a.dat"), "w") as f:
        f.write("one")
    assert nightarchive.mirror_subtree(cap, "stored", dest) == 1
    assert nightarchive.mirror_subtree(cap, "stored", dest) == 0, "a repeat must copy nothing"
    with open(os.path.join(st, "b.dat"), "w") as f:
        f.write("two")
    assert nightarchive.mirror_subtree(cap, "stored", dest) == 1
    assert not os.path.exists(os.path.join(cap, "stored", nightarchive._MARKER)), (
        "an append-forever tree must not be marked done — there is no such state"
    )


def test_a_transient_tree_is_never_eligible_however_it_is_configured(tmp_path):
    """`incoming/` holds partial downloads. A mirrored partial is worse than no mirror: it looks like
    data. This is a code-level refusal, not a default someone can configure away."""
    cap, dest = str(tmp_path / "captures"), str(tmp_path / "backup")
    inc = os.path.join(cap, "incoming"); os.makedirs(inc)
    with open(os.path.join(inc, "half.dat"), "w") as f:
        f.write("partial")
    assert nightarchive.mirror_subtree(cap, "incoming", dest) == 0
    assert not os.path.exists(os.path.join(dest, "incoming"))


def test_a_night_directory_is_never_mirrored_as_a_subtree(tmp_path):
    """Nights go through archive_night, which has the marker + growth logic. Routing one through here
    would mirror an ACTIVE night."""
    cap, dest = str(tmp_path / "captures"), str(tmp_path / "backup")
    _night(cap, "2026-07-01", {"a_b_c_20260701010101_ECG.txt": "x"})
    assert nightarchive.mirror_subtree(cap, "2026-07-01", dest) == 0


def test_an_absent_subtree_is_a_no_op(tmp_path):
    cap, dest = str(tmp_path / "captures"), str(tmp_path / "backup")
    os.makedirs(cap)
    assert nightarchive.mirror_subtree(cap, "stored", dest) == 0


def test_mirrored_subtrees_are_still_not_prunable(tmp_path):
    """THE constraint. 'We mirror it now' is exactly the reasoning that would later license deleting
    it — the same loop the F1 fix just removed. plan_prune only ever sees list_nights; assert it."""
    cap = str(tmp_path / "captures")
    os.makedirs(os.path.join(cap, "stored"))
    _night(cap, "2026-01-01", {"a_b_c_20260101010101_ECG.txt": "x"})
    _night(cap, "2026-07-01", {"a_b_c_20260701010101_ECG.txt": "x"})
    assert "stored" not in diskguard.list_nights(cap)
    assert "stored" not in diskguard.plan_prune(diskguard.list_nights(cap), 1, set())


def test_uncovered_subtrees_stops_reporting_what_is_now_covered(tmp_path):
    """The reporter becomes the guard for the NEXT subtree someone adds, so it must subtract the ones
    actually being mirrored — otherwise it cries wolf forever and stops being read."""
    cap = str(tmp_path / "captures")
    for name in ("stored", "cpap", "surprise"):
        d = os.path.join(cap, name); os.makedirs(d)
        with open(os.path.join(d, "x.bin"), "w") as f:
            f.write("data")
    got = [g["name"] for g in nightarchive.uncovered_subtrees(cap, covered=("stored", "cpap"))]
    assert got == ["surprise"]


def test_rel_files_enumeration_is_SORTED_not_merely_readdir_order(tmp_path, monkeypatch):
    """The docstring calls this THE SHARED ENUMERATOR and promises `sorted`. Nothing held that.

    `archive_night` copies this set and `_mirror_matches` confirms this set, so their agreement is the
    whole point of the function (audit F1). Both happen to iterate rather than compare sequences, so
    dropping `sorted()` fails SAFE today — but "safe today, by the shape of two callers" is exactly the
    coincidence F1 removed, and the next caller that diffs two enumerations inherits a set that is
    ordered by `readdir`. `os.walk` is driven out of order here deliberately: a real filesystem's order
    is incidental, so a test that relies on it gates nothing on the machine where it happens to sort.
    """
    d = _night(str(tmp_path / "captures"), "2026-07-20", {})
    os.makedirs(os.path.join(d, "sub"), exist_ok=True)
    for rel in ("a_ECG.txt", "b_PPG.txt", "c_ACC.txt", os.path.join("sub", "d_HR.txt")):
        with open(os.path.join(d, rel), "w") as f:
            f.write("x")

    real_walk = os.walk

    def _reversed_walk(top, **kw):
        # same tree, worst-case order — every directory's file list handed back backwards
        for dirpath, dirnames, filenames in real_walk(top, **kw):
            yield dirpath, dirnames, sorted(filenames, reverse=True)

    monkeypatch.setattr(nightarchive.os, "walk", _reversed_walk)
    got = nightarchive.rel_files(d)
    assert got == ["a_ECG.txt", "b_PPG.txt", "c_ACC.txt", os.path.join("sub", "d_HR.txt")], (
        f"rel_files returned readdir order, not sorted order: {got}"
    )


# ── pending_nights: the marker is not a one-way latch (DEEP-AUDIT §C4) ──────────────────────────────
def test_a_night_that_grew_after_its_marker_is_offered_again(tmp_path):
    """§C4, measured on the real box: 7 of 11 nights had a premature-archive window because
    `writers.night_dir` keys on the SESSION'S START DATE, so a morning session and that evening's
    session share one YYYY-MM-DD dir with a multi-hour lull between them. During the lull the night
    looks finished, gets mirrored, and is marked done — and everything written that evening never
    reaches the mirror, while prune_old_nights deletes the local (and only complete) copy.

    `_grew_since_marker` is what re-offers it, and it needs BOTH arguments: the directory AND the
    marker whose mtime is the comparison point. Dropping the marker compares against nothing."""
    root = str(tmp_path)
    d = _night(root, "2026-07-20", {"a.csv": "morning"})
    # the marker must be NEWER than the night's files for "quiet since mirroring" to hold — the whole
    # test is about what happens when that ordering later reverses
    os.utime(os.path.join(d, "a.csv"), (1000, 1000))
    marker = os.path.join(d, nightarchive._MARKER)
    open(marker, "w").close()
    os.utime(marker, (5000, 5000))

    assert nightarchive.pending_nights(root, active=set()) == [], "quiet since the marker — nothing to do"

    with open(os.path.join(d, "b.csv"), "w") as fh:
        fh.write("evening")
    os.utime(os.path.join(d, "b.csv"), (9000, 9000))
    assert nightarchive.pending_nights(root, active=set()) == ["2026-07-20"], \
        "a night that GREW after its marker must be offered again, or the evening session is lost"


def test_an_active_night_is_skipped_without_abandoning_the_rest(tmp_path):
    """`continue`, not `break`. A session running past midnight leaves TWO in-progress dirs, and the
    active one is usually the LAST by name — breaking there would skip every completed night behind it,
    silently, forever."""
    root = str(tmp_path)
    for n in ("2026-07-18", "2026-07-19", "2026-07-20"):
        _night(root, n, {"a.csv": "x"})
    got = nightarchive.pending_nights(root, active={"2026-07-19"})
    assert got == ["2026-07-18", "2026-07-20"], \
        "the active night is skipped and the ones after it are still offered"


def test_the_marker_is_looked_for_inside_the_night_not_at_the_root(tmp_path):
    """`os.path.join(nd, marker)`. Dropping the directory checks a path relative to the CWD — which
    almost never exists, so every night reads as unmarked and gets re-mirrored on every cycle."""
    root = str(tmp_path)
    d = _night(root, "2026-07-21", {"a.csv": "x"})
    open(os.path.join(d, nightarchive._MARKER), "w").close()
    assert nightarchive.pending_nights(root, active=set()) == [], \
        "the marker inside the night dir must be found"

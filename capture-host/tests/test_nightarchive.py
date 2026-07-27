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

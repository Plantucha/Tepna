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

# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Tests for stitch_31d — the 31-day solid-night stitcher.

CONTRACT (absence): a missing night produces a NULL gap marker row, never a
zero-filled row. A zero is measured data; a gap is absent data. The stitched
timeline must make the discontinuity visible, not fabricate continuity.
"""

import json
import os


import stitch_31d


def _make_night(
    captures: str,
    night: str,
    verdict: str | None,
    files: dict[str, str] | None = None,
) -> str:
    """Create a synthetic night dir with a verdict and optional data files."""
    night_dir = os.path.join(captures, night)
    os.makedirs(night_dir, exist_ok=True)
    if verdict is not None:
        with open(os.path.join(night_dir, "SOLID-VERDICT.json"), "w") as fh:
            json.dump({"status": verdict}, fh)
    for name, content in (files or {}).items():
        with open(os.path.join(night_dir, name), "w") as fh:
            fh.write(content)
    return night_dir


HR_HEADER = "Phone timestamp;HR [bpm];\n"
HR_ROWS_A = "2026-10-16T23:10:08.702;90\n2026-10-16T23:10:09.752;91\n"
HR_ROWS_B = "2026-10-17T23:10:08.702;88\n2026-10-17T23:10:09.752;89\n"


def test_missing_nights_produce_null_gaps_not_zeros(tmp_path):
    """CONTRACT: a night with no matching file gets a null gap marker row.

    The gap row carries the #GAP marker and empty (null) data cells — never
    zeros. Zeros would fabricate measured data where none exists.
    """
    captures = str(tmp_path / "captures")
    os.makedirs(captures)
    # Night A: solid, has the HR file.
    _make_night(
        captures,
        "2026-10-16",
        "PASS",
        {"Polar_H10_02849638_20261016231006_HR.txt": HR_HEADER + HR_ROWS_A},
    )
    # Night B: solid, but the HR file is missing (device not worn).
    _make_night(captures, "2026-10-17", "PASS", {})

    stitched = str(tmp_path / "stitched")
    manifests = stitch_31d.stitch_31d(captures, stitched, max_nights=31)

    tool_dir = os.path.join(stitched, "3corner")
    out_path = os.path.join(tool_dir, "Polar_H10_STITCHED_HR.txt")
    assert os.path.exists(out_path)
    with open(out_path) as fh:
        content = fh.read()

    # Header preserved from the first contributing file.
    assert content.startswith("Phone timestamp;HR [bpm];\n")
    # Night A's data rows present.
    assert "2026-10-16T23:10:08.702;90" in content
    # Night B produces a gap marker row, not data and not zeros.
    assert "#GAP:2026-10-17" in content
    assert ";0\n" not in content.replace(HR_HEADER, ""), "gap must not be zero-filled"
    # No zero HR values fabricated.
    lines = [ln for ln in content.splitlines() if ln and not ln.startswith("Phone")]
    for ln in lines:
        if ln.startswith("#GAP"):
            # Gap row: marker + null (empty) cells.
            cells = ln.split(";")
            assert all(c == "" for c in cells[1:]), f"gap cells must be null, got {cells}"
        else:
            # Data row: HR value is a real measurement, not zero-from-gap.
            assert ln.split(";")[1] != "0" or "2026-10-16" in ln

    # Manifest records the gap.
    manifest = manifests["3corner"]
    hr_info = manifest["inputs"]["Polar_H10_*_HR.txt"]
    assert hr_info["contributing"] == ["2026-10-16"]
    assert hr_info["gaps"] == ["2026-10-17"]


def test_manifest_lists_contributing_vs_gap_nights(tmp_path):
    """The manifest distinguishes nights that contributed from null gaps."""
    captures = str(tmp_path / "captures")
    os.makedirs(captures)
    _make_night(
        captures,
        "2026-10-14",
        "PASS",
        {"Polar_H10_02849638_20261014231006_HR.txt": HR_HEADER + HR_ROWS_A},
    )
    _make_night(
        captures,
        "2026-10-15",
        "PASS",
        {"Polar_H10_02849638_20261015231006_HR.txt": HR_HEADER + HR_ROWS_B},
    )
    # Non-PASS nights are excluded from the stitch entirely.
    _make_night(captures, "2026-10-13", "NOT_APPLICABLE", {})

    stitched = str(tmp_path / "stitched")
    manifests = stitch_31d.stitch_31d(captures, stitched, max_nights=31)

    assert manifests["3corner"]["nights"] == ["2026-10-14", "2026-10-15"]
    # Manifest file written to disk.
    manifest_path = os.path.join(stitched, "3corner", "MANIFEST.json")
    assert os.path.exists(manifest_path)
    with open(manifest_path) as fh:
        on_disk = json.load(fh)
    assert on_disk["nights"] == ["2026-10-14", "2026-10-15"]


def test_chronological_order_and_single_header(tmp_path):
    """Rows appear in chronological night order; the header appears once."""
    captures = str(tmp_path / "captures")
    os.makedirs(captures)
    # Create nights out of order on disk; the stitch must sort them.
    _make_night(
        captures,
        "2026-10-17",
        "PASS",
        {"Polar_H10_X_HR.txt": HR_HEADER + HR_ROWS_B},
    )
    _make_night(
        captures,
        "2026-10-16",
        "PASS",
        {"Polar_H10_X_HR.txt": HR_HEADER + HR_ROWS_A},
    )

    stitched = str(tmp_path / "stitched")
    stitch_31d.stitch_31d(captures, stitched, max_nights=31)

    out_path = os.path.join(stitched, "3corner", "Polar_H10_STITCHED_HR.txt")
    with open(out_path) as fh:
        lines = fh.read().splitlines()

    # Header appears exactly once.
    headers = [ln for ln in lines if ln.startswith("Phone timestamp")]
    assert len(headers) == 1
    # 10-16 rows come before 10-17 rows.
    idx_a = next(i for i, ln in enumerate(lines) if "2026-10-16T23:10:08" in ln)
    idx_b = next(i for i, ln in enumerate(lines) if "2026-10-17T23:10:08" in ln)
    assert idx_a < idx_b


def test_max_nights_limits_window(tmp_path):
    """Only the last `max_nights` solid nights are stitched."""
    captures = str(tmp_path / "captures")
    os.makedirs(captures)
    for day in range(10, 16):
        _make_night(captures, f"2026-10-{day:02d}", "PASS", {})

    stitched = str(tmp_path / "stitched")
    manifests = stitch_31d.stitch_31d(captures, stitched, max_nights=3)

    assert manifests["3corner"]["nights"] == [
        "2026-10-13",
        "2026-10-14",
        "2026-10-15",
    ]


def test_solid_nights_skips_non_pass(tmp_path):
    """FAIL, UNKNOWN, and missing verdicts are excluded from the stitch."""
    captures = str(tmp_path / "captures")
    os.makedirs(captures)
    _make_night(captures, "2026-10-10", "FAIL", {})
    _make_night(captures, "2026-10-11", "UNKNOWN", {})
    _make_night(captures, "2026-10-12", None, {})  # no verdict file
    _make_night(captures, "2026-10-13", "PASS", {})

    nights = stitch_31d.solid_nights(captures, max_nights=31)
    assert nights == ["2026-10-13"]


def test_sidecars_collected_per_night(tmp_path):
    """Sidecars: CLOCKSYNC.csv skew and LOSS-AUDIT.json wear land in SIDECARS.json.

    The runner needs per-night clock offsets to align timebases across nights.
    Missing sidecar files yield absent (not fabricated) entries.
    """
    captures = str(tmp_path / "captures")
    os.makedirs(captures)
    # Night with both sidecars.
    _make_night(
        captures,
        "2026-10-16",
        "PASS",
        files={
            "Polar_H10_1_HR.txt": HR_HEADER + HR_ROWS_A,
            "CLOCKSYNC.csv": (
                "Phone timestamp;device;address;event;skew_sec;detail\n"
                "2026-10-16T04:24:48.306;Polar H10 02849638;24:AC:AC:02:84:96;synced;1.25;ok\n"
                "2026-10-16T04:25:34.236;Polar Sense 0C301E3F;24:AC:AC:0C:30:1E;synced;-0.75;ok\n"
            ),
            "LOSS-AUDIT.json": json.dumps(
                {
                    "devices": {
                        "Polar H10 02849638": {"span_min": 480, "lost_min": 2.5},
                    }
                }
            ),
        },
    )
    # Night with no sidecars: absent, not fabricated.
    _make_night(
        captures,
        "2026-10-17",
        "PASS",
        files={"Polar_H10_1_HR.txt": HR_HEADER + HR_ROWS_B},
    )
    stitched = str(tmp_path / "stitched")
    stitch_31d.stitch_31d(captures, stitched, max_nights=31)

    # SIDECARS.json exists per tool and carries per-night data.
    for tool in stitch_31d.TOOLS:
        spath = os.path.join(stitched, tool, "SIDECARS.json")
        assert os.path.exists(spath), f"missing SIDECARS.json for {tool}"
        with open(spath) as fh:
            sc = json.load(fh)
        assert sc["nights"] == ["2026-10-16", "2026-10-17"]
        # Night with sidecars: offsets and wear recorded.
        n16 = sc["sidecars"]["2026-10-16"]
        assert n16["clock_offsets"]["Polar H10 02849638"] == 1.25
        assert n16["clock_offsets"]["Polar Sense 0C301E3F"] == -0.75
        assert n16["wear"]["Polar H10 02849638"]["span_min"] == 480
        # Night without sidecars: empty, not fabricated.
        n17 = sc["sidecars"]["2026-10-17"]
        assert n17["clock_offsets"] == {}
        assert n17["wear"] == {}


def test_collect_sidecars_handles_malformed(tmp_path):
    """Malformed sidecars yield absent entries, never exceptions or zeros."""
    night_dir = str(tmp_path / "night")
    os.makedirs(night_dir)
    # Malformed CLOCKSYNC (no skew column) and malformed JSON.
    with open(os.path.join(night_dir, "CLOCKSYNC.csv"), "w") as fh:
        fh.write("Phone timestamp;device\n2026-10-16T04:24:48.306;H10\n")
    with open(os.path.join(night_dir, "LOSS-AUDIT.json"), "w") as fh:
        fh.write("{not json")
    sc = stitch_31d.collect_sidecars(night_dir)
    assert sc["clock_offsets"] == {}
    assert sc["wear"] == {}

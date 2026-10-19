# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""stitch_31d — stitch the last 31 solid nights' inputs per fused tool.

When a new solid-night PASS verdict lands, this module concatenates the input
files for each fused tool across the last 31 solid nights into
`<stitched_dir>/<tool>/`. Missing nights (not solid, no data) produce NULL gap
marker rows — never zero-filled. A zero is measured data; a gap is absent data,
and the two must never be confused (absence contract).

Each tool gets:
  - one concatenated file per input type (header from first file, data rows appended)
  - a MANIFEST.json listing contributing nights and null-gap nights

The stitched output feeds the server-side 31-day compute; the browser never
sees the raw multi-GB concatenation.
"""

from __future__ import annotations

import fnmatch
import json
import os
from typing import Any

TOOL = "capture-host/stitch_31d.py"
VERDICT_NAME = "SOLID-VERDICT.json"
MANIFEST_NAME = "MANIFEST.json"
GAP_MARKER = "#GAP"

#: Fused tools and their input file glob patterns (from nights_index.DERIVED,
#: extended with the PAT pairwise legs the owner ordered 2026-10-17).
TOOLS: dict[str, tuple[str, ...]] = {
    "3corner": (
        "Polar_H10_*_HR.txt",
        "Polar_VeritySense_*_PPG.txt",
        "Wellue_O2Ring-S_*_SPO2.csv",
    ),
    "3corner_fused": (
        "Polar_H10_*_HR.txt",
        "Polar_VeritySense_*_PPG.txt",
        "Wellue_O2Ring-S_*_SPO2.csv",
    ),
    "pat_h10_verity": (
        "Polar_H10_*_ECG.txt",
        "Polar_VeritySense_*_PPG.txt",
    ),
    "pat_h10_o2ring": (
        "Polar_H10_*_ECG.txt",
        "Wellue_O2Ring-S_*_PPG.txt",
    ),
    "pat_verity_o2ring": (
        "Polar_VeritySense_*_PPG.txt",
        "Wellue_O2Ring-S_*_PPG.txt",
    ),
    "pat_fused": (
        "Polar_H10_*_ECG.txt",
        "Polar_VeritySense_*_PPG.txt",
        "Wellue_O2Ring-S_*_PPG.txt",
    ),
}


def _verdict_status(night_dir: str) -> str | None:
    """Read a night's SOLID-VERDICT.json status, or None if absent/unreadable."""
    path = os.path.join(night_dir, VERDICT_NAME)
    try:
        with open(path, encoding="utf-8") as fh:
            obj = json.load(fh)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    status = obj.get("status")
    return status if isinstance(status, str) else None


SIDECARS_NAME = "SIDECARS.json"


def collect_sidecars(night_dir: str) -> dict[str, Any]:
    """Collect clock offsets and wear intervals for one night.

    Reads CLOCKSYNC.csv for per-device clock skew and LOSS-AUDIT.json for
    wear intervals and gap info. Missing files yield empty dicts, never
    fabricated values (absence contract).
    """
    sidecars: dict[str, Any] = {"clock_offsets": {}, "wear": {}}

    # CLOCKSYNC.csv: Phone timestamp;device;address;event;skew_sec;detail
    # The skew_sec column carries the measured clock offset per sync event.
    # Keep the LAST skew per device (most recent measurement).
    cpath = os.path.join(night_dir, "CLOCKSYNC.csv")
    try:
        with open(cpath, encoding="utf-8", errors="replace") as fh:
            # Column names are stripped, so a CRLF header still finds its last column.
            cols = [c.strip() for c in fh.readline().split(";")]
            if "device" in cols and "skew_sec" in cols:
                dev_i = cols.index("device")
                skew_i = cols.index("skew_sec")
                for line in fh:
                    parts = line.split(";")
                    if len(parts) > max(dev_i, skew_i):
                        dev = parts[dev_i].strip()
                        skew = parts[skew_i].strip()
                        if dev and skew:
                            try:
                                sidecars["clock_offsets"][dev] = float(skew)
                            except ValueError:
                                pass  # empty or non-numeric skew: absent, not zero
    except OSError:
        pass  # no clock record: offsets stay absent

    # LOSS-AUDIT.json: per-device wear intervals and gap accounting.
    apath = os.path.join(night_dir, "LOSS-AUDIT.json")
    try:
        with open(apath, encoding="utf-8") as fh:
            audit = json.load(fh)
        devices = audit.get("devices")
        if isinstance(devices, dict):
            for dev_name, info in devices.items():
                if not isinstance(info, dict):
                    continue
                wear: dict[str, Any] = {}
                # Copy the fields the runner needs; absent keys stay absent.
                for key in (
                    "span_min",
                    "gap_cut_s",
                    "fragments",
                    "boundary_gaps",
                    "unwitnessed_min",
                    "lost_min",
                    "by_cause",
                    "wear_start",
                    "wear_end",
                ):
                    if key in info:
                        wear[key] = info[key]
                sidecars["wear"][dev_name] = wear
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        pass  # no audit: wear stays absent

    return sidecars


def solid_nights(captures_dir: str, max_nights: int = 31) -> list[str]:
    """Return the last `max_nights` night directory names with a PASS verdict.

    Sorted oldest-first. Nights without a readable PASS verdict are excluded —
    they become null gaps in the stitch, not silent inclusions.
    """
    try:
        entries = sorted(os.listdir(captures_dir))
    except OSError:
        return []
    solid: list[str] = []
    for name in entries:
        # Night dirs are YYYY-MM-DD; skip anything else.
        if len(name) != 10 or name[4] != "-" or name[7] != "-":
            continue
        night_dir = os.path.join(captures_dir, name)
        if not os.path.isdir(night_dir):
            continue
        if _verdict_status(night_dir) == "PASS":
            solid.append(name)
    return solid[-max_nights:]


def _find_input(night_dir: str, pattern: str) -> str | None:
    """Find the first file in `night_dir` matching `pattern`, or None."""
    try:
        names = sorted(os.listdir(night_dir))
    except OSError:
        return None
    for name in names:
        if fnmatch.fnmatch(name, pattern):
            return os.path.join(night_dir, name)
    return None


def _detect_delimiter(header: str) -> str:
    """Detect `;` vs `,` delimiter from a header line: the more frequent one wins, `;` on a tie."""
    return ";" if header.count(";") >= header.count(",") else ","


def _gap_row(ncols: int, delimiter: str, night: str) -> str:
    """Build a null gap marker row: marker in column 0, empty (null) elsewhere.

    Never zeros — a zero is measured data, a gap is absent data.
    """
    cells = [f"{GAP_MARKER}:{night}"] + [""] * (ncols - 1)
    return delimiter.join(cells) + "\n"


#: Beside each tool's outputs: what the last stitch read, and the manifest it wrote. A stitch whose
#: inputs have not moved since is skipped. Measured on vigil 2026-10-19: every PASS verdict rewrote
#: all six tools, 19 GB, even when the re-judged night was already solid and the set had not changed.
KEY_NAME = "STITCH-KEY.json"


def _sources(captures_dir: str, patterns: tuple[str, ...], nights: list[str]) -> dict[str, list]:
    """`{pattern: [[night, name, size, mtime_ns] | [night, None, None, None], ...]}` — what a stitch would read.

    Stats only, never the data, so a skipped stitch costs a directory listing per night."""
    out: dict[str, list] = {}
    for pattern in patterns:
        rows: list = []
        for night in nights:
            src = _find_input(os.path.join(captures_dir, night), pattern)
            try:
                st = os.stat(src) if src is not None else None
            except OSError:
                st = None
            if st is None or src is None:
                rows.append([night, None, None, None])
            else:
                rows.append([night, os.path.basename(src), st.st_size, st.st_mtime_ns])
        out[pattern] = rows
    return out


def _stored(tool_dir: str, sources: dict[str, list], patterns: tuple[str, ...]) -> dict[str, Any] | None:
    """The manifest the last stitch wrote, when it read exactly `sources` and every output is still there."""
    try:
        with open(os.path.join(tool_dir, KEY_NAME), encoding="utf-8") as fh:
            key = json.load(fh)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(key, dict) or key.get("sources") != sources:
        return None
    for pattern in patterns:
        if not os.path.exists(os.path.join(tool_dir, pattern.replace("*", "STITCHED"))):
            return None
    manifest = key.get("manifest")
    return manifest if isinstance(manifest, dict) else None


def stitch_tool(
    captures_dir: str,
    tool_dir: str,
    patterns: tuple[str, ...],
    nights: list[str],
) -> dict[str, Any]:
    """Stitch one tool's inputs across `nights` into `tool_dir`.

    Returns the manifest dict. For each input pattern, writes one concatenated
    file: header from the first contributing night's file, data rows appended
    in chronological night order. Nights with no matching file get a null gap
    marker row instead of data.

    🔴 STREAMED, ONE LINE AT A TIME. This read every row of 31 nights into one list before writing:
    the H10 ECG output alone is 2.8 GB of text, so the child's peak was several times that. On vigil
    2026-10-19 that peak swapped the capture daemon out, and its event loop stalled 15.7, 25.1 and
    25.4 s. Each output is written to a temporary name and renamed when complete, so a reader never
    sees half a file. A night that fails mid-read is cut back to where it started and becomes a gap.
    """
    os.makedirs(tool_dir, exist_ok=True)
    sources = _sources(captures_dir, patterns, nights)
    stored = _stored(tool_dir, sources, patterns)
    if stored is not None:
        return stored
    key_path = os.path.join(tool_dir, KEY_NAME)
    if os.path.exists(key_path):
        os.remove(key_path)  # a key must never outlive the outputs it describes
    manifest: dict[str, Any] = {
        "tool": TOOL,
        "nights": nights,
        "inputs": {},
    }

    for pattern in patterns:
        # Derive a stable output filename from the pattern (strip the *).
        out_name = pattern.replace("*", "STITCHED")
        out_path = os.path.join(tool_dir, out_name)
        tmp_path = out_path + ".tmp"
        contributing: list[str] = []
        gaps: list[str] = []
        # (delimiter, column count), set with the first header; a gap row needs both.
        fmt: tuple[str, int] | None = None

        with open(tmp_path, "w", encoding="utf-8") as out:
            for night in nights:
                night_dir = os.path.join(captures_dir, night)
                src = _find_input(night_dir, pattern)
                mark, held = out.tell(), fmt
                try:
                    if src is None:
                        raise FileNotFoundError  # caught below; only its type is read
                    with open(src, encoding="utf-8", errors="replace") as fh:
                        first = fh.readline()
                        if not first:
                            raise EOFError  # caught below; only its type is read
                        if fmt is None:
                            header = first.rstrip("\n")
                            delimiter = _detect_delimiter(header)
                            fmt = (delimiter, len(header.split(delimiter)))
                            out.write(header + "\n")
                        for line in fh:
                            stripped = line.rstrip("\n")
                            if stripped:
                                out.write(stripped + "\n")
                except (OSError, EOFError):
                    out.seek(mark)
                    out.truncate()
                    fmt = held  # a header this night wrote went with it
                    gaps.append(night)
                    # Gap row needs column count; use the header's if known.
                    if fmt is not None:
                        out.write(_gap_row(fmt[1], fmt[0], night))
                    continue
                contributing.append(night)
        os.replace(tmp_path, out_path)

        manifest["inputs"][pattern] = {
            "output": out_name,
            "contributing": contributing,
            "gaps": gaps,
        }

    with open(key_path, "w", encoding="utf-8") as fh:
        json.dump({"sources": sources, "manifest": manifest}, fh)
        fh.write("\n")
    return manifest


def stitch_31d(
    captures_dir: str,
    stitched_dir: str,
    max_nights: int = 31,
) -> dict[str, dict[str, Any]]:
    """Stitch the last `max_nights` solid nights for every fused tool.

    Returns a dict of tool name -> manifest. Each tool's output lands in
    `<stitched_dir>/<tool>/` with a MANIFEST.json beside the concatenated files.
    """
    nights = solid_nights(captures_dir, max_nights)
    os.makedirs(stitched_dir, exist_ok=True)
    # Collect sidecars once: clock offsets and wear intervals per night.
    # The runner needs these to align timebases across nights before feeding
    # the engine; without clock sync the 31-day stitch drifts.
    sidecars: dict[str, dict[str, Any]] = {}
    for night in nights:
        sidecars[night] = collect_sidecars(os.path.join(captures_dir, night))
    manifests: dict[str, dict[str, Any]] = {}
    for tool, patterns in TOOLS.items():
        tool_dir = os.path.join(stitched_dir, tool)
        manifest = stitch_tool(captures_dir, tool_dir, patterns, nights)
        manifest_path = os.path.join(tool_dir, MANIFEST_NAME)
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2)
            fh.write("\n")
        # SIDECARS.json beside MANIFEST.json: per-night clock offsets and
        # wear intervals for this tool's nights.
        sidecars_path = os.path.join(tool_dir, SIDECARS_NAME)
        with open(sidecars_path, "w", encoding="utf-8") as fh:
            json.dump({"nights": nights, "sidecars": sidecars}, fh, indent=2)
            fh.write("\n")
        manifests[tool] = manifest
    return manifests


def _verdict_sample(commit=None, at=None):
    """The `--verdict-sample` object the adoption gate reads, built and validated by `verdict.make`."""
    import verdict as VD

    return VD.make(
        gate="stitch-31d",
        status="PASS",
        population={"checked": 6, "eligible": 6, "excluded": 0},
        criterion={
            "name": "six fused tools stitched with null gaps",
            "threshold": 6,
            "unit": "tools",
            "direction": "eq",
        },
        result={"tools": list(TOOLS.keys()), "gaps_are_null": True},
        evidence=["capture-host/stitch_31d.py", "capture-host/tests/test_stitch_31d.py"],
        reason=None,
        tool=TOOL,
        commit=commit,
        at=at,
    )


if __name__ == "__main__":
    import sys

    if "--verdict-sample" in sys.argv:
        print(json.dumps(_verdict_sample(), indent=2))

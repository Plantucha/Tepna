# tepna-capture — nights_index.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The NIGHTS index behind the monitor's Ledger and Capture pages: every night on the box, per analyzer —
what is on disk for it (bytes, files) and how many hours its primary stream covers.

READ-ONLY and DERIVED. Nothing here interprets a signal: a cell is the size of the files an analyzer
would ingest and the wall-clock span between the first and last stamp of its primary stream. "Hours"
is COVERAGE, not quality (§∅: an absent stream is `None`, never 0; a stream whose stamps cannot be read
carries `hours: None` beside its real byte count). The monitor turns a cell into a click that opens the
analyzer with exactly `files` loaded, so the file lists here ARE the ingest — keep them to what each
analyzer's own input accepts (the accept= of its file input), not to everything that mentions the node.

Two stamp layouts are read, both the Clock Contract's: the ISO `YYYY-MM-DDTHH:MM:SS…` every Polar /
sidecar file starts a row with, and the O2Ring vendor layout `HH:MM:SS DD/MM/YYYY` of `_SPO2.csv`
(`parseTimestamp` §2.4, DMY). An EDF's span is `records × record_duration` from its own header."""
from __future__ import annotations

import datetime as _dt
import glob
import os
import re

# analyzer -> (input globs relative to the night dir — `{ymd}` for the CPAP trees keyed by date —, the
# primary glob whose first→last stamp is the covered span). The list order is the ingest order.
# A pattern is one glob, or a tuple of ALTERNATIVE globs: the first alternative with files wins and the
# others are ignored for that night. The CPAP night exists twice on the box — `cpap/` is the SD-card set
# (BRP + PLD + SA2 + EVE + CSL) and `cpap-ble/` the BLE pull of the same session's BRP — and handing both
# to CPAPDex doubled the night (measured 2026-09-19: "14.3 h therapy · 2 sessions" for a 7.2 h night).
# One tree per night; the SD set when it is there, the BLE pull otherwise.
Pattern = str | tuple[str, ...]
CPAP_EDF: tuple[str, ...] = ("cpap/DATALOG/{ymd}/*.edf", "cpap-ble/DATALOG/{ymd}/*.edf")
CPAP_BRP: tuple[str, ...] = ("cpap/DATALOG/{ymd}/*_BRP.edf", "cpap-ble/DATALOG/{ymd}/*_BRP.edf")
NODES: dict[str, tuple[tuple[Pattern, ...], Pattern | None]] = {
    "ECGDex":     (("Polar_H10_*_ECG.txt", "Polar_H10_*_ACC.txt", "Polar_H10_*_HR.txt", "Polar_H10_*_RR.txt"),
                   "Polar_H10_*_ECG.txt"),
    "OxyDex":     (("Wellue_O2Ring-S_*_SPO2.csv",), "Wellue_O2Ring-S_*_SPO2.csv"),
    "PPGDex":     (("Polar_VeritySense_*_PPG.txt", "Polar_VeritySense_*_PPI.txt",
                    "Wellue_O2Ring-S_*_PPG.txt", "Wellue_O2Ring-S_*_PPG2W.txt"),
                   "Polar_VeritySense_*_PPG.txt"),
    "PulseDex":   (("Polar_VeritySense_*_PPI.txt", "Polar_H10_*_RR.txt"), "Polar_VeritySense_*_PPI.txt"),
    "CPAPDex":    ((CPAP_EDF,), CPAP_BRP),
    "MotionDex":  (("Polar_H10_*_ACC.txt", "Polar_VeritySense_*_ACC.txt", "Wellue_O2Ring-S_*_ACCRAW.txt"),
                   "Polar_VeritySense_*_ACC.txt"),
    "GlucoDex":   ((), None),                       # no CGM on the box — always absent, never a fabricated 0
    # HRVDex ingests Welltory CSV or an ECGDex EXPORT — never a raw Polar file (a raw RR.txt handed to
    # it is dropped without a word, measured 2026-09-20). The box holds neither, so like the
    # Integrator its cell is the raw input that reaches it through ECGDex, and it is not offered as a click.
    "HRVDex":     (("Polar_H10_*_HR.txt", "Polar_H10_*_RR.txt", "Polar_VeritySense_*_PPI.txt"), "Polar_H10_*_RR.txt"),
    "EEGDex":     ((), None),                       # no Muse on the box
    # The Integrator ingests NODE EXPORTS (ganglior.node-export JSON), which the box does not hold —
    # folds run on rig (tools/trio-batch.mjs). Its cell is the raw input it WOULD fold, marked
    # `loadable: False` so the monitor shows the figure and does not offer a click.
    "Integrator": (("Polar_H10_*_ECG.txt", "Polar_VeritySense_*_PPG.txt", "Wellue_O2Ring-S_*_SPO2.csv",
                    "Polar_*_ACC.txt", CPAP_EDF), "Polar_VeritySense_*_PPG.txt"),
}
NOT_LOADABLE = frozenset({"Integrator", "HRVDex"})
# derived tools: eligible when every required input exists; they open with those inputs loaded
DERIVED: dict[str, tuple[str, ...]] = {
    # the hat's O2Ring corner is the ring's PULSE from its _SPO2.csv (sensor-trio-power-analysis.js role `o2`), not the
    # ring's raw PPG waveform — a ✓ must mean the tool can run, so the requirement names the file it reads
    "3 corner hat": ("Polar_H10_*_HR.txt", "Polar_VeritySense_*_PPG.txt", "Wellue_O2Ring-S_*_SPO2.csv"),
    "PAT":          ("Polar_H10_*_ECG.txt", "Polar_VeritySense_*_PPG.txt"),
}
COLUMNS = tuple(NODES) + tuple(DERIVED)

_ISO = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})")
_O2 = re.compile(r"^(\d{2}):(\d{2}):(\d{2}) (\d{2})/(\d{2})/(\d{4})")      # HH:MM:SS DD/MM/YYYY (DMY)
_NIGHT = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_stamp(line: str) -> _dt.datetime | None:
    """The row's stamp in the two layouts the box writes, or None — never a fabricated time."""
    m = _ISO.match(line)
    if m:
        return _dt.datetime.fromisoformat(m.group(1))
    m = _O2.match(line)
    if m:
        hh, mm, ss, d, mo, y = (int(x) for x in m.groups())
        try:
            return _dt.datetime(y, mo, d, hh, mm, ss)
        except ValueError:
            return None
    return None


def span_hours(path: str, head_lines: int = 20, tail_bytes: int = 4096) -> float | None:
    """Hours between the first and last stamped rows of a text stream, reading only the head and the
    tail — a 400 MB ECG file costs two small reads. None when either end has no stamp (an empty or
    header-only file, a layout this does not know) or the span is not positive."""
    try:
        with open(path, "rb") as fh:
            first = None
            for ln in (fh.readline() for _ in range(head_lines)):
                first = parse_stamp(ln.decode("utf-8", "replace")) if ln else None
                if first or not ln:
                    break
            if first is None:
                return None
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - tail_bytes))
            tail = fh.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return None
    last = None
    for text in reversed(tail):
        last = parse_stamp(text)
        if last:
            break
    if last is None:
        return None
    hours = (last - first).total_seconds() / 3600.0
    return round(hours, 2) if hours > 0 else None


def edf_hours(path: str) -> float | None:
    """`records × record duration` from the EDF header (bytes 236–252) — the file's own account of its
    span. None for an unreadable header or a non-positive product."""
    try:
        with open(path, "rb") as fh:
            hdr = fh.read(256)
        n = int(hdr[236:244])
        dur = float(hdr[244:252])
    except (OSError, ValueError):
        return None
    hours = n * dur / 3600.0
    return round(hours, 2) if hours > 0 else None


def _expand(root: str, night_dir: str, pattern: str) -> list[str]:
    ymd = os.path.basename(night_dir).replace("-", "")
    base = root if "/" in pattern else night_dir
    return sorted(p for p in glob.glob(os.path.join(base, pattern.format(ymd=ymd))) if os.path.isfile(p))


def _expand_alt(root: str, night_dir: str, pat: Pattern, pick: int | None = None) -> tuple[list[str], int | None]:
    """A plain glob expands as is (index None). Alternatives expand to the FIRST one with files and its
    index — or, with `pick`, to exactly that alternative, so a primary reads from the tree the files came from."""
    if isinstance(pat, str):
        return _expand(root, night_dir, pat), None
    if pick is not None:
        return _expand(root, night_dir, pat[pick]), pick
    for i, p in enumerate(pat):
        got = _expand(root, night_dir, p)
        if got:
            return got, i
    return [], None


def night_entry(root: str, night_dir: str) -> dict:
    """One night, every column. A node with no input is `None`; a derived tool is True/False."""
    out: dict = {"night": os.path.basename(night_dir)}
    for node, (patterns, primary) in NODES.items():
        files: list[str] = []
        tree: int | None = None
        for p in patterns:
            got, i = _expand_alt(root, night_dir, p)
            files += got
            tree = i if tree is None else tree
        files = sorted(set(files))
        if not files:
            out[node] = None
            continue
        hours = None
        prims = _expand_alt(root, night_dir, primary, tree)[0] if primary else []
        if prims:
            f = max(prims, key=os.path.getsize)
            hours = edf_hours(f) if f.lower().endswith(".edf") else span_hours(f)
        out[node] = {
            "bytes": sum(os.path.getsize(f) for f in files),
            "hours": hours,
            "files": [os.path.relpath(f, root) for f in files],
            "loadable": node not in NOT_LOADABLE,
        }
    for tool, required in DERIVED.items():
        out[tool] = all(_expand(root, night_dir, p) for p in required)
    return out


def list_nights(root: str) -> list[str]:
    captures = os.path.join(root, "captures")
    try:
        names = os.listdir(captures)
    except OSError:
        return []
    return sorted(os.path.join(captures, n) for n in names
                  if _NIGHT.match(n) and os.path.isdir(os.path.join(captures, n)))


def index_nights(root: str, limit: int = 60) -> list[dict]:
    """The newest `limit` nights, oldest first. `root` is the box root (`config.root`); its `captures/`
    holds the night directories and the CPAP trees the CPAPDex globs reach into."""
    nights = list_nights(root)
    captures = os.path.join(root, "captures")
    return [night_entry(captures, d) for d in nights[-max(1, limit):]]

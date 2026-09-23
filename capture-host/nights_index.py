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
import json
import os
import re
import time

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


# ── FRAGMENTS + COVERAGE: the span hides a torn night ─────────────────────────────────────────────────
# 2026-09-20 and 2026-09-17 both read "6.1 h" while the 09-20 H10 held 41 % of its samples — the link had
# dropped 151 times (the not-worn power drop on a dry strap) and first→last span cannot see that. So the
# primary stream also reports how many CONTIGUOUS stretches it holds and what fraction of the span they
# cover: a gap is a step of more than GAP_S between consecutive stamps (BLE delivers ~1 s buffers, so 2 s
# is above any normal arrival jitter and below any reconnect), fragments = gaps + 1, coverage =
# 1 − Σgaps / span. The gap threshold is RELATIVE to the stream's own delivery cadence — max(GAP_S,
# 5 × the 95th-percentile step over the first 2 000 rows) — because "consecutive rows" arrive very
# differently per stream: ECG/PPG in ~1 s BLE buffers, the ring's CSV at 1 Hz, the Verity PPI in ~5 s
# batches that share one stamp (a fixed 2 s cut read that stream as 4 434 fragments at 0 % coverage,
# and the ring's one-sample hiccups as 40). A reconnect is ≥ 90 s, far above any of them.
# That is a pass over every stamp, seconds per night, so results are cached per file
# (keyed on size + mtime — a captured file never changes, only grows) in `<root>/run/`, and a request
# computes only what fits in its time budget; the rest reads `pending` and the page asks again.
GAP_S = 2.0
_CACHE_NAME = "nights-index-cache.json"
_cache: dict[str, dict] = {}
_cache_loaded_from: str | None = None


def _cache_path(captures: str) -> str:
    return os.path.join(os.path.dirname(captures.rstrip("/")), "run", _CACHE_NAME)


def _cache_load(captures: str) -> None:
    global _cache_loaded_from
    path = _cache_path(captures)
    if _cache_loaded_from == path:
        return
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        _cache.clear()
        _cache.update(data if isinstance(data, dict) else {})
    except (OSError, ValueError):
        _cache.clear()
    _cache_loaded_from = path


def _cache_save(captures: str) -> None:
    path = _cache_path(captures)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(_cache, fh)
        os.replace(tmp, path)
    except OSError:
        pass                        # a cache that cannot be written is recomputed next time, not an error


def _row_seconds(line: str, iso: bool) -> float | None:
    """Seconds since midnight from a row's stamp, by SLICE — a regex per row costs 10× on a 3 M-row file.
    ISO rows carry `YYYY-MM-DDTHH:MM:SS.mmm`, the ring's CSV `HH:MM:SS DD/MM/YYYY`."""
    try:
        if iso:
            return int(line[11:13]) * 3600 + int(line[14:16]) * 60 + float(line[17:23])
        return int(line[0:2]) * 3600 + int(line[3:5]) * 60 + int(line[6:8])
    except ValueError:
        return None


def _cadence_gap(path: str, head_rows: int = 2000, floor: float = GAP_S) -> float:
    """The gap threshold for this stream: max(floor, 5 × p95 of the inter-row steps over the head)."""
    steps: list[float] = []
    prev: float | None = None
    iso: bool | None = None
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if iso is None:
                    if _ISO.match(line):
                        iso = True
                    elif _O2.match(line):
                        iso = False
                    else:
                        continue
                t = _row_seconds(line, iso)
                if t is None:
                    continue
                if prev is not None and t >= prev:
                    steps.append(t - prev)
                prev = t
                if len(steps) >= head_rows:
                    break
    except OSError:
        return floor
    if len(steps) < 20:              # too few rows to know the cadence: the floor is the honest cut
        return floor
    steps.sort()
    return max(floor, 5.0 * steps[min(len(steps) - 1, int(0.95 * len(steps)))])


def stream_stats(path: str, gap_s: float | None = None) -> dict | None:
    """{fragments, coverage, span_s, gap_s} for a stamped text stream — one pass over its stamps. None
    when the stream has no readable stamps. Midnight wrap: a stamp that steps back by more than 12 h is
    the next day. `gap_s` defaults to the stream's own cadence threshold (`_cadence_gap`)."""
    if gap_s is None:
        gap_s = _cadence_gap(path)
    frags = 1
    gaps = 0.0
    first: float | None = None
    prev: float | None = None
    iso: bool | None = None
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if iso is None:
                    if _ISO.match(line):
                        iso = True
                    elif _O2.match(line):
                        iso = False
                    else:
                        continue
                t = _row_seconds(line, iso)
                if t is None:
                    continue
                if prev is None:
                    first = t
                else:
                    if t < prev - 43200:
                        t += 86400.0        # past midnight: every later row reads small and gets the same day
                    if t - prev > gap_s:
                        frags += 1
                        gaps += t - prev
                prev = t
    except OSError:
        return None
    if first is None or prev is None or prev <= first:
        return None
    span = prev - first
    return {"fragments": frags, "coverage": round(max(0.0, 1.0 - gaps / span), 3), "span_s": round(span, 1),
            "gap_s": round(gap_s, 2)}


def cached_stats(captures: str, path: str, deadline: float | None) -> tuple[dict | None, bool]:
    """(stats, pending). Cached by relpath + size + mtime; computed now if the deadline allows, else pending."""
    _cache_load(captures)
    rel = os.path.relpath(path, captures)
    try:
        st = os.stat(path)
    except OSError:
        return None, False
    key = f"{st.st_size}:{st.st_mtime_ns}"
    hit = _cache.get(rel)
    if hit and hit.get("key") == key:
        return hit.get("stats"), False
    if deadline is not None and time.monotonic() > deadline:
        return None, True
    stats = stream_stats(path)
    _cache[rel] = {"key": key, "stats": stats}
    _cache_save(captures)
    return stats, False


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


def night_entry(root: str, night_dir: str, deadline: float | None = None) -> dict:
    """One night, every column. A node with no input is `None`; a derived tool is True/False. A node's
    `fragments`/`coverage` come from its primary stream (None for EDF primaries, which have no row
    stamps; `pending: True` when the deadline left no time to compute them yet)."""
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
        stats: dict | None = None
        pending = False
        prims = _expand_alt(root, night_dir, primary, tree)[0] if primary else []
        if prims:
            f = max(prims, key=os.path.getsize)
            if f.lower().endswith(".edf"):
                hours = edf_hours(f)
            else:
                hours = span_hours(f)
                if hours is not None:
                    stats, pending = cached_stats(root, f, deadline)
        out[node] = {
            "bytes": sum(os.path.getsize(f) for f in files),
            "hours": hours,
            "fragments": stats["fragments"] if stats else None,
            "coverage": stats["coverage"] if stats else None,
            "pending": pending,
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


def index_nights(root: str, limit: int = 60, budget_s: float | None = 15.0) -> list[dict]:
    """The newest `limit` nights, oldest first. `root` is the box root (`config.root`); its `captures/`
    holds the night directories and the CPAP trees the CPAPDex globs reach into. `budget_s` bounds the
    fragment/coverage passes this call may run (newest nights first, so the ones being looked at fill
    first); nodes left uncomputed carry `pending: True` and a later call finishes them from the cache."""
    nights = list_nights(root)
    captures = os.path.join(root, "captures")
    deadline = None if budget_s is None else time.monotonic() + budget_s
    picked = nights[-max(1, limit):]
    rows = [night_entry(captures, d, deadline) for d in reversed(picked)]
    return list(reversed(rows))


def pending_count(rows: list[dict]) -> int:
    return sum(1 for r in rows for v in r.values() if isinstance(v, dict) and v.get("pending"))

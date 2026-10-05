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
import hashlib
import glob
import json
import os
import re
import time

import nightqc

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
    "ECGDex": (
        ("Polar_H10_*_ECG.txt", "Polar_H10_*_ACC.txt", "Polar_H10_*_HR.txt", "Polar_H10_*_RR.txt"),
        "Polar_H10_*_ECG.txt",
    ),
    "OxyDex": (("Wellue_O2Ring-S_*_SPO2.csv",), "Wellue_O2Ring-S_*_SPO2.csv"),
    "PPGDex": (
        (
            "Polar_VeritySense_*_PPG.txt",
            "Polar_VeritySense_*_PPI.txt",
            "Wellue_O2Ring-S_*_PPG.txt",
            "Wellue_O2Ring-S_*_PPG2W.txt",
        ),
        "Polar_VeritySense_*_PPG.txt",
    ),
    "PulseDex": (("Polar_VeritySense_*_PPI.txt", "Polar_H10_*_RR.txt"), "Polar_VeritySense_*_PPI.txt"),
    "CPAPDex": ((CPAP_EDF,), CPAP_BRP),
    "MotionDex": (
        ("Polar_H10_*_ACC.txt", "Polar_VeritySense_*_ACC.txt", "Wellue_O2Ring-S_*_ACCRAW.txt"),
        "Polar_VeritySense_*_ACC.txt",
    ),
    "GlucoDex": ((), None),  # no CGM on the box — always absent, never a fabricated 0
    # HRVDex ingests Welltory CSV or an ECGDex EXPORT — never a raw Polar file (a raw RR.txt handed to
    # it is dropped without a word, measured 2026-09-20). The box holds neither, so like the
    # Integrator its cell is the raw input that reaches it through ECGDex, and it is not offered as a click.
    "HRVDex": (("Polar_H10_*_HR.txt", "Polar_H10_*_RR.txt", "Polar_VeritySense_*_PPI.txt"), "Polar_H10_*_RR.txt"),
    "EEGDex": ((), None),  # no Muse on the box
    # The Integrator ingests NODE EXPORTS (ganglior.node-export JSON), which the box does not hold —
    # folds run on rig (tools/trio-batch.mjs). Its cell is the raw input it WOULD fold, marked
    # `loadable: False` so the monitor shows the figure and does not offer a click.
    "Integrator": (
        (
            "Polar_H10_*_ECG.txt",
            "Polar_VeritySense_*_PPG.txt",
            "Wellue_O2Ring-S_*_SPO2.csv",
            "Polar_*_ACC.txt",
            CPAP_EDF,
        ),
        "Polar_VeritySense_*_PPG.txt",
    ),
}
NOT_LOADABLE = frozenset({"Integrator", "HRVDex"})
# derived tools: eligible when every required input exists; they open with those inputs loaded
DERIVED: dict[str, tuple[str, ...]] = {
    # the hat's O2Ring corner is the ring's PULSE from its _SPO2.csv (sensor-trio-power-analysis.js role `o2`), not the
    # ring's raw PPG waveform — a ✓ must mean the tool can run, so the requirement names the file it reads
    "3 corner hat": ("Polar_H10_*_HR.txt", "Polar_VeritySense_*_PPG.txt", "Wellue_O2Ring-S_*_SPO2.csv"),
    "PAT": ("Polar_H10_*_ECG.txt", "Polar_VeritySense_*_PPG.txt"),
    # "PAT fused" needs a THIRD corner the plain PAT page does not: the finger leg and the hat are built
    # from the ring's RAW pleth, not its SpO2 CSV, so the requirement names `_PPG.txt` — the same rule the
    # hat entry above states ("a ✓ must mean the tool can run, so the requirement names the file it reads")
    # reaching a different file. A night with the ring's CSV but no raw pleth is PAT-eligible and NOT this.
    "PAT fused": ("Polar_H10_*_ECG.txt", "Polar_VeritySense_*_PPG.txt", "Wellue_O2Ring-S_*_PPG.txt"),
}
COLUMNS = tuple(NODES) + tuple(DERIVED)
# EVERY device's PACKET-ARRIVAL sidecar (writers.PmdArrivalLogWriter). Not an analyzer's ingest, so not a
# node's file list — a per-night field of its own that the monitor's PAT click hands over: PAT Feasibility's
# corrected lag re-times each leg on its own floor (route-PAT fix, 2026-09-27).
#
# 🔴 ONE WILDCARD, NOT A DEVICE ALLOWLIST, AND THE PREVIOUS COMMENT IS WHY. It read "the ring's sidecar
# carries no PMD stream PAT uses, so it is not listed" — TRUE when written, because the ring's sidecar held
# only `OXYLIVE_DURATION_S` rows. E11 (#3267) made it write one `PPG_FRAME` row per frame, and this list was
# not revisited: the sidecar existed, the worker could read it, and the monitor still handed over two files
# of three. PAT Feasibility then printed its "no arrival sidecar for the O2Ring — a capture from before the
# box restarted on it has none" branch for a night that HAS one (2026-10-04, 22,645 `PPG_FRAME` rows), which
# reads as a statement about the CAPTURE and was a statement about this tuple.
#
# An allowlist keyed on device NAME fails closed in the wrong direction: a device that gains a sidecar, or a
# new device, silently contributes nothing and the page explains the absence with a reason that is false. A
# sidecar is identified by what it IS — `*_PMDARRIVAL.csv`, the one name `PmdArrivalLogWriter` writes — so a
# device added later cannot fall out again. Deciding whether a given sidecar is USABLE belongs to the
# consumer, which already refuses by name (`ring-offset-never-advances`) rather than ignoring the file.
ARRIVAL: tuple[str, ...] = ("*_PMDARRIVAL.csv",)


# ── THE FOLDER IS NOT THE RECORDING (NIGHT-IS-THE-RECORDING-2026-10-05 §⑥) ────────────────────────
# A calendar folder holds every session whose stamp fell on that DATE, which is not one night's sleep:
# 2026-10-04 holds a 00:26 session (the night that began 10-03) AND a 22:00 one (the night that began
# 10-04) — measured, 18 files of two recordings. The monitor handed that whole folder to a page and the
# page had to re-group it, which is how `pat-three-corner` came to pick an ECG from one recording and a
# ring from another and compute a -14.94 h overlap (residue
# 2026-10-05-pat-three-corner-picks-the-biggest-file-per-device-and-straddles-recordings).
#
# So the index publishes the RECORDINGS beside the folder view. Grouping is `nightqc.night_band`, the same
# 18:00→10:00 band the verdict is scoped by (#3292/#3297), so a monitor click and a QC verdict cannot
# disagree about which sessions are one night. The folder-wide keys are UNCHANGED — this is a new field,
# not a new shape, because every existing reader of `files` would otherwise silently see a subset.
_SESSION_STAMP = re.compile(r"_(\d{8})_?(\d{6})(?:_|\.)")


def session_epoch(name: str) -> float | None:
    """The FLOATING epoch of a capture filename's `YYYYMMDD[_]HHMMSS` session stamp, or None.

    ∅ None means "this name carries no session stamp", never a default time. The CPAP trees are keyed by
    DATE rather than by session and carry none, so they are reported unassigned rather than being filed
    under whichever band a fabricated stamp would have landed in.

    Anchored between separators for the same reason the monitor's own classifier is (`pat-feasibility.js`:
    a loose 8-then-6 scan grabs a device serial instead of the date), and accepting both layouts because
    the phone app writes `YYYYMMDD_HHMMSS` and the capture host the same 14 digits unseparated."""
    m = _SESSION_STAMP.search(os.path.basename(name))
    if not m:
        return None
    try:
        return _dt.datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").timestamp()
    except ValueError:
        return None  # a real-looking stamp that is not a real instant (month 13, day 32)


_ISO = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})")
_O2 = re.compile(r"^(\d{2}):(\d{2}):(\d{2}) (\d{2})/(\d{2})/(\d{4})")  # HH:MM:SS DD/MM/YYYY (DMY)
_NIGHT = re.compile(r"^\d{4}-\d{2}-\d{2}$")


_ISO_SUBSEC = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)")


def parse_host_stamp(line: str) -> _dt.datetime | None:
    """`parse_stamp`'s zone discipline with the SUB-SECOND digits kept — for readers that measure with it.

    ⚠️ A ZONED STAMP IS LEGAL AND MUST LAND ON THE SAME FLOATING TIME AS ITS ZONELESS TWIN (Clock
    Contract §2 rule 2: the zone is authoritative for the offset, and `tMs` is the components AS WRITTEN).
    `parse_stamp` already gets this right, by accident of anchoring at second precision — its `_ISO` group
    stops before any `+02:00`, so `fromisoformat` never sees a zone and never returns an AWARE datetime.
    A reader that calls `datetime.fromisoformat(cell)` directly does not: it gets an aware value for a
    zoned row, a naive one otherwise, and then any comparison between them raises `TypeError: can't
    compare offset-naive and offset-aware datetimes`. In `solid_night_inputs` that TypeError escaped the
    `except ValueError` beside it, and the poller's catch turned it into a night with NO verdict — which
    §3.1 then reads as unassessed.

    So why not just call `parse_stamp`? It truncates at the second, and its callers measure in HOURS where
    that is noise. `residual_scan` measures a batch residual "quantised to the host stamp's OWN 1 ms
    resolution", so for it the milliseconds are the signal. Two readers, two precisions, ONE zone rule —
    hence a sibling rather than a widened `parse_stamp`, which would silently add microseconds to every
    existing caller.

    The offset itself is deliberately NOT returned: no consumer of this function reads it, and inventing a
    field nothing consumes is worse than naming the omission. A reader that needs the zone should take it
    from the raw cell, which is retained by every caller here."""
    m = _ISO_SUBSEC.match(line)
    if m:
        try:
            return _dt.datetime.fromisoformat(m.group(1))
        except ValueError:
            return None
    return parse_stamp(line)


def parse_stamp(line: str) -> _dt.datetime | None:
    """The row's stamp in the two layouts the box writes, or None — never a fabricated time.

    Second precision, and zone-safe because `_ISO` stops before one — see `parse_host_stamp` above, which
    keeps the sub-second digits for readers that measure with them and states the shared rule."""
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
# 🔴 EVERY KEY `stream_stats` PUBLISHES, AND THE CACHE KEY CARRIES ITS FINGERPRINT. #3233 added `gaps_s`
# to the stats dict and `night_entry` reads it unconditionally — correctly, because the magnitude exists
# and publishing null for it would be absence-as-value in reverse. But the per-file key was size+mtime
# only, and a captured file that has stopped growing never changes either, so every entry the pre-#3233
# build wrote for a FINISHED night stayed a hit while lacking the key. `/api/nights` raised
# `KeyError: gaps_s` and the Vigil Nights page read "no nights on disk" for about 3.5 days (owner report
# 2026-10-03; the box's `/api/nights` had been returning that since at least 09-30 06:00).
#
# The fingerprint makes an entry whose SHAPE this reader does not produce a MISS, so it is recomputed
# from the file on disk rather than read as a night with a missing magnitude. It is derived from the key
# set rather than hand-bumped: a version number someone has to remember to raise is the same defect
# waiting for the next key, and `test_the_declared_stats_shape_is_what_stream_stats_actually_returns`
# reds the suite if a key is added here or there without the other.
_STATS_KEYS = frozenset({"fragments", "coverage", "gaps_s", "span_s", "gap_s"})
_STATS_SHAPE = hashlib.sha256("\0".join(sorted(_STATS_KEYS)).encode()).hexdigest()[:8]
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
        pass  # a cache that cannot be written is recomputed next time, not an error


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
    if len(steps) < 20:  # too few rows to know the cadence: the floor is the honest cut
        return floor
    steps.sort()
    return max(floor, 5.0 * steps[min(len(steps) - 1, int(0.95 * len(steps)))])


def stream_stats(path: str, gap_s: float | None = None) -> dict | None:
    """{fragments, coverage, gaps_s, span_s, gap_s} for a stamped text stream — one pass over its stamps.
    None when the stream has no readable stamps. Midnight wrap: a stamp that steps back by more than 12 h
    is the next day. `gap_s` defaults to the stream's own cadence threshold (`_cadence_gap`).

    `gaps_s` IS THE MAGNITUDE `coverage` THROWS AWAY, and that is why it is returned (§∅). `coverage` is
    `1 - gaps/span` rounded to 3 dp, so on a long stream it rounds a real hole to nothing: 09-28's ECGDex
    reads `fragments: 2, coverage: 1.0` over 6.77 h, and `(1 - 1.000) * span` recovers 0 s rather than the
    seconds actually lost. A consumer then has a count with no magnitude — "2 fragments" reads as damage
    where "2 fragments, 11 s of 6.77 h" reads as the non-finding it is. The seconds were measured in this
    same loop and discarded by the rounding; returning them costs nothing and is the only way the surface
    can state a bound beside its count."""
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
                        t += 86400.0  # past midnight: every later row reads small and gets the same day
                    if t - prev > gap_s:
                        frags += 1
                        gaps += t - prev
                prev = t
    except OSError:
        return None
    if first is None or prev is None or prev <= first:
        return None
    span = prev - first
    return {
        "fragments": frags,
        "coverage": round(max(0.0, 1.0 - gaps / span), 3),
        # the summed over-threshold gap, unrounded past 1 dp — see the docstring: `coverage` cannot be
        # inverted back to it once rounded, so it travels on its own or not at all.
        "gaps_s": round(gaps, 1),
        "span_s": round(span, 1),
        "gap_s": round(gap_s, 2),
    }


def cached_stats(captures: str, path: str, deadline: float | None) -> tuple[dict | None, bool]:
    """(stats, pending). Cached by relpath + size + mtime; computed now if the deadline allows, else pending."""
    _cache_load(captures)
    rel = os.path.relpath(path, captures)
    try:
        st = os.stat(path)
    except OSError:
        return None, False
    key = f"{st.st_size}:{st.st_mtime_ns}:{_STATS_SHAPE}"
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
            # A COUNT TRAVELS WITH ITS BOUND AND ITS MAGNITUDE, or the surface cannot state either.
            # `fragments` counts row-to-row holes wider than `gap_s` IN ONE FILE; QC's `gaps_in_night` is
            # a different question over the judged session, and the two disagreed on 09-28 (no gaps in
            # the night, 2 fragments on ECGDex) with nothing on either surface saying they measure
            # different things. Publishing the threshold and the seconds lost is what lets the monitor
            # say which question it answered (residue 2026-09-29-two-gap-measures-one-surface).
            "gaps_s": stats["gaps_s"] if stats else None,
            "gap_s": stats["gap_s"] if stats else None,
            "span_s": stats["span_s"] if stats else None,
            "pending": pending,
            "files": [os.path.relpath(f, root) for f in files],
            "loadable": node not in NOT_LOADABLE,
        }
    for tool, required in DERIVED.items():
        out[tool] = all(_expand(root, night_dir, p) for p in required)
    out["arrival"] = sorted(os.path.relpath(f, root) for p in ARRIVAL for f in _expand(root, night_dir, p))
    # the RECORDINGS beside the folder view — see `recordings_of`. Additive: every key above is unchanged.
    out["recordings"], out["recordings_unassigned"] = recordings_of(out)
    return out


def recordings_of(entry: dict) -> tuple[list[dict], list[str]]:
    """A night entry's file lists partitioned into RECORDINGS, plus the files that carry no session stamp.

    PURE — it reads the entry the caller already built and touches no filesystem, so grouping costs nothing
    on top of the walk and can be unit-tested without a tree.

    A recording is named by the EVENING date its band is anchored on, which is what makes two folders'
    halves of one night carry the SAME name: the 22:00 session in folder 2026-10-04 and a 03:00 session in
    folder 2026-10-05 both band to `2026-10-04`. That is the point — the monitor can hand a page one night
    even when the bytes live under two dates.

    ∅ A file with no session stamp is RETURNED SEPARATELY, never filed under a band. The CPAP trees are
    keyed by date and carry none; assigning them to whichever band the folder's name suggests would be a
    guess presented as grouping, and dropping them would make the monitor's own handoff lossy. The caller
    names them.

    Ordered by band start, so "the first recording" is the earliest and a two-recording folder reads in the
    order the nights happened."""
    by_band: dict[str, dict] = {}
    unassigned: list[str] = []
    lists: list[tuple[str, list[str]]] = [("arrival", list(entry.get("arrival") or []))]
    for node in NODES:
        cell = entry.get(node)
        if isinstance(cell, dict) and cell.get("files"):
            lists.append((node, list(cell["files"])))
    for key, files in lists:
        for f in files:
            ts = session_epoch(f)
            if ts is None:
                if f not in unassigned:
                    unassigned.append(f)
                continue
            b0, b1 = nightqc.night_band(ts)
            name = _dt.datetime.fromtimestamp(b0).strftime("%Y-%m-%d")
            r = by_band.setdefault(
                name, {"recording": name, "begin": b0, "end": b1, "first": ts, "arrival": [], "files": {}}
            )
            r["first"] = min(r["first"], ts)
            if key == "arrival":
                r["arrival"].append(f)
            else:
                r["files"].setdefault(key, []).append(f)
    out = []
    for name in sorted(by_band):
        r = by_band[name]
        r["arrival"] = sorted(r["arrival"])
        r["files"] = {k: sorted(v) for k, v in sorted(r["files"].items())}
        out.append(r)
    return out, sorted(unassigned)


def list_nights(root: str) -> list[str]:
    captures = os.path.join(root, "captures")
    try:
        names = os.listdir(captures)
    except OSError:
        return []
    return sorted(
        os.path.join(captures, n) for n in names if _NIGHT.match(n) and os.path.isdir(os.path.join(captures, n))
    )


def index_nights(root: str, limit: int = 60, budget_s: float | None = 15.0) -> list[dict]:
    """The newest `limit` nights, oldest first. `root` is the box root (`config.root`); its `captures/`
    holds the night directories and the CPAP trees the CPAPDex globs reach into. `budget_s` bounds the
    fragment/coverage passes this call may run (newest nights first, so the ones being looked at fill
    first); nodes left uncomputed carry `pending: True` and a later call finishes them from the cache."""
    nights = list_nights(root)
    captures = os.path.join(root, "captures")
    deadline = None if budget_s is None else time.monotonic() + budget_s
    picked = nights[-max(1, limit) :]
    rows = [_night_row(captures, d, deadline) for d in reversed(picked)]
    return list(reversed(rows))


def _night_row(captures: str, night_dir: str, deadline: float | None) -> dict:
    """One night's row, or a row naming why that night could not be indexed.

    ONE BAD NIGHT IS NOT NINETY. `index_nights` used to be a bare comprehension, so the first night that
    raised took the whole listing with it — `/api/nights` returned a single `{"error": …}` and the page
    said "no nights on disk" about a box holding 90 of them. That is the shape the `gaps_s` KeyError hit,
    and the same would be true of any future read of a field one night happens to lack.

    The error row keeps the night's DATE and says what failed, so the page can show the night as
    unindexed rather than omitting it — an omitted night reads as a night that was never captured, which
    is the absence-as-value trap one level up from the field. It carries no node keys at all, so nothing
    downstream can mistake it for a night with no data: `pending_count` skips non-dict values, and a
    consumer looking for a node finds the key missing rather than null."""
    try:
        return night_entry(captures, night_dir, deadline)
    except Exception as exc:  # noqa: BLE001 — one night's defect must not hide the other eighty-nine
        return {"night": os.path.basename(night_dir), "error": f"{type(exc).__name__}: {exc}"}


def pending_count(rows: list[dict]) -> int:
    return sum(1 for r in rows for v in r.values() if isinstance(v, dict) and v.get("pending"))

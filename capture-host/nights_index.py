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

import calendar as _cal
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
    # Integrator its cell is the raw input that reaches it through ECGDex. Unlike the Integrator, it is not a click.
    "HRVDex": (("Polar_H10_*_HR.txt", "Polar_H10_*_RR.txt", "Polar_VeritySense_*_PPI.txt"), "Polar_H10_*_RR.txt"),
    "EEGDex": ((), None),  # no Muse on the box
    # The Integrator ingests NODE EXPORTS (ganglior.node-export JSON), which the box does not hold. Its
    # cell is the raw input a fold takes, and the monitor's click opens OverDex with those files: OverDex
    # runs each analyzer in the browser and fuses the exports with the Integrator's engine.
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
NOT_LOADABLE = frozenset({"HRVDex"})
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


def _band_date(edge: float) -> str:
    """A band edge's own `YYYY-MM-DD`, read in the FLOATING frame the edge is in.

    `fromtimestamp(edge)` without a zone resolves the edge THROUGH THE READER'S ZONE, and
    `nightqc._floating_band` returns floating seconds, so the naive form named a different day either
    side of the offset. It round-tripped correctly while the band was built naive-local too, which is
    why the pair hid: the same wrong frame on both sides gave the right components back. Residue
    `2026-10-12-the-night-band-mixes-a-floating-stamp-with-a-local-epoch`.

    This is the published night KEY, so the day it names is the thing a reader indexes by."""
    return _dt.datetime.fromtimestamp(edge, _dt.timezone.utc).strftime("%Y-%m-%d")


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
    # 🔴 IT SAID FLOATING AND RETURNED A LOCAL EPOCH, found 2026-10-18 while moving the bands into the
    # floating frame. `.timestamp()` resolved the stamp through the READER'S ZONE, four hours off the
    # components the capture wrote on this box, and `recording_start` published that shifted clock as
    # "what a reader compares against the device's own screen". It hid because the band was naive local
    # too: two wrong frames that cancelled for membership, and only the published field showed it.
    # `floating_stamp_s` is nightqc's one conversion and owns the unreal-stamp case, so the try/except
    # that used to sit here belongs to it rather than to a second copy.
    return nightqc.floating_stamp_s(m.group(1) + m.group(2))


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


# ── ONE NIGHT IS ONE RECORDING, AND A RECORDING CROSSES MIDNIGHT ────────────────────────────────────
#
# 🔴 THE DEFECT (owner report 2026-10-09→10): the Nights page split ONE night across TWO rows whenever
# the Polar streams started after midnight. The night of 10-09→10-10 is one recording — ring at 21:25 in
# folder 2026-10-09, Verity at 01:47 and H10 at 01:50 in folder 2026-10-10 — and the page showed
# 10-09 (OxyDex + CPAPDex) and 10-10 (the five Polar nodes, plus an OxyDex "0 kB / ?" cell) as two
# nights. Nothing was wrong with the capture; the LISTING grouped by folder.
#
# THE RULE IS THE JUDGE'S, NOT A SECOND DEFINITION OF IT. `solid_night_inputs` already carries the
# owner's ruling (its header, #3297): "A RECORDING is the maximal chain of sessions separated by less
# than `nightqc._SESSION_GAP_SEC`, CLIPPED TO THE NIGHT BAND it begins in", where MEMBERSHIP (is the
# session's START inside the band?) decides the folder set and TRUNCATION bounds the span. So this module
# asks `recording_scope` which folders a night spans and `in_band` which files belong, rather than
# restating either — the one thing `NIGHT-IS-THE-RECORDING-2026-10-05-BRIEF` §④(b) asks for.
#
# ⚠️ AND THE FOLDER BOUNDARY DOES NOT MOVE. `writers.py:766` records why a session's files must stay in
# their start-date folder (`resumable_set` already searches the previous folder for exactly this), so
# `night_dir()`, the folder names and the filenames are untouched. Only the LISTING's grouping changes.
#
# ⚠️ WHAT THIS DOES NOT DO, AND WHY IT IS NOT AN OVERSIGHT: it does not separate a MORNING DAYTIME
# session from the night it shares a band with. Measured: `night_band` for 10-09 is
# `[10-09 18:00, 10-10 10:00)`, so the ring's 09:18 daytime session on 10-10 falls INSIDE 10-09's band —
# the brief's claim (§④) that a 09:52 session "falls in no band" does not hold against the
# implementation, and §⑤ lists the daytime session as one of "two cases the ruling does not yet cover",
# asking "Where does it go, and is it judged at all?".
#
# Separating it needs a rule nobody has given yet, and the obvious one is wrong. A first attempt chained
# sessions by START with `nightqc._SESSION_GAP_SEC` and classified later chains as daytime — which
# CLASSIFIED THE NIGHT'S OWN POLAR SETS AS DAYTIME, because the ring started 21:25 and the H10 at 01:50,
# 4 h 22 m later, while the Polar sessions begin INSIDE the ring's 5.8 h recording. A wear gap is
# END-to-START, and this module has no session end: `session_epoch` reads the start from the NAME, and an
# end would need each file's last row stamp (`span_hours`, I/O per file against this function's deadline)
# or its mtime, which `in_band`'s own docstring warns is the last write and may fall in the next band.
# So the morning session's bytes still merge into the night's cells here, visibly — its files are named in
# the cell's `files` list, and the primary pick is `max(..., key=getsize)`, so the night's own file still
# drives `hours` and the stats. That is a narrower wrong than either guessing a rule or shipping one
# measured to mis-split the night.


def _expand_recording(dirs: list[str], band, pattern: str) -> list[str]:
    """A FOLDER-RELATIVE capture pattern over the recording's folder set, admitted by band.

    🔴 IT TAKES NO `root`, AND THAT IS THE POINT. `root` is read only on the root-relative branch, so
    every caller that can only ever pass a folder-relative pattern was handing over a parameter it could
    not use — and the gate named four `root → None` survivors that NO INPUT could distinguish for exactly
    that reason (`_recording_files`, both `night_entry` sites, and `_expand_alt`'s plain-string branch).
    Measured before splitting: `ARRIVAL` and all three `DERIVED` pattern sets are entirely
    folder-relative — not one contains `/` — and the CPAP trees reach `_expand` only through the
    tuple/`pick` branches, never as a plain string. A parameter a call site cannot reach is a mutant site
    for nothing."""
    import solid_night_inputs as _si  # cycle named in `_expand`

    return sorted(
        p for d in dirs for p in glob.glob(os.path.join(d, pattern)) if os.path.isfile(p) and _si.in_band(p, band)
    )


def _scope_parts(night_dir: str, scope: dict | None) -> tuple[list[str], object]:
    """`(dirs, band)` — the ONE place a scope (or its absence) becomes an enumeration.

    🔴 IT EXISTS BECAUSE `night_dir` WAS A FALLBACK, AND A FALLBACK IS A MUTANT NOBODY CAN KILL. With
    `dirs = (scope or {}).get("dirs") or [night_dir]` inlined at the call sites, `night_dir → None`
    survived three times over: whenever a scope carries dirs — which is every call `night_entry` makes
    for a real night — the parameter is never read. Resolved once here, the enumeration takes only what
    it uses, and the degrade for a folder that names no band (`scope is None` ⇒ this folder alone, no
    band filter, exactly as documented) is stated in one place instead of three."""
    # 🔴 `scope.get("ok")` IS THE LOAD-BEARING HALF, and it is not cosmetic: a REFUSED scope still
    # carries a `band` (the two-folder tripwire computes one before refusing), so trusting it would
    # filter this folder's files by a band the judgement declined to use — admitting a band filter on the
    # strength of a scope that said "do not judge me". A refusal degrades to this folder, unfiltered.
    if scope and scope.get("ok"):
        return (scope.get("dirs") or [night_dir]), scope.get("band")
    return [night_dir], None


def _expand(root: str, night_dir: str, pattern: str, scope: dict | None = None) -> list[str]:
    ymd = os.path.basename(night_dir).replace("-", "")
    if "/" in pattern:
        # A ROOT-RELATIVE, DATE-KEYED TREE (the CPAP trees) — left exactly as it was. These carry no
        # session stamp at all (`session_epoch` returns None for them and says why), so there is no start
        # to judge membership by, and globbing them across a second date would file one day's tree under
        # another night on the strength of a guess.
        return sorted(p for p in glob.glob(os.path.join(root, pattern.format(ymd=ymd))) if os.path.isfile(p))
    dirs, band = _scope_parts(night_dir, scope)
    return _expand_recording(dirs, band, pattern)


def _expand_alt(
    root: str, night_dir: str, pat: Pattern, pick: int | None = None, scope: dict | None = None
) -> tuple[list[str], int | None]:
    """A plain glob expands as is (index None). Alternatives expand to the FIRST one with files and its
    index — or, with `pick`, to exactly that alternative, so a primary reads from the tree the files came from."""
    if isinstance(pat, str):
        # A PLAIN-STRING PATTERN IS ALWAYS FOLDER-RELATIVE here (the date-keyed CPAP trees arrive as a
        # TUPLE of alternatives and take the branches below), so this one needs no `root` — which is why
        # `_expand(None, ...)` survived the gate on this line.
        dirs, band = _scope_parts(night_dir, scope)
        return _expand_recording(dirs, band, pat), None
    if pick is not None:
        return _expand(root, night_dir, pat[pick], scope), pick
    for i, p in enumerate(pat):
        got = _expand(root, night_dir, p, scope)
        if got:
            return got, i
    return [], None


def _recording_files(night_dir: str, pattern: str, scope: dict | None, stamps: frozenset[float] | None) -> list[str]:
    """The recording's files for one pattern — the scope's folders, admitted by band and by chain.

    🔴 MODULE-LEVEL, AND IT WAS A NESTED CLOSURE UNTIL THE GATE CRASHED ON IT. The diff-scoped mutation
    gate names every `FunctionDef` a diff touches and asks mutmut for that function's mutants; mutmut
    does not generate them for a nested def, so the filter
    `nights_index.x__recording_files__mutmut_*` matched nothing and the run died with
    `AssertionError: Filtered for specific mutants, but nothing matches` — a crash, not a verdict, and
    not the gate's own glitch. A helper inside a function is unmeasurable by construction here."""
    dirs, band = _scope_parts(night_dir, scope)
    got = _expand_recording(dirs, band, pattern)
    if stamps is not None:
        # A STAMPLESS FILE STAYS: it has no start to judge, and `recordings_of` reports it as unassigned
        # rather than filing it under a band. Dropping it here would make the cell lossy to fix a
        # grouping question it is not part of.
        got = [f for f in got if (t := session_epoch(f)) is None or t in stamps]
    return got


def night_entry(
    root: str, night_dir: str, deadline: float | None = None, stamps: frozenset[float] | None = None
) -> dict:
    """One night, every column. A node with no input is `None`; a derived tool is True/False. A node's
    `fragments`/`coverage` come from its primary stream (None for EDF primaries, which have no row
    stamps; `pending: True` when the deadline left no time to compute them yet).

    `stamps` narrows the row to ONE RECORDING — the session starts that chain together. New, optional and
    last, so every existing caller keeps the old meaning: without it the row is the band's FULL
    membership, which is what a caller asking "what is in this night folder's band" wants. `index_nights`
    passes it, because one band can carry two rows when a doff gap splits it (owner ruling 2026-10-10:
    row identity is `(night band, recording start)`)."""
    import solid_night_inputs as _si  # the cycle is named in `_expand`

    out: dict = {"night": os.path.basename(night_dir)}
    if stamps:
        # THE SECOND HALF OF THE ROW IDENTITY. `night` is the band; this is the recording's own start, and
        # without it two rows in one band are indistinguishable to every consumer — the page, a cache key,
        # a test. Published as wall-clock because that is what a reader compares against the device's own
        # screen; the epoch is `min(stamps)` and stays internal.
        # FLOATING, like the stamps themselves (`session_epoch`). `fromtimestamp` without a zone read
        # them through the READER'S ZONE, so the published field was four hours off the device's own
        # screen on the box — the exact opposite of what the line above says it is for. Same frame fix
        # as `_band_date`, same residue.
        began = _dt.datetime.fromtimestamp(min(stamps), _dt.timezone.utc)
        out["recording_start"] = began.strftime("%Y-%m-%d %H:%M")
        # ⚠️ A ROW THE SLEEP BAND ADMITS NOTHING INTO, AND THE FLAG IS WHAT MAKES IT READABLE. A 13:00
        # session gets a row, and `in_band` keeps every one of its files out: measured 2026-10-18, each
        # node cell comes back `None` and `recordings` is empty. Read without the flag that row says
        # "recorded nothing" about a session that recorded fine — §∅ with the roles reversed, OUR
        # grouping publishing an absence the capture does not have. `daytime` is what stops that reading.
        #
        # ⏪ THE KEY MOVED AND THE ADMISSION DID NOT, which is the half of this that changed. Under the
        # 18/10 band the 13:00 session was also KEYED to the previous evening, so its empty row landed
        # among that night's rows; the owner's 2026-10-13 noon-to-noon ruling keys it to its own day
        # instead. Its cells are still `None`, and deliberately so: 13:00 is not sleep, and admitting it
        # would manufacture night signal out of daytime wear. So the row is now a daytime sitting under
        # its own date rather than an empty night under someone else's.
        #
        # THE HOURS ARE `nightqc`'s OWN EDGES, never a second copy of them: a start at or after
        # `_DAYTIME_BEGIN_H` and before `_DAYTIME_END_H` carries the flag. The flag is the START's, not
        # the span's — a night session running past 10:00 is still the night's.
        #
        # ⚠️ THE FLAG NO LONGER READS A GAP IN THE BAND, and that is why it has its own two constants.
        # The band tiled the clock under the owner's 2026-10-13 noon-to-noon ruling, so
        # `_NIGHT_END_H <= h < _NIGHT_BEGIN_H` is empty for every hour and the old expression flagged
        # nothing. The ruling gave the flag its own window, 10:00 through 18:00, and a flagged session is
        # never judged as a night. So the flag OVERLAPS the band deliberately rather than partitioning
        # it — every daytime session is also inside some night's band, and the flag is what says it is
        # not that night.
        #
        # ⚠️ AND IT DOES NOT REACH THE 09:18 CASE, which is deliberate and is NOT the same question. Both
        # edges are owner rulings rather than refits (`nightqc`: 20 → 18 on 2026-10-05, then noon-to-noon
        # on 2026-10-13), and 09:18 is below `_DAYTIME_BEGIN_H`, so it is INSIDE 10-09's band, carries no
        # flag, and its files are rightly admitted; it is a second RECORDING in that band
        # and `recording_start` is what distinguishes it. Flagging it would need a wear rule nobody has
        # given — `_recordings`' docstring and §⑤ both record that it is open.
        out["daytime"] = nightqc._DAYTIME_BEGIN_H <= began.hour < nightqc._DAYTIME_END_H
    # THE RECORDING'S FOLDER SET, ASKED OF THE JUDGE ONCE PER NIGHT. Once, because `recording_scope`
    # counts files per folder and `_expand` is called per node per pattern — asking it there would pay
    # that walk dozens of times against a deadline this function is explicitly budgeted by.
    # A scope that is not `ok` (the folder is not a date, or the two-folder tripwire fired) falls back to
    # this folder alone: the listing degrades to the pre-#3297 folder view rather than guessing a scope.
    # The `ok` check lives in `_scope_parts`, NOT here. As a ternary it was a mutant site
    # (`(_sc.get("ok")) or True`) whose two sides both degraded to this folder with no band filter —
    # because a not-ok scope carries no `dirs` — so it read as unkillable while being a real branch.
    # Asking once, where the answer is load-bearing, removes the site and keeps the behaviour.
    scope = _si.recording_scope(night_dir)

    # STEP 1 — gather what the band admits, per node, WITHOUT computing anything expensive. The daytime
    # chain has to be removed BEFORE `span_hours`/`cached_stats` run, or the night's cells would carry a
    # recording the night does not contain.
    cand: dict[str, tuple[list[str], int | None]] = {}
    for node, (patterns, primary) in NODES.items():
        files: list[str] = []
        tree: int | None = None
        for p in patterns:
            got, i = _expand_alt(root, night_dir, p, scope=scope)
            files += got
            tree = i if tree is None else tree
        cand[node] = (sorted(set(files)), tree)

    for node, (patterns, primary) in NODES.items():
        files, tree = cand[node]
        if stamps is not None:
            files = [f for f in files if (t := session_epoch(f)) is None or t in stamps]
        if not files:
            out[node] = None
            continue
        hours = None
        stats: dict | None = None
        pending = False
        # 🔴 THE PRIMARY IS ENUMERATED BY THE SAME RULE AS THE FILES — scope AND chain — or a cell lists
        # bytes it never measures. Without the scope this re-read saw the evening folder alone, so a
        # recording whose Polar sets start after midnight (their bytes under the next date) carried its
        # files and `hours: null` — 2026-10-09 on the box: H10 and Verity "not measured yet" beside a
        # measured ring. Without the chain, `max(…, key=getsize)` could measure a second recording in the
        # same band instead of this row's.
        prims = _expand_alt(root, night_dir, primary, tree, scope)[0] if primary else []
        if stamps is not None:
            prims = [f for f in prims if (t := session_epoch(f)) is None or t in stamps]
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

    # ⚠️ THESE TWO TAKE THE SCOPE AND THE FILTER TOO, and I first wired only the node cells — which left
    # the adopted row's `arrival` EMPTY (it globbed a band folder that does not exist) and `DERIVED`
    # judging the wrong recording. A test caught it. One enumeration rule, applied at every site that
    # enumerates, or the row is assembled from two different definitions of "this night".
    for tool, required in DERIVED.items():
        out[tool] = all(_recording_files(night_dir, p, scope, stamps) for p in required)
    out["arrival"] = sorted(
        os.path.relpath(f, root) for p in ARRIVAL for f in _recording_files(night_dir, p, scope, stamps)
    )
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
            # THE KEY BAND, NOT THE SLEEP BAND. Only `strftime` of the begin edge is kept, so this site
            # asks "which night?" and never "is this signal?" — the owner's 2026-10-13 noon-to-noon
            # ruling governs exactly this question. `night_key_band`'s docstring carries why passing it
            # to `in_band` or `night_view` would be wrong.
            b0, b1 = nightqc.night_key_band(ts)
            name = _band_date(b0)
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


def _session_spans(root: str) -> dict[float, float]:
    """`{session_start_epoch: session_end_epoch}` over EVERY date folder, as one pass.

    🔴 THE END IS WHY THIS EXISTS, and getting it from the START was my first version's defect. A
    recording is "the maximal chain of sessions separated by less than `nightqc._SESSION_GAP_SEC`"
    (`solid_night_inputs`' header, the owner's ruling) — and a WEAR gap is END-to-START. Chaining on
    starts alone split last night in two: the ring began 21:25 and the H10 01:50, 4 h 22 m later, while
    the Polar sessions begin INSIDE the ring's 5.8 h recording. Measured before this was rewritten.

    ⚠️ THE END IS THE LAST WRITE (max mtime over the session's files), and that is a choice with a
    stated cost. `in_band`'s docstring warns mtime off MEMBERSHIP — which band a session belongs to must
    come from the stamp in the NAME, and still does. But the session's END is exactly what "last write"
    means for a finished capture, and the alternative (each file's last row stamp) is `span_hours` per
    file, which is I/O per file against the budget `index_nights` is explicitly bounded by. A session
    still being written reads as ending now, which merges it with the night in progress — the right
    answer for a live row."""
    spans: dict[float, float] = {}
    # `list_nights`, NOT a raw `????-??-??` glob: it already filters by the night regex AND `isdir`, so a
    # stray `status.json`, the `stored/` tree and a name like `2026-09-99` are excluded by the one
    # enumeration this module already vetted. My first version globbed, which orphaned this function and
    # would have admitted an impossible date as a night.
    for d in list_nights(root):
        # ONE OFFSET PER FOLDER, READ ONCE, BEFORE THE FILES. `recorded_writer_offset` opens one small
        # sidecar; reading it per file would open it as many times as the night has sessions for an
        # answer that cannot differ between them. It is also the only I/O this pass adds, which is what
        # keeps `_floating_mtime` inside the budget the header states.
        rec = nightqc.recorded_writer_offset(d)
        # SORTED, so the scan order is FIXED. `glob` returns filesystem order, which made a
        # `continue` → `break` mutant on the skip below survive: a test can only see that mutant if the
        # skipped file is guaranteed to come BEFORE a file that must still be scanned, and an unsorted
        # walk cannot guarantee it. Determinism is also the cheaper property to reason about.
        for f in sorted(glob.glob(os.path.join(d, "*"))):
            t = session_epoch(f)
            if t is None or not os.path.isfile(f):
                continue
            try:
                end = _floating_mtime(f, rec)
            except OSError:
                continue  # vanished between glob and stat — it carries no span to add
            spans[t] = max(spans.get(t, end), end, t)
    return spans


def _floating_mtime(path: str, recorded: "dict | None") -> float:
    """A file's last write as a FLOATING second — the frame `session_epoch` returns.

    🔴 A SPAN NEEDS ONE FRAME AND THIS FUNCTION HAS TWO SOURCES. The start comes from the NAME and is
    civil (`session_epoch`); the end comes from the filesystem and is an absolute instant. Differencing
    them directly is the defect `floating_stamp_s` warns about in capitals, and it was invisible here
    only while `session_epoch` resolved its stamp through the reader's zone too — two wrong frames that
    cancelled. Measured on 2026-10-18 once the start was corrected: in EDT every span grew by the 4 h
    offset, which swallowed the 2 h doff gaps and merged three recordings into one row.

    ⚠️ `recorded` IS THE OFFSET THE WRITER WROTE DOWN, and it is the only path here that measures
    anything. `briefs/SESSION-SPAN-WRITER-OFFSET-2026-09-28-BRIEF.md` §1 rules that the night's own
    writer offset is the ONE place a floating value becomes an instant, and this conversion crosses the
    same seam in the other direction. So a night that recorded its offset takes an exact subtraction and
    assumes nothing — every night from 2026-10-05, and every night from here on.

    ∅ THE FALLBACK IS A PREMISE, AND NAMING IT IS THE WHOLE OF ITS DEFENCE. An older night recorded no
    offset, so this reads the HOST's own zone at that instant instead. That premise holds while the index
    runs on the box that wrote the files, which is where it runs today, and it is wrong by a whole UTC
    offset anywhere else. The brief's answer to an unrecoverable offset is UNKNOWN with a named reason,
    and this return value has nowhere to carry one: `_recordings` consumes the end as a chain bound and
    publishes no field for it (`begin` and `end` on a row are BAND edges, not this). So the off-box case
    is residue (`2026-10-18-nights-index-spans-assume-the-writers-host-zone`), and a correct answer stays
    available for every night captured before the writer began recording its zone.

    ⏪ A REFUSED RECOVERY LANDS HERE TOO, and that direction is the safe one. `recorded_writer_offset`
    hands back None when a night's sessions disagree, which is a DST seam — and one offset is wrong for
    half of such a night, while the host zone resolved AT each file's own instant is right across it."""
    m = os.path.getmtime(path)
    if recorded is not None:
        # MINUS, because `offset_sec` RAISES a floating stamp into the `mtime` frame (`nightqc`'s sign,
        # EDT = +14400). This brings an mtime DOWN into the floating frame, which is the way every other
        # value in this module already points.
        return m - float(recorded["offset_sec"])
    d = _dt.datetime.fromtimestamp(m)
    return float(_cal.timegm(d.timetuple())) + d.microsecond / 1e6


def _recordings(root: str) -> list[tuple[str, frozenset[float]]]:
    """`[(band_evening_date, stamps)]` — one entry per RECORDING, newest first. PURE given the tree.

    ROW IDENTITY IS `(night band, recording start)` (owner ruling 2026-10-10), so this enumerates BANDS
    OVER THE UNION OF FOLDERS rather than folders themselves. Two consequences, both deliberate:
      · ONE BAND CAN CARRY TWO ROWS. A morning session after a doff gap is a second recording in the same
        band — which is what the 09:18 ring session on 2026-10-10 is, and it gets its own row instead of
        merging into the night or needing a "daytime" rule §⑤ left open.
      · A SESSION WHOSE BAND-DATE FOLDER DOES NOT EXIST IS ADOPTED. The row is keyed by the band, and
        `night_entry` reaches the files through `recording_scope`'s folder set, so a 00:26 session sitting
        alone in folder D+1 is listed under band D even though no folder D was ever created. Enumerating
        folders is what dropped it."""
    captures = os.path.join(root, "captures")
    spans = _session_spans(root)
    by_band: dict[str, list[float]] = {}
    # 🔴 A NIGHT WITH NO SESSION STAMP ANYWHERE STILL GETS A ROW, and leaving this out LOST one. The CPAP
    # trees are DATE-KEYED and carry no stamp (`session_epoch` returns None and says why), so a night
    # whose only data is CPAP produces no recording — and enumerating recordings alone dropped it from
    # the listing entirely. Measured on a CPAP-only fixture: 0 rows for a night that is on disk. That is
    # the exact trap `_night_row`'s docstring names one layer down — "an omitted night reads as a night
    # that was never captured".
    #
    # ⚠️ ONLY where the date-keyed tree EXISTS, never for every folder: a folder whose files all band to
    # the PREVIOUS evening must stay rowless, or the phantom second row the owner reported comes back.
    stampless: set[str] = set()
    for pat in ("cpap/DATALOG/????????", "cpap-ble/DATALOG/????????"):
        for d in glob.glob(os.path.join(captures, pat)):
            ymd = os.path.basename(d)
            if os.path.isdir(d) and any(os.path.isfile(f) for f in glob.glob(os.path.join(d, "*"))):
                # `ymd[6:]`, not `[6:8]`: the glob is `????????` so the two are identical and `[6:9]`
                # survived the gate. An end index that cannot differ is a mutant site for nothing.
                stampless.add(f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}")
    for t in sorted(spans):
        # NO `if band is None` GUARD — `nightqc.night_band` has no such return. Measured: for a stamp
        # before 18:00 it anchors to the PREVIOUS evening, so every plausible epoch gets a band and the
        # guard I first wrote was unreachable.
        #
        # ⏪ THE BAND USED TO NOT CONTAIN THE STAMP, and that is now fixed rather than recorded. Under
        # the sleep band 14:00 sat in the 8 h gap and `night_band` handed back the previous evening's
        # `[18:00, 10:00)`, which ended four hours before it; this comment used to say "the mismatch is
        # `nightqc`'s to fix". It was fixed by the owner's 2026-10-13 noon-to-noon ruling, which keys a
        # 14:00 session to its OWN day. A midday session still gets its own row rather than merging into
        # a night, because `recording_start` is what distinguishes two recordings in one band.
        band = nightqc.night_key_band(t)
        key = _band_date(band[0])
        by_band.setdefault(key, []).append(t)
    out: list[tuple[str, frozenset[float]]] = []
    # `stampless - by_band.keys()` rather than `setdefault(key, [])`: the sentinel `[]` was a mutant site
    # whose mutations (`None`, or the argument dropped) reached the SAME branch below, so none could be
    # killed. A date-keyed night is now named by its own loop and carries no placeholder list at all.
    for key in sorted(stampless - by_band.keys()):
        out.append((key, frozenset()))
    for key, starts in by_band.items():
        # `-inf`, NOT `None`: the sentinel only existed to be `or`-ed away, and `reach = ""` survived the
        # gate because `"" or spans[t]` and `None or spans[t]` are the same thing. With `-inf` the first
        # element needs no special case, the `reach is not None` conjunct disappears, and a mutated
        # sentinel (`+inf`) WOULD be observable: it never breaks a chain, so a two-recording band
        # collapses to one row.
        # NO SENTINEL. `reach = None` was mutable to `""` and `float("-inf")` to `float("-INF")` —
        # Python parses those identically — and both survived because a sentinel's only job is to be
        # replaced on the first element. Taking the first start explicitly removes the sentinel, the
        # `chain and …` guard, and both unkillable mutants with it.
        it = iter(starts)
        first = next(it)
        chain, reach = [first], spans[first]
        for t in it:
            if t - reach >= nightqc._SESSION_GAP_SEC:
                out.append((key, frozenset(chain)))
                chain, reach = [t], spans[t]
                continue
            chain.append(t)
            reach = max(reach, spans[t])
        # NOT `if chain:` — UNREACHABLE. `starts` is non-empty here (the empty case returned above) and
        # the loop appends every element, so the final chain always holds at least one start. A guard no
        # input can falsify is a branch the mutation gate can neither kill nor excuse, which is the
        # reasoning `solid_night_inputs` already records for its own `max_dirs` tripwire.
        out.append((key, frozenset(chain)))
    # newest first: by band date, then by the recording's own start — the row identity, in order
    # `sorted(stamps)[:1]` — a LIST, not a number with a default. `min(..., default=0.0)` needed a
    # numeric sentinel for the date-keyed nights (no recording start), and the gate named `default=1.0`
    # as a survivor because no real session epoch is anywhere near either value. A one-element slice is
    # `[]` for a date-keyed night and `[start]` otherwise, and `[] < [start]` without a sentinel at all.
    # The FULL sorted list, not `[:1]`: a slice bound is a mutant site (`[:2]` survived — two recordings
    # in one band always differ at their FIRST start, so a wider slice cannot change the order), and the
    # whole list orders identically while leaving nothing to mutate. `[]` for a date-keyed night.
    out.sort(key=lambda kv: (kv[0], sorted(kv[1])), reverse=True)
    return out


def index_nights(root: str, limit: int = 60, budget_s: float | None = 15.0) -> list[dict]:
    """The newest `limit` nights, oldest first. `root` is the box root (`config.root`); its `captures/`
    holds the night directories and the CPAP trees the CPAPDex globs reach into. `budget_s` bounds the
    fragment/coverage passes this call may run (newest nights first, so the ones being looked at fill
    first); nodes left uncomputed carry `pending: True` and a later call finishes them from the cache."""
    captures = os.path.join(root, "captures")
    deadline = None if budget_s is None else time.monotonic() + budget_s
    recs = _recordings(root)[: max(1, limit)]
    rows = [_night_row(captures, os.path.join(captures, band), deadline, stamps) for band, stamps in recs]
    return list(reversed(rows))


def _night_row(captures: str, night_dir: str, deadline: float | None, stamps: frozenset[float] | None = None) -> dict:
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
        return night_entry(captures, night_dir, deadline, stamps)
    except Exception as exc:  # noqa: BLE001 — one night's defect must not hide the other eighty-nine
        return {"night": os.path.basename(night_dir), "error": f"{type(exc).__name__}: {exc}"}


def pending_count(rows: list[dict]) -> int:
    return sum(1 for r in rows for v in r.values() if isinstance(v, dict) and v.get("pending"))

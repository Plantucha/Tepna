# tepna-capture — loss_audit.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""THE NIGHT'S LOSS LEDGER — CAPTURE-LOSS-PRECEDENCE-AUDIT R4 (owner ruling 2026-09-22).

The audit's §0 metric, run every night by the daemon and written beside QC-SUMMARY.json as
`LOSS-AUDIT.json` with a `tepna.verdict/1` (`gate: night-loss`) beside it:

  · for each configured device's PRIMARY stream, every gap longer than the stream's own delivery
    cadence (`nights_index._cadence_gap` — the same cut the Nights page's fragment count uses);
  · each gap ATTRIBUTED to the last journal line for that device in the seconds before it opened —
    `daemon:*` (the box chose to end the link) · `link:*` (the radio) · `device:*` · `unattributed`;
  · summed as minutes per cause per device, and as the night's `worn_lost_min` — the gap minutes on
    nights where the device's own beat evidence says it was worn.

⚠️ THE VERDICT IS UNKNOWN UNTIL THE OWNER SETS A BAR. The criterion is the measurement (what fraction
of the worn span went unrecorded); no threshold has been ruled, so the object reports the number in
`result` under `status: UNKNOWN` with that as the reason — a PASS/FAIL here would be a bar this
module invented (memory `pre-state-the-threshold`). The day a bar exists, `THRESHOLD` becomes a
number and the status follows. What the object already does, bar or no bar: a night the daemon
itself tore names `daemon:not-worn drop` in `result.by_cause` the morning after — the tripwire that
would have caught 2026-09-03 (25 fragments) eighteen nights before 2026-09-20.

The journal is read with `journalctl` (read-only, the capture unit only, the night's window); where
it is unavailable every gap is `unattributed (no journal)` and the object says so.
"""

from __future__ import annotations

import bisect
import datetime as _dt
import glob
import itertools
import math
import os
import re
import statistics
import subprocess

import nightqc
import nights_index as _ni
import verdict as _verdict

GATE = "night-loss"
TOOL = "capture-host/loss_audit.py"
AUDIT_NAME = "LOSS-AUDIT.json"
VERDICT_NAME = "LOSS-VERDICT.json"
THRESHOLD: float | None = None  # the owner has not set a bar (2026-09-22); None ⇒ UNKNOWN with the number
CRITERION = {
    "name": "worn_but_not_recorded_fraction",
    "threshold": THRESHOLD if THRESHOLD is not None else 0,
    "unit": "fraction",
    "direction": "lte",
}
ATTRIB_WINDOW_S = 15.0

# journal line → cause bin, first match wins (order matters: a not-worn drop line also says "link")
KINDS: tuple[tuple[str, str], ...] = (
    ("daemon:not-worn drop", "not worn for"),
    ("daemon:pull paused live", "live capture paused"),
    ("daemon:charging hold", "charging — PMD streams unavailable"),
    # the clock watchdog re-sync runs an offline op that PAUSES live capture — the box tearing its own
    # recording. Without this bin 147 min of H10 loss over 28 corpus nights (2026-08-25 → 09-21, the
    # 2026-09-04/05/12 resync storms #2459 fixed) read as `unattributed`.
    ("daemon:clock re-sync", "off host (tolerance"),
    ("daemon:stream stall re-negotiate", "silent for"),
    ("device:powered off", "powered off"),
    ("link:timeout / not found", "TimeoutError"),
    ("link:not advertising", "not advertising"),
    ("link:dbus busy", "InProgress"),
    ("link:error other", "link error"),
    ("daemon:restart", "Starting tepna-capture"),
)

# which stream is a device's PRIMARY, by model — the same choice the Nights index makes
PRIMARY_BY_MODEL: dict[str, str] = {
    "H10": "Polar_H10_*_ECG.txt",
    "VeritySense": "Polar_VeritySense_*_PPG.txt",
    "O2Ring-S": "Wellue_O2Ring-S_*_SPO2.csv",
}
# the device's OWN wear evidence for the night: a file whose rows carry a MEASURED value, named by the
# COLUMN that carries it. The column is resolved from each file's own header, never by position.
#
# Position was wrong, and wrong in the shape ABSENCE-IS-NULL names. The box wrote `_PPI.txt` in its own
# column order until 2026-08-05 (`5e5ac71a`), with `sensor timestamp [ns]` second -- a field the Polar PPI
# stream does not carry, written as a literal 0 on every row of all 7 such files. Reading column 1
# positionally therefore read that fabricated 0 as the beat interval, ran off the end of the file, and
# scored 2026-08-04 -- 24 997 measured beats, none of them zero -- as `worn_evidence: False`. Verified
# against the deployed reader on the box: False for that night, True for a phone-layout night beside it.
# Resolving by name is what makes the two layouts one reader, and it is why a header that does NOT name
# the column returns null below rather than a verdict.
WORN_EVIDENCE_BY_MODEL: dict[str, tuple[str, str]] = {
    "H10": ("Polar_H10_*_HR.txt", "HR [bpm]"),
    "VeritySense": ("Polar_VeritySense_*_PPI.txt", "PP-interval [ms]"),
    "O2Ring-S": ("Wellue_O2Ring-S_*_SPO2.csv", "Oxygen Level"),
}


def read_journal(
    name: str | tuple[str, ...], since: _dt.datetime, until: _dt.datetime, run=subprocess.run
) -> list[tuple[_dt.datetime, str]] | None:
    """[(local stamp, cause)] for one device's lines in the window, or None when journalctl is unavailable.

    `name` is the device name, or every string that identifies the device in a log line — its name AND
    its address. The offline-op lines (`Polar <address>: offline-recording op — live capture paused`)
    carry ONLY the address: 8,369 of the 8,956 such lines on the box 2026-08-24 → 09-23, all invisible
    to a name-only match, so `daemon:pull paused live` could almost never fire."""
    keys = (name,) if isinstance(name, str) else tuple(k for k in name if k)
    try:
        r = run(
            [
                "journalctl",
                "-u",
                "tepna-capture",
                "--no-pager",
                "-o",
                "short-iso",
                "--since",
                since.strftime("%Y-%m-%d %H:%M:%S"),
                "--until",
                until.strftime("%Y-%m-%d %H:%M:%S"),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    out: list[tuple[_dt.datetime, str]] = []
    for ln in r.stdout.split("\n"):
        m = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", ln)
        if not m or (not any(k in ln for k in keys) and "Starting tepna-capture" not in ln):
            continue
        for cause, needle in KINDS:
            if needle in ln:
                out.append((_dt.datetime.fromisoformat(m.group(1)), cause))
                break
    out.sort()
    return out


def stream_gaps(path: str) -> tuple[list[tuple[_dt.datetime, float]], float, float]:
    """[(gap start stamp, seconds)] over the stream's stamps, plus (span_s, gap_s cut). Same cadence cut as
    the Nights index; stamps as local naive datetimes (both layouts the box writes)."""
    cut = _ni._cadence_gap(path)
    gaps: list[tuple[_dt.datetime, float]] = []
    first = prev = None
    iso = None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if iso is None:
                if _ni._ISO.match(line):
                    iso = True
                elif _ni._O2.match(line):
                    iso = False
                else:
                    continue
            stamp = _ni.parse_stamp(line)
            if stamp is None:
                continue
            if first is None:
                first = stamp
            if prev is not None:
                g = (stamp - prev).total_seconds()
                if g > cut:
                    gaps.append((prev, g))
            prev = stamp
    span = (prev - first).total_seconds() if first is not None and prev is not None else 0.0
    return gaps, max(0.0, span), cut


def attribute_gaps(gaps, events) -> list[tuple[_dt.datetime, float, str]]:
    """[(gap start, seconds, cause)], one per gap. `events` None ⇒ every gap 'unattributed (no journal)'.

    Published per gap (not only summed) because a consumer judging the WORN interval must count the gaps
    INSIDE it: the SOLID-NIGHT verdict's continuity band counts unattributed gaps by number as well as
    minutes, and only inside the worn interval (SOLID-NIGHT §3.4). A per-cause sum over the whole file
    can answer neither."""
    if events is None:
        return [(t0, g, "unattributed (no journal)") for t0, g in gaps]
    ts = [e[0] for e in events]
    out = []
    for t0, g in gaps:
        i = bisect.bisect_right(ts, t0) - 1
        cause = events[i][1] if i >= 0 and (t0 - ts[i]).total_seconds() <= ATTRIB_WINDOW_S else "unattributed"
        out.append((t0, g, cause))
    return out


def by_cause_of(per_gap) -> dict[str, float]:
    """Minutes per cause, summed from `attribute_gaps`' list — the one list both published keys come from."""
    out: dict[str, float] = {}
    for _, g, cause in per_gap:
        out[cause] = out.get(cause, 0.0) + g / 60.0
    return out


def attribute(gaps, events) -> dict[str, float]:
    """Minutes per cause — the sum of `attribute_gaps`, so the two can never disagree."""
    return by_cause_of(attribute_gaps(gaps, events))


def _has_worn_evidence(night_dir: str, model: str) -> bool | None:
    spec = WORN_EVIDENCE_BY_MODEL.get(model)
    if spec is None:
        return None
    files = glob.glob(os.path.join(night_dir, spec[0]))
    if not files:
        return None
    read_one = False  # did ANY file actually get read down its named column?
    for f in files:
        try:
            with open(f, encoding="utf-8", errors="replace") as fh:
                head = next(fh, None)
                if head is None:
                    continue  # an empty file cannot vouch for wear
                cols = [c.strip() for c in re.split(r"[;,]", head.rstrip("\n"))]
                if spec[1] not in cols:
                    continue  # a header that does not name the column cannot vouch either way
                col = cols.index(spec[1])
                read_one = True
                for line in fh:
                    parts = re.split(r"[;,]", line.rstrip("\n"))
                    if len(parts) > col:
                        try:
                            if float(parts[col]) > 0:
                                return True
                        except ValueError:
                            continue  # a torn row (a live file's tail, a repeated header) is not evidence either way
        except OSError:
            continue  # an unreadable evidence file cannot vouch for wear; the next file may
    # False is a VERDICT -- "every measured value this device wrote was absent" -- and it is only ours to
    # give when a column was actually read. Files that existed but could not be opened, were empty, or
    # named no such column leave the question open, so the answer is null, not "not worn".
    return False if read_one else None


# ── WEAR ENDS — WHY EACH H10 / VERITY / RING FILE ENDED, AND WHERE THE WORN INTERVAL STOPS ──────────
# The loss ledger above says whether a stream had GAPS. It cannot say whether the device was WORN: on
# 2026-09-23 the H10 came off at 04:21:47 and streamed an empty strap (HR 82→172 bpm, ACC flat) for 27½
# min with 0.0 lost; on 2026-09-22 the same for 102 min — that window held 2 766 of the night's 2 767
# "PVCs" (#3001). File span is therefore not the worn interval, and this block reports the interval's END
# per device with a NAMED reason, never a bare boolean:
#   `doff`                    the device's own signal shows the removal (H10: an off-body tail; Verity: the
#                             removal burst in the final epoch; ring: the paired PPG2W file's off-finger tail)
#   `link-loss`               no removal signature, and the same stream's next file starts within
#                             WEAR_RELINK_S — the external label the thresholds below were validated against
#   `quiet-end-unclassified`  neither: no signature and no reconnect. Stated, not guessed.
# Reported, gated by NOTHING (the ring's `ppg2w_contact` precedent): a night the wearer ended early is not
# a capture failure.
#
# MEASURED vs CHOSEN, with the derivation AND the held-out record — including every miss — so the next miss
# is read against this record rather than re-tuned around (Wren, 2026-09-24; survey + pre-registrations in
# the measurer's notes on the box, thresholds frozen BEFORE the held-out nights were read):
#
#   H10 — epoch = 10 s, clock-aligned; rel = epoch ECG sd / the FILE's own median epoch ECG sd.
#   tail_off := the file's trailing run of rel >= H10_TAIL_REL_MIN is >= H10_TAIL_RUN_EPOCHS long.
#   H10_TAIL_REL_MIN = 5      CHOSEN between the worn upper edge (p99 1.2–2.2x, runs to 3x) and the off-body
#                             MINIMUM, 9.8x (n = 10 tails): sqrt(2.2 x 9.8) = 4.6, rounded up.
#   H10_TAIL_RUN_EPOCHS = 6   CHOSEN: 2 above the longest SUSTAINED worn run at >= 5x in derivation (4 epochs,
#                             2026-09-03 19:19).
#   derivation 2026-08-25..09-10, 26 files: off-body tails caught 9/10 — the miss, 2026-09-06 00:07, had a
#     4-epoch (40 s) tail: out of range before any sustained run could exist, a limit of every sustained
#     rule. Worn runs reaching 6 epochs: 0/26.
#   HELD-OUT 2026-09-11..09-23, 17 files: the one labelled night (09-23) flagged, doff 04:21:47 against a
#     pre-registered 04:21:40–04:22:40. ⚠️ THE MARGIN ON RUN LENGTH IS ZERO: one held-out file (2026-09-13
#     21:35) has a WORN run of exactly 6 epochs mid-file. It is not a false TAIL (only the trailing run is
#     read), but a worn run of 6 at a file's end would be called a doff. `max_worn_run` is published on
#     every block so the margin is visible night by night — do not raise the run length on one new miss;
#     re-derive on a fresh held-out set.
#   ACC stillness is NOT a condition: off-body tails read 0.8–1.7 mG sd, a still sleeping body's p10 is
#     1.2–4.7 mG. They overlap.
#
#   VERITY — why neither live vote is used: `optical_worn` (median |ambient| < 5000) is blind in a dark room
#   (2026-09-23's removal moved ambient -185 → -98), and `pulse_prominence` refuses under 4096 samples (74 s
#   at 55 Hz) while the Verity stops streaming ~10 s after removal, so any prominence window at the end is
#   mostly worn signal.
#   ⚠️ THE WINDOW IS BINDING: the FINAL EPOCH is the last CLOCK-ALIGNED 10-s bin (floor of the phone stamp's
#   seconds-of-day / 10) holding at least half the file's median epoch fill. On 2026-09-23 this window gives
#   an ambient ratio of 3.2; a trailing-10-s window ending at the last row gave 20.6 on the same file. The
#   verdict held under both; the value did not, and the thresholds were validated on the clock-aligned one.
#   doff := final ambient-sd ratio (vs the file's median epoch) >= VERITY_END_AMB_RATIO_MIN
#           OR final-epoch ACC |a| sd >= VERITY_END_ACC_SD_MIN
#   VERITY_END_AMB_RATIO_MIN = 1.5   CHOSEN between the link-loss ends' max (1.11) and the dark-room doff min (1.84)
#   VERITY_END_ACC_SD_MIN = 150      CHOSEN between the link-loss ends' max (23.3 mG) and the motion-only doff
#                                    min (170.4 mG). Worn p99 50.8, p99.9 257 — turning in bed; the label, not
#                                    motion, is what a link loss is judged by.
#   label = the gap to the stream's next file: > 1 h ended for the night, < 30 min link loss.
#   derivation 2026-08-25..09-10, 27 ends: night-ends called doff 14/15 — miss 2026-08-28 06:18 (ambient
#     0.98, ACC 2.2: no removal signature; a quiet end). Link-loss ends called doff 0/12.
#   HELD-OUT 2026-09-11..09-23, 18 ends: night-ends 13/14, link-loss ends 0/4. The miss, 2026-09-19 06:04
#     (ambient 0.96, ACC 139.5 mG), sits against a LINK-LOSS end the same night at 20:27 with ACC 131.8 mG:
#     motion alone cannot separate them and no threshold on it would. A feature limit, stated, not tuned.
#
#   RING — one end per `*_SPO2.csv` (the primary), judged by TWO of the device's own witnesses:
#   (1) the paired `*_PPG2W.txt` (same file stamp) has nightqc's off-finger tail — `ppg2w_contact`, its constants
#       untouched, epoched on CLOCK SECONDS (a fixed 100-row epoch put 2026-09-22's doff 5 h 37 min late once the
#       stream ran at ~199 rows/s);
#   (2) the ring's SpO2 stream stopped where that tail began: doff_at >= the SpO2 file's last row -
#       RING_DOFF_SPO2_AGREE_S. The ring stops reporting SpO2 when the finger leaves.
#   RING_DOFF_SPO2_AGREE_S = 30   CHOSEN between agreeing tails (doff_at - SpO2 last row = 0..+4 s on all 36,
#                                 2026-08-25..09-23) and the only two disagreeing ones (-80 s 2026-09-07 08:01,
#                                 -202 s 2026-09-11 20:15). Both of those held SpO2 98-100 % with a live pulse and
#                                 ch1 ~ 400 k counts through the "off" tail: the ch0/ch1 ratio drifted to ~3.3-3.6,
#                                 over PPG2W_RATIO_HI, with the finger IN. ⚠️ NO HELD-OUT RECORD: both were seen
#                                 before this rule was written, so the nights after 2026-09-23 are its held-out set.
#                                 A disagreeing tail is published (`ppg2w_contradicted`), never silently dropped.
#   The relink label is WEAKER for the ring than for the Polar pair: after a removal the daemon's own doff-pull and
#   reconnect open a new file (docs/O2RING-FINGER-OFF-2026-09-19.md), so a real doff can sit < 30 min before the next
#   file — 2026-09-07 07:32 (gap 468 s, both witnesses agree) reads `doff`, correctly, against a `link` label.
#   Ends by label 2026-08-25..09-23 under this rule: night-ends 33/33 usable-with-tail called doff (5 not: 3 under
#   60 s of PPG2W, refused; 2 daytime sessions with no tail -> quiet); link-labelled ends 1/40 (the one above).
WEAR_EPOCH_S = 10  # an INT: epoch keys and starts are integer arithmetic end to end
H10_TAIL_REL_MIN = 5.0
H10_TAIL_RUN_EPOCHS = 6
H10_MIN_EPOCHS = 60  # the derivation's floor: under 10 min there is no file baseline to judge against
VERITY_END_AMB_RATIO_MIN = 1.5
VERITY_END_ACC_SD_MIN = 150.0
VERITY_MIN_EPOCHS = 30  # the derivation's floor for a Verity file
WEAR_RELINK_S = 1800.0  # the label: a next file within 30 min is a reconnect
_ACC_TAIL_BYTES = 262_144  # the final epoch's ACC rows sit in the last ~25 KB at 52 Hz; 256 KB is generous
_ACC_MIN_ROWS = 50  # fewer ACC rows in the final epoch is not a motion measurement
_WEAR_STREAM = {"H10": ("Polar_H10_*_ECG.txt", [3]), "VeritySense": ("Polar_VeritySense_*_PPG.txt", [5])}
RING_DOFF_SPO2_AGREE_S = 30.0
_RING_SPO2 = "Wellue_O2Ring-S_*_SPO2.csv"
_TAIL_BYTES = 4096  # the last stamped row of an SpO2 file sits in its final ~30 bytes
_STAMP_IN_NAME = re.compile(r"_(\d{14})_")


def h10_tail(epoch_sd: list[float]) -> dict | None:
    """The off-body tail rule over one file's epoch ECG sds, in order. PURE. `None` when the file is too short
    to have a baseline, or has no variance to judge against — never a tail_off=False it did not measure."""
    n = len(epoch_sd)
    if n < H10_MIN_EPOCHS:
        return None
    med = statistics.median(epoch_sd)
    if not med > 0:
        return None
    rel = [s / med for s in epoch_sd]
    trail = sum(1 for _ in itertools.takewhile(lambda r: r >= H10_TAIL_REL_MIN, reversed(rel)))
    best = cur = 0
    for r in rel[: n - trail]:
        cur = cur + 1 if r >= H10_TAIL_REL_MIN else 0
        best = max(best, cur)
    return {"epochs": n, "trailing_off_epochs": trail, "tail_off": trail >= H10_TAIL_RUN_EPOCHS, "max_worn_run": best}


def verity_end_doff(final_amb_ratio: float | None, final_acc_sd: float | None) -> bool | None:
    """The Verity final-epoch rule. PURE. `None` only when neither feature was measured."""
    if final_amb_ratio is None and final_acc_sd is None:
        return None
    amb = final_amb_ratio is not None and final_amb_ratio >= VERITY_END_AMB_RATIO_MIN
    acc = final_acc_sd is not None and final_acc_sd >= VERITY_END_ACC_SD_MIN
    return amb or acc


def end_reason(doff: bool | None, relink_gap_s: float | None) -> str:
    """The named reason for one file end. PURE: the device's own evidence first, the reconnect label second."""
    if doff:
        return "doff"
    if relink_gap_s is not None and relink_gap_s <= WEAR_RELINK_S:
        return "link-loss"
    return "quiet-end-unclassified"


def epoch_stats(path: str, cols: list[int]) -> tuple[list[tuple[_dt.datetime, int, float]], _dt.datetime | None]:
    """One capture file → clock-aligned WEAR_EPOCH_S epochs [(start, rows, sd)] and the last row's stamp.
    Streaming (a running Welford mean/M2 per epoch), because an H10 ECG file is ~300 MB. Three columns are
    read as a vector magnitude (ACC). An epoch holding under half the file's median fill is dropped — a
    torn edge is not a measurement. Keys are absolute (day ordinal x 86400 + seconds of day), so a file that
    crosses midnight bins on one clock without a per-file origin."""
    bins: dict[int, list[float]] = {}
    width = max(cols)
    with open(path, "rb") as fh:
        for raw in fh:
            parts = raw.decode("utf-8", "replace").split(";")
            stamp = parts[0]
            if len(parts) <= width or len(stamp) < 19:
                continue  # the header, a row missing its value column, a stamp without a time: not samples
            try:
                vals = [float(parts[c]) for c in cols]
                day = _dt.date.fromisoformat(stamp[:10]).toordinal()
                sec = int(stamp[11:13]) * 3600 + int(stamp[14:16]) * 60 + float(stamp[17:23])
            except ValueError:
                continue  # a torn row at a live file's tail, a repeated header — skipped, not fatal
            v = vals[0] if len(vals) == 1 else math.sqrt(sum(x * x for x in vals))
            key = int(day * 86400 + sec) // WEAR_EPOCH_S
            b = bins.get(key)
            if b is None:
                bins[key] = [1, v, 0.0]
            else:
                b[0] += 1
                delta = v - b[1]
                b[1] += delta / b[0]
                b[2] += delta * (v - b[1])
            last = stamp[:23]
    if not bins:
        return [], None
    fill = statistics.median(b[0] for b in bins.values())
    out = []
    for key in sorted(bins):
        n, _mean, m2 = bins[key]
        if n < 0.5 * fill or n < 2:
            continue
        day, sod = divmod(key * WEAR_EPOCH_S, 86400)
        start = _dt.datetime.fromordinal(day) + _dt.timedelta(seconds=sod)
        out.append((start, int(n), math.sqrt(m2 / n)))
    return out, _dt.datetime.fromisoformat(last)


def _final_acc_sd(acc_path: str, start: _dt.datetime) -> float | None:
    """|a| sd over the ACC rows inside one epoch [start, start + WEAR_EPOCH_S), read from the file's TAIL."""
    if not os.path.exists(acc_path):
        return None
    lo = start.isoformat(timespec="milliseconds")
    hi = (start + _dt.timedelta(seconds=WEAR_EPOCH_S)).isoformat(timespec="milliseconds")
    mags = []
    with open(acc_path, "rb") as fh:
        fh.seek(max(0, os.path.getsize(acc_path) - _ACC_TAIL_BYTES))
        for raw in fh.read().decode("utf-8", "replace").splitlines():
            parts = raw.split(";")
            if len(parts) < 5 or not (lo <= parts[0] < hi):
                continue
            try:
                mags.append(math.sqrt(sum(float(parts[c]) ** 2 for c in (2, 3, 4))))
            except ValueError:
                continue  # a torn ACC row is skipped, never counted as motion
    return statistics.pstdev(mags) if len(mags) > _ACC_MIN_ROWS else None


def _relink_gap(night_dir: str, pattern: str, end: _dt.datetime) -> float | None:
    """Seconds from `end` to the next file of the same stream — this night's folder and the next day's."""
    try:
        nxt_day = (
            _dt.datetime.strptime(os.path.basename(night_dir.rstrip("/")), "%Y-%m-%d") + _dt.timedelta(days=1)
        ).strftime("%Y-%m-%d")
        dirs = [night_dir, os.path.join(os.path.dirname(night_dir.rstrip("/")), nxt_day)]
    except ValueError:
        dirs = [night_dir]
    starts = []
    for d in dirs:
        for f in glob.glob(os.path.join(d, pattern)):
            m = _STAMP_IN_NAME.search(os.path.basename(f))
            if m:
                starts.append(_dt.datetime.strptime(m.group(1), "%Y%m%d%H%M%S"))
    later = [s for s in starts if s > end - _dt.timedelta(seconds=5)]
    return (min(later) - end).total_seconds() if later else None


def _wear_end(path: str, night_dir: str, model: str) -> dict:
    pattern, cols = _WEAR_STREAM[model]
    base = os.path.basename(path)
    ep, last = epoch_stats(path, cols)
    floor = H10_MIN_EPOCHS if model == "H10" else VERITY_MIN_EPOCHS
    if len(ep) < floor or last is None:
        return {"file": base, "usable": False, "reason": f"under {floor} epochs of {WEAR_EPOCH_S:.0f} s"}
    gap = _relink_gap(night_dir, pattern, last)
    if model == "H10":
        t = h10_tail([e[2] for e in ep])
        if t is None:
            return {"file": base, "usable": False, "reason": "no ECG variance to judge a tail against"}
        doff = t["tail_off"]
        worn_end = ep[len(ep) - t["trailing_off_epochs"]][0] if doff else last
        detail = t
    else:
        med = statistics.median(e[2] for e in ep)
        final = ep[-1]
        amb = final[2] / med if med > 0 else None
        acc = _final_acc_sd(path[: -len("_PPG.txt")] + "_ACC.txt", final[0])
        doff = verity_end_doff(amb, acc)
        worn_end = last  # the Verity stops ~10 s after removal: the removal IS the final epoch
        detail = {
            "epochs": len(ep),
            "final_epoch_at": final[0].isoformat(timespec="seconds"),
            "final_amb_ratio": None if amb is None else round(amb, 2),
            "final_acc_sd": None if acc is None else round(acc, 1),
        }
    return {
        "file": base,
        "usable": True,
        "end_at": last.isoformat(timespec="seconds"),
        "worn_end_at": worn_end.isoformat(timespec="seconds"),
        "reason": end_reason(doff, gap),
        "relink_gap_s": None if gap is None else round(gap),
        **detail,
    }


def _last_stamp(path: str) -> _dt.datetime | None:
    """The last parseable row stamp of a capture file (either layout the box writes), read from its tail."""
    with open(path, "rb") as fh:
        fh.seek(max(0, os.path.getsize(path) - _TAIL_BYTES))
        lines = fh.read().decode("utf-8", "replace").splitlines()
    for line in reversed(lines):
        stamp = _ni.parse_stamp(line)
        if stamp is not None:
            return stamp
    return None


def ring_end_doff(tail_off: bool | None, doff_at: _dt.datetime | None, spo2_last: _dt.datetime) -> bool | None:
    """The ring's two-witness rule. PURE. `None` when the PPG2W witness was not measured."""
    if tail_off is None:
        return None
    if not tail_off or doff_at is None:
        return False
    return (doff_at - spo2_last).total_seconds() >= -RING_DOFF_SPO2_AGREE_S


def _ring_end(path: str, night_dir: str, contact: list[dict]) -> dict:
    base = os.path.basename(path)
    last = _last_stamp(path)
    if last is None:
        return {"file": base, "usable": False, "reason": "no stamped SpO2 row"}
    m = _STAMP_IN_NAME.search(base)
    blk = next((b for b in contact if m and f"_{m.group(1)}_" in b["file"]), None)
    if blk is None or not blk["usable"]:
        tail, doff_at, why = None, None, "no paired PPG2W file" if blk is None else blk["reason"]
    else:
        tail, why = blk["tail_off"], None
        doff_at = _dt.datetime.fromisoformat(blk["doff_at"]) if blk["doff_at"] else None
    doff = ring_end_doff(tail, doff_at, last)
    gap = _relink_gap(night_dir, _RING_SPO2, last)
    worn_end = last
    if doff:
        assert doff_at is not None  # ring_end_doff is never True without a doff time
        worn_end = doff_at
    return {
        "file": base,
        "usable": True,
        "end_at": last.isoformat(timespec="seconds"),
        "worn_end_at": worn_end.isoformat(timespec="seconds"),
        "reason": end_reason(doff, gap),
        "relink_gap_s": None if gap is None else round(gap),
        "ppg2w_file": None if blk is None else blk["file"],
        "ppg2w_unusable": why,
        "tail_off": tail,
        "doff_at": None if doff_at is None else doff_at.isoformat(timespec="seconds"),
        "ppg2w_contradicted": bool(tail) and doff is False,
    }


def wear_ends(night_dir: str, model: str) -> dict:
    """Every H10 / Verity / ring file end in the night with its named reason, and the device's worn-interval
    END — the latest usable end. A model without a rule says so in words, never a bare null.

    The ring recomputes `nightqc.ppg2w_contact_quality` rather than reading the night's QC summary: summaries
    written before the clock-second epoch carry a wrong `doff_at`. One pass per settled night, ~300 MB peak."""
    ring = model == "O2Ring-S"
    spec = (_RING_SPO2, []) if ring else _WEAR_STREAM.get(model)
    if spec is None:
        return {"available": False, "reason": f"no wear-end rule for model {model!r}"}
    contact = nightqc.ppg2w_contact_quality(night_dir) if ring else []
    ends = []
    for f in sorted(glob.glob(os.path.join(night_dir, spec[0]))):
        try:
            ends.append(_ring_end(f, night_dir, contact) if ring else _wear_end(f, night_dir, model))
        except OSError as exc:
            ends.append({"file": os.path.basename(f), "usable": False, "reason": f"unreadable: {exc!r}"})
    usable = [e for e in ends if e["usable"]]
    last = max(usable, key=lambda e: e["end_at"]) if usable else None
    worn_end = {"at": last["worn_end_at"], "reason": last["reason"], "file": last["file"]} if last else None
    return {"available": True, "ends": ends, "worn_end": worn_end}


def audit_night(night_dir: str, devices: list[dict], *, journal=read_journal) -> dict:
    """The LOSS-AUDIT.json body: per device, the primary stream's gaps by cause, span, and whether the
    device's own evidence says it was worn that night."""
    night = os.path.basename(night_dir.rstrip("/"))
    try:
        day = _dt.datetime.strptime(night, "%Y-%m-%d")
    except ValueError:
        day = _dt.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    since, until = day - _dt.timedelta(hours=6), day + _dt.timedelta(hours=30)
    out: dict = {"night": night, "devices": {}, "journal": "read"}
    for d in devices:
        if not isinstance(d, dict):
            continue
        model = str(d.get("model") or "")
        pat = PRIMARY_BY_MODEL.get(model)
        name = str(d.get("name") or model)
        if not pat:
            out["devices"][name] = {"primary": None, "reason": f"no primary stream known for model {model!r}"}
            continue
        files = glob.glob(os.path.join(night_dir, pat))
        if not files:
            out["devices"][name] = {"primary": pat, "file": None, "reason": "no primary file this night"}
            continue
        f = max(files, key=os.path.getsize)
        try:
            gaps, span, cut = stream_gaps(f)
        except OSError as exc:
            out["devices"][name] = {"primary": pat, "file": os.path.basename(f), "reason": f"unreadable: {exc!r}"}
            continue
        address = str(d.get("address") or "")
        ev = journal((name, address) if address else name, since, until)
        if ev is None:
            out["journal"] = "unavailable — every gap is unattributed"
        per_gap = attribute_gaps(gaps, ev)
        by_cause = by_cause_of(per_gap)
        lost = sum(by_cause.values())
        worn = _has_worn_evidence(night_dir, model)
        out["devices"][name] = {
            "primary": pat,
            "file": os.path.basename(f),
            "span_min": round(span / 60.0, 1),
            "gap_cut_s": round(cut, 2),
            "fragments": len(gaps) + 1,
            "lost_min": round(lost, 1),
            "by_cause": {k: round(v, 1) for k, v in sorted(by_cause.items(), key=lambda kv: -kv[1])},
            # every gap with its start, length and cause — what `by_cause` sums, kept so a consumer can
            # count gaps inside the worn interval (SOLID-NIGHT §3.4) rather than over the whole file.
            # ⚠️ Gaps of `primary` ONLY: a fragmented night's other files are not audited yet
            # (residue 2026-09-24-loss-audit-audits-only-the-largest-file), so an empty list is "none in
            # this file", never "none in the night".
            "gaps": [{"at": t.isoformat(timespec="seconds"), "s": round(g, 1), "cause": c} for t, g, c in per_gap],
            "worn_evidence": worn,
            "worn_lost_min": round(lost, 1) if worn else (0.0 if worn is False else None),
            "daemon_caused_min": round(sum(v for k, v in by_cause.items() if k.startswith("daemon:")), 1),
            # where the WORN interval ends, per device, with its reason — gaps above are not wear
            "wear": wear_ends(night_dir, model),
        }
    return out


def night_verdict(audit: dict, *, night_dir: str, commit: str | None = None) -> dict:
    """One `tepna.verdict/1` over the night: population = configured devices with a primary stream on disk
    (checked) vs those without (excluded). UNKNOWN with the measurement until a bar exists; with a bar,
    FAIL names the device and the cause."""
    devs = audit.get("devices") or {}
    checked = {n: v for n, v in devs.items() if isinstance(v, dict) and v.get("file")}
    excluded = len(devs) - len(checked)
    pop = {"checked": len(checked), "eligible": len(devs), "excluded": excluded}
    evidence = [TOOL, os.path.join(night_dir, AUDIT_NAME), "journalctl -u tepna-capture"]
    worn_span = sum(v["span_min"] for v in checked.values() if v.get("worn_evidence"))
    worn_lost = sum(v["worn_lost_min"] or 0.0 for v in checked.values() if v.get("worn_evidence"))
    frac = round(worn_lost / worn_span, 4) if worn_span > 0 else None
    result = {
        "worn_but_not_recorded_fraction": frac,
        "worn_lost_min": round(worn_lost, 1),
        "worn_span_min": round(worn_span, 1),
        "daemon_caused_min": round(sum(v.get("daemon_caused_min") or 0.0 for v in checked.values()), 1),
        "by_device": {
            n: {"lost_min": v["lost_min"], "fragments": v["fragments"], "top_cause": next(iter(v["by_cause"]), None)}
            for n, v in checked.items()
        },
        "journal": audit.get("journal"),
    }
    if not devs:
        return _verdict.make(
            gate=GATE,
            status="NOT_RUN",
            population=pop,
            criterion=CRITERION,
            result=None,
            evidence=evidence,
            reason="no device is configured — nothing to audit",
            tool=TOOL,
            commit=commit,
        )
    if not checked:
        return _verdict.make(
            gate=GATE,
            status="NOT_RUN",
            population=pop,
            criterion=CRITERION,
            result=None,
            evidence=evidence,
            reason="no configured device left a primary stream this night",
            tool=TOOL,
            commit=commit,
        )
    if THRESHOLD is None:
        return _verdict.make(
            gate=GATE,
            status="UNKNOWN",
            population=pop,
            criterion=CRITERION,
            result=result,
            evidence=evidence,
            reason="no bar has been set by the owner for worn-but-not-recorded — measured, not judged"
            + (f" (daemon-caused: {result['daemon_caused_min']} min)" if result["daemon_caused_min"] else ""),
            tool=TOOL,
            commit=commit,
        )
    if frac is None:  # pragma: no cover — reachable only once THRESHOLD is set and no device carried worn evidence
        return _verdict.make(
            gate=GATE,
            status="NOT_APPLICABLE",
            population=pop,
            criterion=CRITERION,
            result=None,
            evidence=evidence,
            reason="no device carried worn evidence this night — the criterion does not bind",
            tool=TOOL,
            commit=commit,
        )
    if frac <= THRESHOLD:  # pragma: no cover — bar-dependent branch, exercised the day THRESHOLD is set
        return _verdict.make(
            gate=GATE,
            status="PASS",
            population=pop,
            criterion=CRITERION,
            result=result,
            evidence=evidence,
            reason=None,
            tool=TOOL,
            commit=commit,
        )
    worst = max(checked.items(), key=lambda kv: kv[1]["lost_min"])  # pragma: no cover
    return _verdict.make(
        gate=GATE,
        status="FAIL",
        population=pop,
        criterion=CRITERION,
        result=result,
        evidence=evidence,  # pragma: no cover
        reason=f"{frac:.1%} of the worn span unrecorded (bar {THRESHOLD:.1%}); worst {worst[0]}: "
        f"{worst[1]['lost_min']} min, top cause {next(iter(worst[1]['by_cause']), 'none')}",
        tool=TOOL,
        commit=commit,
    )


def write_night(night_dir: str, devices: list[dict], *, commit: str | None = None, journal=read_journal) -> dict:
    """Audit + verdict beside the summary; returns the verdict. Never raises past a crash → UNKNOWN."""
    import json

    try:
        audit = audit_night(night_dir, devices, journal=journal)
        tmp = os.path.join(night_dir, AUDIT_NAME + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(audit, fh, indent=1)
        os.replace(tmp, os.path.join(night_dir, AUDIT_NAME))
        obj = night_verdict(audit, night_dir=night_dir, commit=commit)
    except Exception as exc:  # noqa: BLE001 — a crash is not a verdict
        obj = _verdict.unknown(
            gate=GATE, criterion=CRITERION, evidence=[TOOL, os.path.join(night_dir, AUDIT_NAME)], tool=TOOL, exc=exc
        )
    try:
        _verdict.write(os.path.join(night_dir, VERDICT_NAME), obj)
    except (OSError, ValueError):
        pass  # the object is returned to the caller either way; the file is the convenience
    return obj


def sample_object() -> dict:
    """Corpus-free emission for the adoption gate: a synthetic night with one torn stream and a planted
    journal — UNKNOWN with the number, because no bar exists."""
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        night = os.path.join(d, "2026-01-01")
        os.makedirs(night)
        t0 = _dt.datetime(2026, 1, 1, 22, 0, 0)
        with open(os.path.join(night, "Polar_H10_SAMPLE_20260101220000_ECG.txt"), "w", encoding="utf-8") as fh:
            fh.write("Phone timestamp;x\n")
            for i in range(0, 600):
                if 200 <= i < 320:
                    continue  # a 2-minute hole
                fh.write((t0 + _dt.timedelta(seconds=i)).isoformat(timespec="milliseconds") + ";1\n")
        with open(os.path.join(night, "Polar_H10_SAMPLE_20260101220000_HR.txt"), "w", encoding="utf-8") as fh:
            fh.write("Phone timestamp;HR [bpm]\n" + (t0.isoformat(timespec="milliseconds") + ";62\n"))
        planted = [(t0 + _dt.timedelta(seconds=199), "daemon:not-worn drop")]
        return write_night(
            night,
            [{"name": "Polar H10 SAMPLE", "model": "H10"}],
            commit=None,
            journal=lambda name, since, until: planted,
        )

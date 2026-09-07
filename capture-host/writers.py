# tepna-capture — writers.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Vendor-layout file writers. This is the SUITE-CRITICAL layer: it makes the box emit byte-shapes
# the existing Tepna parsers/adapters already read, so NOTHING downstream changes (no new parser
# branch). It also owns the Clock Contract obligations and the device-id filename convention.
#
# Clock Contract (CLAUDE.md §🔒) as honored here:
#   - "Phone timestamp" is written as ZONE-FREE LOCAL-CIVIL ISO  (e.g. 2026-06-25T21:53:00.123).
#     -> parser branch 3 -> Date.UTC(components) -> floating wall-clock tMs. NEVER raw epoch as the
#     primary stamp (drags in viewer-tz ambiguity); NEVER fabricate a stamp for a dropped packet.
#   - The Polar "sensor timestamp [ns]" (ns since 2000-01-01) is carried as a SECONDARY column only.
#   - A gap in capture is a GAP in the file (we simply stop writing rows), never invented "now()" rows.
#
# WHICH COLUMN IS A SAMPLE CLOCK (measured 2026-07-18, 2.4 M rows of real corpus):
#   - "sensor timestamp [ns]" / "timestamp [ms]" = the DEVICE clock. This is the sample clock; anything
#     computing rates, diffs, bins or merges must use it.
#     ⚠️ The "ZERO backward steps" this note originally claimed held only for the streams then measured.
#     A full Verity night (2026-07-19) put 678 backward steps in MAG's DEVICE column, to -112 ms —
#     because decode_frame back-timed off the NOMINAL rate while the die actually ran at 20.516 Hz, so
#     each frame over-reached into its predecessor. Fixed at the source (polar_pmd derives the step from
#     consecutive last_ns; PMD-DECODE-SCALE-AND-RATE-2026-07-19-BRIEF). The column is monotonic again,
#     with ONE residual class that is not ours to fix: an out-of-order BLE notification whose own last_ns
#     regressed, which we report faithfully rather than synthesise. Files written BEFORE that fix still
#     carry the old skew — check, don't assume.
#   - "Phone timestamp" = the host ARRIVAL stamp. It steps BACKWARDS at ~0.5-0.8 % of rows on the
#     back-timed continuous streams (ECG/PPG/ACC/GYRO/MAG), always at an exact frame boundary — median
#     ~1.8 samples, worst 42. Cause: decode_frame back-times each frame from ITS OWN notification
#     arrival (`arrival - back/fs`), and BLE arrival jitters (bursty delivery) while the device clock
#     does not. This is inherent to arrival stamping — Polar Sensor Logger's own column behaves the
#     same way — and it is deliberately NOT smoothed: filtering it would fabricate precision the
#     arrival stamp does not have and destroy the only record of real link timing.
#   - PPI/HR are per-beat EVENTS and are NOT back-timed (back=0), so their Phone column IS monotonic.
#     PulseDex reads that column and uses a one-way two-pointer matcher, so it depends on this.
#   Invariants pinned by tests/test_polar_pmd.py (frame-seam group). Impact audit: no Dex currently
#   mis-computes from the seam — the only phone-column consumer on a back-timed stream is ECGDex's
#   parseDeviceACC, whose worst 175 ms slip never crosses its 30 s epoch boundary.

from __future__ import annotations
import errno as _errno, logging, os, re as _re, datetime as _dt, time as _time
from typing import Iterable, TextIO

# The annotation values a device INSERTS into a stream live with the device, not here — the merge
# rule takes them as a parameter so it never carries a marker literal. `oxyii` imports nothing local,
# so this is not a cycle.
import oxyii as _oxyii

# The writers use big OS buffers for throughput (StreamWriter 1 MB, Spo2CsvWriter 64 KB) and would
# otherwise only hit disk on close(). Overnight that means a hard kill or power loss loses the entire
# unflushed tail (up to a full buffer — minutes of ECG, or ~an hour of the slow 1/s SpO2 stream). So
# every writer force-flushes on a wall-clock cadence: flush() moves Python's buffer to the OS page
# cache (survives a process crash) and fsync() forces the OS cache to the physical medium (survives a
# power loss). At this cadence at most FLUSH_INTERVAL_S of the tail is ever at risk. `_time.monotonic()`
# drives the cadence — it's internal timing, not a written stamp, so the Clock Contract doesn't apply.
FLUSH_INTERVAL_S = 5.0

# ── THE LIVE RULE IS `stuck` — ONE number, cited by both sides ────────────────────────────────
# A run-length rule at a LOW threshold is not viable and was measured not to be: legitimate 8-bit
# pleth plateaus routinely reach 5-9 samples (7.3 % of non-sentinel runs are >= 5; p99 = 14,
# p99.9 = 31, p99.99 = 48), so any threshold small enough to catch the worst-severity band (10-40)
# also flags real signal. The live writer therefore emits only the rule that a plateau cannot reach:
# a constant run of >= T_STUCK samples, four times the plateau p99.99.
#
# The two rules that need the WHOLE night — `clip` (the ring's 199-clip is not an encoding extreme,
# so "at the range extreme" is only knowable once the night's range is) and `collapse` (a running
# median over ~600 samples, O(window) per sample on the BLE notification path) — are deliberately
# NOT here. They belong to the end-of-night back-check, which has the whole recording and no P0
# exposure. Adding them live would risk dropped notifications to better describe the stream.
#
# This constant is the single source; it ALSO travels in each sidecar's comment line, so a consumer
# reads the threshold that actually produced those rows rather than whatever the default has moved
# to since. If a JS side ever recomputes these spans, that constant must be asserted equal to this
# one by a gate that has been shown to RED on a mismatch.
T_STUCK = 200

# Which streams get a sidecar, and at what threshold. A stream absent from this map gets none — but
# note ACC is PRESENT: it is not excluded by name, it is CLASSIFIED (below), so a firmware change
# that stops it being a zero-order hold starts producing rows without anyone editing this list.
RUN_MIN_BY_STREAM = {
    "ppg1":   T_STUCK,   # O2Ring, single reflectance column
    "ppg":    T_STUCK,   # Verity 3-LED (same writer, 3-column branch)
    "ppg2w":  T_STUCK,   # O2Ring raw dual-wavelength (cmd 0x05)
    "acc":    T_STUCK,   # Polar ACC
    "accraw": T_STUCK,   # O2Ring ACC — a zero-order hold; the classifier catches it
}

# ── ZERO-ORDER-HOLD DETECTION — computed, never a name-based exclusion ────────────────────────
# The O2Ring's ACC is sampled at 1.5625 Hz and written at 10 Hz, so ~99.8 % of its runs are length
# 6 or 7 and a constant-run rule would flag the entire stream. The fix is NOT to exclude "acc" by
# name: a name list is a claim about today's devices that keeps reading as correct after a firmware
# change, and it would equally miss a NEW held stream nobody thought to list. Instead the shape is
# measured — a run-length distribution that is a near-delta on two ADJACENT lengths is a hold, and
# such a stream is marked once and its run rows suppressed.
#
# The verdict is taken over a warm-up window because rows already written cannot be unwritten; the
# window's rows are buffered until it closes. The distribution over the WHOLE stream is kept too, so
# a stream whose character changes after the verdict is reported as a disagreement rather than
# silently carrying a stale class.
# The device injects isolated ANNOTATION samples mid-span; a span split by one must be merged before
# it is measured. 8 is the bound, against a measured maximum interruption of 6 samples.
#
# ⚠️ THE MERGE IS ANNOTATION-KEYED, NOT VALUE-AGNOSTIC, AND THAT IS DELIBERATE. An earlier draft
# merged across a short run of ANY value on the argument that a value-keyed rule rots when the vendor
# changes its marker. It was overruled on the semantics, correctly: the sidecar's claim is "NOT
# MEASURED", and a real sample of value 1 or 2 inside a zero run WAS measured — merging over it
# fabricates absence, which is the mirror image of the fabricated zero this whole file exists to
# record. The rule must be conservative about what it asserts. Measured cost of the difference on one
# file: any-value 166 spans / 5,968 samples vs annotation-only 170 / 5,650 — 2.4 %, and opposite in
# sign on flagged samples, so the loose rule is not even uniformly more sensitive.
#
# Portability is kept WITHOUT a literal in the merge: the annotation set is a per-stream PARAMETER,
# so a device that changes its marker changes one declared constant and not the rule. It must also
# match the back-check exactly — a writer that merges MORE than the back-check makes the back-check
# report spans the sidecar lacks, which reads as "sidecar incomplete" rather than as a rule mismatch.
_ANNOTATION_GAP_MAX = 8

ANNOTATIONS_BY_STREAM = {
    "ppg1":   frozenset({_oxyii.PPG_BEAT_MARKER}),   # the ring inserts one row per detected beat
    "ppg2w":  frozenset({_oxyii.PPG_BEAT_MARKER}),
    "accraw": frozenset(),                            # no annotation is inserted into the ring's ACC
    "ppg":    frozenset(),                            # Verity: no inserted rows
    "acc":    frozenset(),                            # Polar: none
}

HELD_WARMUP_RUNS = 64          # runs observed before the class is decided
HELD_TOP2_SHARE = 0.95         # share on two adjacent lengths that makes it a hold

_log = logging.getLogger("tepna-capture")


def _write_error_name(exc: BaseException) -> str:
    """The SYMBOLIC errno, because ENOSPC, EIO and EROFS want three different responses at 3am.

    Free some space · get the data off a dying drive · fix the mount. A failure count cannot tell
    them apart, and neither can `str(exc)` reliably across libc messages."""
    num = getattr(exc, "errno", None)
    if num is None:
        return type(exc).__name__          # ValueError: the handle was already closed
    return _errno.errorcode.get(num, f"errno {num}")


class _FlushHealth:
    """Whether one file's writes are reaching the disk, logged on TRANSITIONS only.

    A swallowed `flush`/`fsync` is silent data loss: the writer returns normally, capture carries on,
    and the daemon believes bytes are on disk that are not. `storage_poller` already watches free
    space and alerts — so the surface left uncovered, and the reason this exists, is every write
    failure that NEVER MOVES THE FREE-SPACE NUMBER: EIO on a failing drive, EROFS after a read-only
    remount, a quota. Those look identical to success at the writer and are invisible to a space poll.

    ⚠️ TRANSITIONS, NOT EVENTS. Whatever breaks a write tends to stay broken, so a per-failure line
    would run to tens of thousands over a night. The objection is not volume though: it is that the
    second identical line carries nothing the first did not, while BURYING the first — the only one
    that says when it started. That holds whatever `FLUSH_INTERVAL_S` is later tuned to."""

    def __init__(self, path: str) -> None:
        self.path = path
        self.failures = 0
        self.rows_lost = 0
        self.fsync_max_ms = 0.0
        self.fsync_last_ms = 0.0
        self._failing = False
        self._slow_said = False

    def failed(self, exc: BaseException) -> None:
        self.failures += 1
        self._enter(exc, "WRITE FAILED")

    def _enter(self, exc: BaseException, what: str) -> None:
        if self._failing:
            return                          # already said so; saying it again only hides the onset
        self._failing = True
        _log.warning("%s: %s (%s) — buffered data may NOT be on disk",
                     self.path, what, _write_error_name(exc))

    def put(self, fh, text: str) -> bool:
        """Append one row, and NEVER raise into the caller.

        Every row write runs inside a bleak notification callback, i.e. synchronously on the event loop
        (`loop.add_reader` → callback). An `OSError` escaping `fh.write` there does not reach the runner's
        `except` — the callback is not on the runner's stack — so asyncio's default handler prints a
        traceback per notification (130 Hz on an ECG) while the runner keeps believing it is recording,
        `flush_failures` stays 0 (the buffered write raised before `flush` got a chance to), and the
        night's tail is lost with no counter anywhere saying so. CAPTURE-HOST-RESOURCE-ORCHESTRATION-
        AUDIT §S1. A row that could not be written is COUNTED here as `rows_lost`; the transition line
        carries the errno so the 3am response is the right one.

        The same guard covers the stale-completion case: a notification delivered after the runner
        closed its writer (`ValueError: I/O operation on closed file`) is a late row, and it is counted
        as lost rather than crashing the callback — the evidence the audit's generation check wanted,
        without inventing a generation. The row is gone either way; the difference is that it is now
        a number in STATUS instead of a traceback nobody reads."""
        try:
            fh.write(text)
        except (OSError, ValueError) as e:
            self.rows_lost += 1
            self._enter(e, "ROW LOST")
            return False
        return True

    # A single `fsync` on the eMMC/SD this box records to has been measured in the hundreds of ms under
    # concurrent load, and it runs ON THE EVENT LOOP inside a notification callback — every other device's
    # host stamp waits behind it (§S2). This does not move it off the loop; it makes the stall a NUMBER
    # (`fsync_max_ms` in STATUS) so the decision to move it is taken on a measurement, not a guess.
    SLOW_FSYNC_MS = 250.0

    def fsync(self, fh) -> None:
        t0 = _time.monotonic()
        try:
            os.fsync(fh.fileno())
        finally:
            ms = (_time.monotonic() - t0) * 1000.0
            self.fsync_last_ms = ms
            if ms > self.fsync_max_ms:
                self.fsync_max_ms = ms
            if ms >= self.SLOW_FSYNC_MS and not self._slow_said:
                self._slow_said = True      # once per file: the onset is the fact, the max is in STATUS
                _log.warning("%s: SLOW fsync %.0f ms on the event loop — every live stream's host "
                             "stamps waited behind it", self.path, ms)

    def ok(self) -> None:
        """Called ONLY from `flush`, never from `close`.

        `close` runs `flush` inside its own `try`, so a `close` that merely managed to shut a handle
        would otherwise clear a failing state its own flush had just set — and report "writing again"
        about a file whose tail never landed. The recovery claim belongs to the operation that
        actually wrote."""
        if not self._failing:
            return                          # the ordinary case: nothing to report about a live file
        self._failing = False
        _log.info("%s: writing again, after %d failed flush(es) and %d lost row(s)",
                  self.path, self.failures, self.rows_lost)



# How many SAMPLE-DATA files are open right now (CAPTURE-HOST-DEEP-AUDIT §A1).
#
# `capture._now()` absorbs a DST relabelling so a recording cannot rewind an hour mid-file. That
# absorbed shift is a property of THE FILE BEING WRITTEN, not of the process — but it used to live in
# a module global with no lifetime under a `Restart=always` unit with no `RuntimeMaxSec`, so one
# autumn clock change stamped every subsequent night an hour off civil time, indefinitely. The shift
# therefore needs an expiry, and the honest one is "when the artefact it protects no longer exists":
# with nothing open, re-anchoring to civil time costs nothing, because the next sample lands in a new
# file anyway.
#
# Counted here rather than in capture.py because only the writer knows when its handle actually opens
# and closes. SAMPLE-DATA writers only — StreamWriter / Spo2CsvWriter / OxyFrameLogWriter. The
# LinkLogWriter and HostClockLogWriter sidecars are DELIBERATELY excluded: they are status logs that a
# running box holds open continuously (rolling per calendar day), so counting them would make the
# count never reach zero and the expiry would never fire — which is the whole defect. The cost is that
# a sidecar can carry one hour of overlapping rows across a transition, once, while nothing is being
# recorded; the consumer (`timeline.bucket_link`) medians per bucket and is unharmed.
_open_sample_writers = 0


def open_sample_writers() -> int:
    """Number of sample-data files currently open. See `_open_sample_writers`."""
    return _open_sample_writers


def _writer_opened() -> None:
    global _open_sample_writers
    _open_sample_writers += 1


def _writer_closed() -> None:
    global _open_sample_writers
    _open_sample_writers = max(0, _open_sample_writers - 1)


# Filename: <Vendor>_<Model>_<DeviceId>_<YYYYMMDDHHMMSS>_<STREAM>.<ext>
#
# ⚠️ This is NOT byte-identical to Polar Sensor Logger. PSL writes the stamp UNDERSCORE-SEPARATED
# (…_YYYYMMDD_HHMMSS_KIND); we write it CONTIGUOUS. Verified against the real corpus
# (`Ecg nightly/Polar_H10_02849638_20260617_010616_ACC.txt`). This comment previously claimed
# parity, and dex-ingest.js's parsers accepted only PSL's shape — so `deviceKey` returned null on
# EVERY file this host wrote, `hasDex` went false, and planIngest silently stopped setting aside
# foreign-device sidecars (ENGINE-VERIFICATION-FINDINGS §1.2).
#
# The fix is app-side: dex-ingest.js `deviceKey`/`stampMs` now accept BOTH shapes, because the
# parsers must keep reading the genuine PSL corpus regardless. The filename here is deliberately
# UNCHANGED — renaming it would orphan the ~478 nights already on disk. Do not "restore parity"
# by changing this format; widen the reader instead.
def capture_filename(vendor: str, model: str, device_id: str, started: _dt.datetime,
                     stream: str, ext: str = "txt") -> str:
    stamp = started.strftime("%Y%m%d%H%M%S")
    return f"{vendor}_{model}_{device_id}_{stamp}_{stream.upper()}.{ext}"


# THE ID IS THE TOKEN IMMEDIATELY BEFORE THE STAMP — parsed from the RIGHT, because neither the id nor
# the vendor/model prefix has a fixed field count (both may contain underscores, and a serial may be
# all digits). Three stamp shapes occur in a real corpus and all three must read:
#
#   ..._<id>_YYYYMMDDHHMMSS_TAG.ext   this host (capture_filename, contiguous)
#   ..._<id>_YYYYMMDD_HHMMSS_TAG.ext  Polar Sensor Logger (split) — see the note above capture_filename
#   ..._<id>_YYYYMMDD_TAG.ext         date-only, as older fixtures and hand-named files carry
#
# A left-to-right search cannot do this: in `Polar_H10_02849638_20260719_ECG` the pair ("H10",
# "02849638") is just as well-formed as ("02849638", "20260719"), and the leftmost match picks the
# model as the device id. Anchoring the stamp to a plausible YEAR (19xx/20xx) is what makes it
# decidable — an 8-digit serial like 02849638 is not a date, and a device id is never mistaken for one.
_DATE14 = _re.compile(r"^(?:19|20)\d{12}$")
_DATE8 = _re.compile(r"^(?:19|20)\d{6}$")
_TIME6 = _re.compile(r"^\d{6}$")


def file_stamp(fname: str) -> str | None:
    """The `YYYYMMDDHHMMSS` START stamp of a capture filename, or None when it carries none.

    THE ANCHORED SIBLING, and it exists because two callers had the unanchored one (audit F5,
    2026-08-01). `nightqc._session_of` and `timeline._stamp_ms` both searched a bare `_(\\d{14})_`,
    which takes the FIRST 14-digit run anywhere in the name. On
    `Polar_H10_20250101000000_20260725225058_ECG.txt` that is the device SERIAL, and it strptime's
    cleanly — so the file was silently keyed to a session eighteen months away rather than falling back
    to mtime. Same decidability argument `file_device_id` already makes below: parse the field from the
    RIGHT (the stamp is the token before the stream tag) and require a plausible year."""
    base = fname.rpartition(".")[0] or fname
    parts = base.split("_")
    if len(parts) < 2:
        return None
    tok = parts[-2]                          # parts[-1] is the stream tag
    return tok if _DATE14.match(tok) else None


def resumable_stamp(ndir: str, vendor: str, model: str, device_id: str,
                    now: _dt.datetime, window_s: float) -> _dt.datetime | None:
    """CAPTURE-FILESET-RESUME §2: the stamp of THIS device's newest file-set in `ndir`, IF its last
    write is younger than `window_s` — else None (mint a fresh set).

    PURE decision, filesystem-read-only. The window is judged on the newest member file's MTIME, not
    the set's stamp: the stamp says when the set STARTED, and a set that started hours ago but wrote
    ten seconds ago is exactly the one to resume. A true outage (>= window) returns None so it still
    fragments — that fragmentation is information (the 37/75-minute wedges must stay visible).

    Measured driver (2026-08-19): 2,154 sets across 76 device-nights (28.3x), and the majority case is
    the drop_not_worn duty cycle — drop at 180 s, recheck at 90 s, a fresh set per recheck. Its cadence
    sits INSIDE the default 300 s window, which is the point.
    """
    prefix = f"{vendor}_{model}_{device_id}_"
    newest: tuple[float, str] | None = None
    try:
        names = os.listdir(ndir)
    except OSError:
        return None
    for f in names:
        if not f.startswith(prefix):
            continue
        st = file_stamp(f)
        if st is None:
            continue
        try:
            m = os.path.getmtime(os.path.join(ndir, f))
        except OSError:
            continue      # vanished between listing and stat: it cannot anchor a resume, and one
                          # such file is not a reason to abandon the others
        if newest is None or m > newest[0]:
            newest = (m, st)
    if newest is None:
        return None
    if (now.timestamp() - newest[0]) >= window_s:
        return None
    try:
        return _dt.datetime.strptime(newest[1], "%Y%m%d%H%M%S")
    except ValueError:
        return None


def file_device_id(fname: str) -> str | None:
    """The device_id FIELD of a capture filename — the exact inverse of capture_filename's id slot.

    Readers used to ask `device_id in filename`, a bare substring test. Two ways that lies: a shorter
    serial sits inside a longer one ('2849638' inside '02849638') so one device claims another's
    files, and a vendor or model string containing the id matches too. Attribution has to be a field
    comparison, not a search."""
    base = fname.rpartition(".")[0] or fname
    parts = base.split("_")
    if len(parts) < 3:
        return None
    i = len(parts) - 2                      # parts[-1] is the stream tag
    if _TIME6.match(parts[i]) and i - 1 >= 0 and _DATE8.match(parts[i - 1]):
        i -= 1                              # PSL's split stamp: step over HHMMSS onto YYYYMMDD
    elif not (_DATE14.match(parts[i]) or _DATE8.match(parts[i])):
        return None
    # capture_filename ALWAYS emits vendor_model_id_stamp_tag, so a device id is never the first
    # token. That rules out the sidecars — `Tepna_<stamp>_LINK.csv` has no id field at all, and
    # reporting 'Tepna' as one would let a device named Tepna claim every night's link log.
    return parts[i - 1] if i - 1 >= 2 and parts[i - 1] else None


def device_ids(dev: dict) -> tuple[str, ...]:
    """Every device_id this device's files may legitimately carry: the current one first, then any
    `device_id_aliases`, de-duplicated and blank-free.

    A device_id is interpolated into every filename AND is an editable config field, so correcting one
    orphans everything recorded before the correction. That happened on 2026-07-26 at 06:51: the
    Verity's id went from the MAC-derived `AC0C301E` to its real Polar serial `0C301E3F`, and nightqc
    immediately reported 795 ACC rows for an armband that had written 85 MB over seven sessions —
    `ppg 0%, acc 0%, gyro 0%, mag 0%` on a night that was fine. Nothing was lost and nothing was
    logged; the files simply stopped being attributable.

    Aliases make a correction ADDITIVE instead of destructive. The on-disk record is never rewritten —
    a filename keeps saying what the daemon actually wrote at the time, which is the honest artefact —
    and the config carries the history needed to read it."""
    ids = [str(dev.get("device_id") or "").strip()]
    ids += [str(a or "").strip() for a in (dev.get("device_id_aliases") or [])]
    return tuple(dict.fromkeys(i for i in ids if i))


# What a device must carry before it is worth opening a file for. `vendor`/`model`/`device_id` are the
# three `capture_filename` interpolates — blank any of them and the night lands as `__<id>_..._ECG.txt`,
# which no adapter can route; `name` is the key everything else addresses the device by.
#
# Defined HERE, next to the filename it protects, because two independent paths must agree on it: the
# capture daemon (which refuses to spawn) and the monitor's Remember API (which refuses to persist).
# They were written separately and only the first one checked — so an unrecognised sensor was saved to
# config.yaml, reported "remembered ✓", and then silently never captured, for the rest of the box's
# life. One list, imported by both, is what stops that reappearing.
IDENTITY_FIELDS = ("name", "vendor", "model", "device_id")


def missing_identity(dev: dict) -> list[str]:
    """Which IDENTITY_FIELDS are absent or blank on `dev`. Empty == safe to open a writer for."""
    return [k for k in IDENTITY_FIELDS if not str(dev.get(k) or "").strip()]


def night_dir(root: str, started: _dt.datetime) -> str:
    # Roll a per-night folder by the recording's LOCAL start date (dateAnchor). Created lazily.
    d = os.path.join(root, "captures", started.strftime("%Y-%m-%d"))
    os.makedirs(d, exist_ok=True)
    return d


def _ns_col(sensor_ns: int | None) -> str:
    """The `sensor timestamp [ns]` field, with ABSENCE written as absence.

    `0` is IN-BAND for a nanosecond counter, so a literal zero cannot be told apart from a device that
    genuinely reported the instant zero — and a reader that trusts the column places every such row at
    the epoch. Three O2Ring raw-buffer opcodes carry no device clock at all (measured 2026-09-06 on one
    real session: ACCRAW 15120/15120, PLETHA 583/583, PPG2W 303109/303109 rows at exactly 0, against
    `PPG.txt` 1/190100 and H10 `ECG.txt` 0/214693 on the same night — so it is those opcodes, not the
    night). The refusal to invent per-sample instants was always right; only the ENCODING was wrong.

    An EMPTY field is out-of-band: it parses as absent for every reader (`int('')` raises), so
    `nightqc.file_span_sec` returns None rather than a real 0.0 span, and `#∅` absence stays absence
    instead of becoming a measurement of zero."""
    return "" if sensor_ns is None else str(sensor_ns)


def _phone_ts(when: _dt.datetime) -> str:
    # Local civil time, zone-free, millisecond precision. `when` MUST be a local (naive or local-tz)
    # datetime — pass the host arrival time. Do not pass a UTC instant.
    return when.strftime("%Y-%m-%dT%H:%M:%S.") + f"{when.microsecond // 1000:03d}"


class _RunSidecar:
    """Constant-run spans for one optical stream, written BESIDE the stream, never into it.

    A run of identical consecutive samples on an optical channel is the shape a held or dropped link
    leaves in the wave: the value is not a fresh measurement, it is the last one repeated. Capture
    cannot tell a held link from a genuinely flat signal, so it does not judge — it records the SPAN
    and leaves the verdict to analysis. That is the absence-as-value discipline: the absence is
    written down while it is observable, never re-inferred later from bytes that no longer say which
    they were.

    KEYED ON RUN LENGTH ONLY, NEVER ON THE VALUE. The O2Ring's 156 beat marker is a singleton by
    construction, so it falls below `min_run` without being special-cased; a rule that named the
    value would silently stop working the day the vendor picks a different one — and would still
    READ as working, because a rule that matches nothing and a clean stream both emit no rows.

    NOT wired to ACC on purpose: its triplets legitimately repeat 6-7x at rest, so a run rule there
    would report physiology as absence.

    The captured bytes are untouched — this class only ever opens its own file.
    """

    HEADER = "Phone timestamp;stream;value;first_index;n_samples;dur_ms;closed;rule"

    def __init__(self, path: str, stream: str, min_run: int, resumed: bool = False,
                 annotations: frozenset = frozenset()):
        # `<base>.txt` -> `<base>RUNS.txt`, so `…_PPG.txt` gets `…_PPGRUNS.txt` and `…_PPG2W.txt`
        # gets `…_PPG2WRUNS.txt` — derived by rule rather than by a per-stream table that could
        # drift away from the stream names it claims to cover.
        base, dot, ext = path.rpartition(".")
        self.path = f"{base}RUNS.{ext}" if dot else path + "RUNS"
        self.stream = stream
        self.min_run = min_run
        self.annotations = annotations
        self.runs = 0
        self.errors = 0                      # swallowed exceptions — isolation must not be silence
        self._open: dict[str, list] = {}     # channel -> [value, first_index, n, first_phone, last_phone]
        self._idx: dict[str, int] = {}       # per-channel sample index, independent of row count
        self._held: dict[str, list] = {}     # a closed run awaiting a possible merge across a gap
        self._gap: dict[str, list] = {}      # the candidate interruption RUN itself, if one is pending
        self._merges: dict[str, int] = {}    # spans joined across an interruption, per channel
        # Hold classification, PER CHANNEL. Pooling channels was measured wrong on the very first
        # Verity test: one noisy channel's singleton runs dominated the histogram and classified the
        # whole stream `held`, suppressing two genuinely stuck channels. A hold is a property of a
        # signal path, not of a file.
        self.klass: dict[str, str] = {}      # channel -> "held" | "variable" | "undecided"
        self._hist: dict[str, dict[int, int]] = {}   # channel -> {run length: count}, whole stream
        self._warm: dict[str, int] = {}      # channel -> runs seen in its warm-up window
        self._buf: dict[str, list[str]] = {}  # channel -> warm-up rows, held until its verdict
        self._fh: TextIO | None = None
        try:
            self._fh = open(self.path, "a" if resumed else "w", buffering=1 << 16, newline="\n")
            if not resumed:
                # The comment carries the RULE, so a reader never has to infer it from the rows —
                # and an EMPTY sidecar still states what was looked for. A `#` line fails every
                # consumer's row filter, the same shape `# timebase=` uses.
                self._fh.write(f"# stream={stream} rule=stuck min_run={min_run} "
                               f"t_stuck={T_STUCK} merge_gap_max={_ANNOTATION_GAP_MAX} "
                               f"annotations={','.join(str(a) for a in sorted(annotations)) or 'none'} "
                               f"held_warmup={HELD_WARMUP_RUNS} "
                               f"held_top2_share={HELD_TOP2_SHARE} unit=unknown\n")
                self._fh.write(self.HEADER + "\n")
        except OSError:
            self._fh = None                  # a sidecar that cannot open must never stop the capture
            self.errors += 1

    def feed(self, channel: str, value: int, phone: _dt.datetime) -> None:
        """One sample. O(1): extend the open run, or close it and start the next."""
        if self._fh is None:
            return
        try:
            i = self._idx.get(channel, 0)
            self._idx[channel] = i + 1
            cur = self._open.get(channel)
            if cur is not None and cur[0] == value:
                cur[2] += 1
                cur[4] = phone
                return
            if cur is not None:
                self._close_run(channel, cur)
            self._open[channel] = [value, i, 1, phone, phone, False]
        except Exception:
            # DIAGNOSTIC PATH, ISOLATED FROM P0. The sample stream is the recording; this file is a
            # note about it. An exception here is counted and dropped, never propagated into the
            # writer — but it IS counted, because a silent isolation reads exactly like a clean run.
            self.errors += 1

    def _close_run(self, channel: str, run: list) -> None:
        """A run just ended. Decide whether it EXTENDS a held span across a short interruption.

        22 % of raw zero runs in the corpus (2,533 of 11,325) are ONE event split by a single
        annotation sample the device injects mid-span — measured max interruption 6 samples, bounded
        here at `_ANNOTATION_GAP_MAX` = 8. Emitting the fragments instead of the span is not a cosmetic
        difference at this threshold: two 150-sample halves of a 301-sample stuck span are BOTH below
        T_STUCK, so the span disappears entirely.

        The merge is VALUE-AGNOSTIC, exactly like the rule it feeds: it joins two runs of the SAME
        value separated by a SHORT run of any other value. It never asks what the interrupting value
        is, so it does not need updating when the device changes its marker — and it cannot be fooled
        into merging across a genuine change of level, because the values either side must match.
        Two same-valued runs of 150 separated by one differing sample are already three times the
        p99.99 of legitimate plateaus; this cannot manufacture a span out of real signal."""
        held = self._held.get(channel)
        if held is not None and self._gap.get(channel) is not None and held[0] == run[0]:
            # The held value RESUMED across a short interruption -> ONE span. `n` counts the whole
            # span INCLUDING the interrupting samples, because the span is what was not measured,
            # not a tally of samples at one value.
            gap = self._gap.pop(channel)
            held[2] += gap[2] + run[2]
            held[4] = run[4]
            held[5] = run[5]                          # the span inherits the last component's fate
            self._merges[channel] = self._merges.get(channel, 0) + 1
            return
        if (held is not None and channel not in self._gap
                and run[0] in self.annotations and run[2] <= _ANNOTATION_GAP_MAX):
            # A short run of a DECLARED ANNOTATION value: hold it as a candidate interruption, pending
            # the next run. Anything else — including a short run of ordinary signal — is a real
            # measurement and is never merged over.
            self._gap[channel] = run
            return
        if held is not None:
            self._emit(channel, held, closed=1)
            stale = self._gap.pop(channel, None)
            if stale is not None:
                # The held value did NOT resume, so that short run was ordinary signal, not a gap.
                # It is emitted as its own run — EVERY run must reach `_emit` exactly once, or the
                # run-length histogram and the warm-up counter both under-count. Measured: holding
                # it back instead left a zero-order-hold stream permanently `undecided`, because on
                # such a stream every run is short and half of them never arrived.
                self._emit(channel, stale, closed=1)
        self._held[channel] = run

    def _emit(self, channel: str, run: list, closed: int) -> None:
        value, first_index, n, first_phone, last_phone, _eof = run
        h = self._hist.setdefault(channel, {})
        h[n] = h.get(n, 0) + 1                       # EVERY run, threshold or not — the shape needs all
        if channel not in self.klass:
            self._warm[channel] = self._warm.get(channel, 0) + 1
            if self._warm[channel] >= HELD_WARMUP_RUNS:
                self._decide(channel)
        if n < self.min_run:
            return
        # dur_ms rides the HOST stamps the rows already carry (Clock Contract §7): the span is
        # measured on the recording's own axis, not against a wall clock read at write time.
        dur_ms = (last_phone - first_phone).total_seconds() * 1000.0
        self.emit_run(channel, value, first_index, n, dur_ms, closed, "stuck", first_phone)

    def emit_run(self, stream: str, value, first_index: int, n: int, dur_ms: float,
                 closed: int, rule: str, stamp: _dt.datetime | None = None) -> None:
        """THE seam. Any detector that finds a span writes it through here — `constant-run` from this
        accumulator, `rail-run`/`held` from a back-check — so every span in the corpus lands in one
        file shape with the rule that found it named in its own column. A second writer would be a
        second shape to reconcile later."""
        if self._fh is None:
            return
        line = (f"{_phone_ts(stamp) if stamp is not None else ''};{stream};{value};{first_index};{n};"
                f"{dur_ms:.1f};{closed};{rule}\n")
        k = self.klass.get(stream)
        if n >= T_STUCK:
            # A `held` channel can still get STUCK, and the hold class must never hide that. The ring's
            # ACC repeats each sample 6-7 times BY DESIGN; 200 identical samples is 20 s of one triplet,
            # which is the failure, not the cadence. Measured over 3.16 M real samples: every
            # non-sentinel run >= 200 was the failure mode, and every one was the LAST run in its file —
            # so this is the single row least safe to suppress, and it is emitted unconditionally.
            self._fh.write(line)
        elif k is None:                               # verdict pending — hold it, do not guess
            self._buf.setdefault(stream, []).append(line)
        elif k != "held":
            self._fh.write(line)
        self.runs += 1

    def _decide(self, channel: str) -> None:
        """Close ONE channel's warm-up window: a near-delta on two ADJACENT run lengths is a hold."""
        fh = self._fh
        assert fh is not None    # only reachable from feed(), which returns early on a closed handle
        hist = self._hist.get(channel, {})
        tot = sum(hist.values()) or 1
        best, share = 0, 0.0
        for ln in hist:
            sh = (hist.get(ln, 0) + hist.get(ln + 1, 0)) / tot
            if sh > share:
                best, share = ln, sh
        self.klass[channel] = "held" if share >= HELD_TOP2_SHARE else "variable"
        mean = sum(k * v for k, v in hist.items()) / tot
        fh.write(f"# stream={self.stream} channel={channel} class={self.klass[channel]} "
                 f"ratio={mean:.1f} top2={best},{best + 1} share={share:.3f} "
                 f"decided_at={self._warm.get(channel, 0)}runs\n")
        if self.klass[channel] == "held":
            # Its runs ARE the sampling cadence, not absence. Drop what the window buffered rather
            # than publishing spans that describe the device's clock.
            self._buf.pop(channel, None)
        else:
            for line in self._buf.pop(channel, []):
                fh.write(line)

    def close(self) -> None:
        """Flush every still-open run with `closed=0` — a run cut short by the recording ending is a
        real span whose END is unknown, and dropping it would lose exactly the spans that ran to the
        end of a night."""
        if self._fh is None:
            return
        try:
            # An open run may still merge into a held span, so resolve the pipeline in order:
            # close the open run (which may extend a held span), then flush whatever is held.
            for channel, run in list(self._open.items()):
                run[5] = True                         # this run was still accumulating at EOF
                self._close_run(channel, run)
            self._open.clear()
            for channel, stale in list(self._gap.items()):
                self._emit(channel, stale, closed=0 if stale[5] else 1)
            self._gap.clear()
            for channel, held in list(self._held.items()):
                # `closed` reports whether the SPAN reached EOF, not whether it happened to be in the
                # merge pipeline at teardown. A span followed by a different value genuinely ended
                # (closed=1) even though it was held back awaiting a possible merge; only a span
                # whose last component was still accumulating ran to EOF (closed=0). Measured as the
                # normal shape of this failure — both real hits are the last run in their file.
                self._emit(channel, held, closed=0 if held[5] else 1)
            self._held.clear()
            self._gap.clear()
            for channel in list(self._buf) + [c for c in self._hist if c not in self.klass]:
                if channel in self.klass:
                    continue
                # This channel's warm-up never closed — fewer than HELD_WARMUP_RUNS runs in the whole
                # recording. RELEASE its buffer and mark it undecided. Suppressing would be the worst
                # possible default: a quiet night with a single long stuck run is exactly the case
                # that produces too few runs to classify, and it is the case the sidecar exists for.
                # On weak evidence, emit and say so; never withhold.
                self.klass[channel] = "undecided"
                self._fh.write(f"# stream={self.stream} channel={channel} class=undecided "
                               f"decided_at={self._warm.get(channel, 0)}runs reason=too-few-runs\n")
                for line in self._buf.pop(channel, []):
                    self._fh.write(line)
            # The whole-stream distribution per channel, so a warm-up verdict that no longer
            # describes the night is VISIBLE rather than silently stale.
            for channel, hist in self._hist.items():
                tot = sum(hist.values()) or 1
                mean = sum(k * v for k, v in hist.items()) / tot
                self._fh.write(f"# final channel={channel} total_runs={tot} mean_run={mean:.2f} "
                               f"merges={self._merges.get(channel, 0)} "
                               f"examined={self._idx.get(channel, 0)} "
                               f"class={self.klass.get(channel, 'undecided')}\n")
            # WHAT WAS EXAMINED, ALWAYS — the mechanism, not a comment.
            #
            # `runs=0` alone cannot distinguish "read 66,535 samples and found no qualifying span" from
            # "was never fed a sample". Those are the same bytes and opposite facts, and the second one
            # SHIPPED: `RUN_MIN_BY_STREAM` carried `acc`/`accraw`, so every ACC stream got a sidecar
            # reading `rule=stuck … runs=0` while `write_acc` never called `feed`. Writing the empty
            # file is the whole point — it means "looked" — and the version that could not tell the two
            # apart went out anyway. `examined` makes them different BYTES; a comment asserting the
            # distinction is not a mechanism for detecting its absence.
            self._fh.write(f"# runs={self.runs} errors={self.errors} "
                           f"examined={sum(self._idx.values())} channels={len(self._idx)}\n")
        except Exception:
            self.errors += 1
        finally:
            try:
                self._fh.close()
            except Exception:
                self.errors += 1
            self._fh = None


class StreamWriter:
    """One open file in a fixed vendor layout. Append rows as samples arrive; flush periodically."""

    # PSL-compatible headers, keyed by stream. `;`-separated, exactly as Polar Sensor Logger exports.
    HEADERS = {
        "ecg":  "Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]",
        "acc":  "Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]",
        # THE O2RING'S 3-AXIS ACC (cmd 0x14), its own stream key for the reason `ppg1`/`ppg2w` have
        # theirs: the column set IS the contract a reader resolves units from, and these are RAW COUNTS.
        # Polar publishes a scale so `acc` can honestly say mg; the ring's vendor publishes none, and
        # nothing here has been calibrated against a known g. Writing these rows under the `acc` header
        # would put a FABRICATED UNIT into the file — a reader would multiply counts as if they were
        # milli-g and get an answer wrong by whatever the true scale is. `raw` is the honest column, and
        # it can be renamed to mg the day a six-orientation calibration measures the factor.
        # `sensor timestamp [ns]` is written as 0 DELIBERATELY: the ring exposes no device clock on this
        # opcode, exactly as on 0x05. A zero column reads as "no device timebase"; a plausible number
        # would read as a measurement that never happened.
        "accraw": "Phone timestamp;sensor timestamp [ns];X [raw];Y [raw];Z [raw]",
        "ppg":  "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient",
        # SINGLE-optical-column PPG — the O2Ring finger site (PPGDEX-O2RING-FINGER-SITE §3). Its own
        # stream key rather than a variant of "ppg", so the header and the row shape cannot drift
        # apart: PpgDex resolves the layout by COUNTING the named optical columns, and a 3-column
        # header over 1-column rows would resolve to the wrist path and read the ns column as light.
        "ppg1": "Phone timestamp;sensor timestamp [ns];channel 0",
        # RAW DUAL-WAVELENGTH from the O2Ring's cmd=0x05 buffer. Its own stream key, for the same reason
        # `ppg1` is: the column set IS the contract a reader resolves the layout from, and a two-channel
        # optical stream must not be mistakable for the Verity's 3-LED `ppg` or the ring's 1-column
        # `ppg1`. Named `ir`/`red` rather than `channel 0/1` deliberately — these are two WAVELENGTHS,
        # not two LEDs of one wavelength, and the ratio between them is the whole reason to record them.
        "ppg2w": "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion",
        # THE RING'S SINGLE-CHANNEL LOSSLESS PLETH (cmd 0x03). `beat` is a FLAG column, not a sample:
        # 156 is an inserted beat marker on this device, but measured 2026-09-06 it is NOT the
        # rate-inflating insertion it is on 0x05 (0.534/s against 62 bpm, and subtracting it moves the
        # rate away from the 125.000 ADC). So the row is written as it arrived and the flag says what
        # it is — a consumer that wants beats reads the column, one that wants the waveform ignores it,
        # and neither has to guess which 156s were real samples. `sensor timestamp [ns]` is 0 for the
        # same reason as accraw/ppg2w: this opcode exposes no device clock, and a plausible number
        # would read as a measurement that never happened.
        "pletha": "Phone timestamp;sensor timestamp [ns];sample;beat",
        # PSL splits HR and RR into TWO files (verified against the real corpus). _HR.txt is HR-only —
        # the HRV/Breathing columns exist in the header but PSL leaves them empty — and the per-beat RR
        # intervals go to a sibling _RR.txt. Matching this lets ONE parser read Vigil and genuine Polar
        # Sensor Logger captures: PulseDex.parseRRInput and ECGDex's `_RR` routing both expect a _RR.txt.
        "hr":   "Phone timestamp;HR [bpm];HRV [ms];Breathing interval [rpm];",
        "rr":   "Phone timestamp;RR-interval [ms]",
        "gyro": "Phone timestamp;sensor timestamp [ns];X [dps];Y [dps];Z [dps]",
        "mag":  "Phone timestamp;sensor timestamp [ns];X [G];Y [G];Z [G]",
        # PPI was the ONE stream of the eight whose header did not match a real PSL export, verified
        # against all 107 `_PPI.txt` files in the Polar Sensor Logger corpus (one distinct header, no
        # variants). It carried an extra `sensor timestamp [ns]` column and put HR THIRD where PSL puts
        # it LAST, so a consumer reading PSL's layout took column 1 — our device clock — as the interval.
        # Every such value is rejected by an interval sanity band, so a live stream read as ZERO usable
        # beats: 21 871 real rows on the box on 2026-08-04 would have counted as none. That is the exact
        # shape of "the Verity's PPI is dead", which is the conclusion this layout would have manufactured.
        "ppi":  "Phone Data RX timestamp;PP-interval [ms];error estimate [ms];blocker;contact;contact;hr [bpm]",
    }

    def __init__(self, path: str, stream: str, flush_interval: float = FLUSH_INTERVAL_S,
                 fsync: bool = True, timebase: str | None = None):
        self.path = path
        self._health = _FlushHealth(path)
        self.stream = stream
        # CAPTURE-FILESET-RESUME §2/§3: when the path already exists with a valid tail, APPEND instead
        # of truncating — a reconnect inside the resume window reuses the set. `resuming` is decided
        # here, once, so every branch below (headers, timebase comment, the HR sibling) keys off the
        # same fact. A torn tail (no trailing newline — the write the crash interrupted) is truncated
        # back to the last complete line BEFORE opening in append mode: appending after a torn row
        # would fuse two rows into an unparseable one (§3.5).
        self.resumed = False
        if os.path.exists(path) and os.path.getsize(path) > 0:
            with open(path, "rb+") as _t:
                _t.seek(-1, 2)
                if _t.read(1) != b"\n":
                    _t.seek(0)
                    _data = _t.read()
                    _cut = _data.rfind(b"\n")
                    _t.truncate(_cut + 1 if _cut >= 0 else 0)
            self.resumed = os.path.getsize(path) > 0
        self._fh = open(path, "a" if self.resumed else "w", buffering=1 << 20, newline="\n")
        # O2RING-ADAPTIVE-TIMEBASE Stage 3b: stamp the per-capture RATE decision into the O2Ring optical
        # files as a `# timebase=…` comment BEFORE the header — the same header-comment shape
        # LinkLogWriter uses for `# adapter=`. It travels WITH the data, so a reader gets it (PpgDex's
        # parsePPG pre-scan) without a sidecar; a `#` line fails every consumer's row filter, so it is
        # inert to parsing. Absent ⇒ a reader defaults to device-crystal.
        #
        # The gate is BY DEVICE, not by stream name. The decision is about the O2RING's crystal-vs-host
        # rate: meaningless for a Verity `ppg` or an ECG stream, and meaningful for EVERY O2Ring optical
        # stream. `ppg2w` (the raw dual-wavelength cmd-0x05 stream) is the same ring on the same host
        # clock and was omitted — measured on the box 2026-08-15, 20 of 216 `_PPG.txt` carried the stamp
        # (all post-deploy) against 0 of 40 `_PPG2W.txt`, including a `_PPG2W.txt` from the SAME capture
        # session as a stamped `_PPG.txt`. Latent rather than live, since nothing parses `ppg2w` yet —
        # which is why it was worth fixing now rather than later: the recordings accumulate, and a
        # timebase that was never written cannot be recovered afterwards.
        if not self.resumed:
            if stream in ("ppg1", "ppg2w") and timebase:
                self._fh.write(f"# timebase={timebase}\n")
            self._fh.write(self.HEADERS[stream] + "\n")
        # The HR writer owns a sibling _RR.txt (PSL layout — see the "hr"/"rr" header note). rsplit replaces
        # only the LAST "_HR." so a device name never triggers it. `rr` never opens its own StreamWriter —
        # it exists solely as this sibling of `hr`.
        self._rr_fh = None
        self._rr_path: str | None = None
        if stream == "hr":
            rr_path = "_RR.".join(path.rsplit("_HR.", 1))
            if rr_path == path:                       # path lacks the "_HR." token — never collide with it
                base, dot, ext = path.rpartition(".")
                rr_path = f"{base}_RR.{ext}" if dot else path + "_RR"
            _rr_resume = self.resumed and os.path.exists(rr_path) and os.path.getsize(rr_path) > 0
            self._rr_fh = open(rr_path, "a" if _rr_resume else "w", buffering=1 << 20, newline="\n")
            if not _rr_resume:
                self._rr_fh.write(self.HEADERS["rr"] + "\n")
            self._rr_path = rr_path                   # remembered so `paths`/`discard` can see it
        self._n = 0
        self._first_ns: int | None = None   # per-file anchor for the relative `timestamp [ms]` column
        # §3.2 (no re-anchor): on a resumed ECG file the relative `timestamp [ms]` column must keep the
        # ORIGINAL anchor — left to its lazy init it would restart at 0.0 mid-file, and ECGDex's headless
        # parser infers fs from this column's STEP, so one reset fabricates a step the size of the whole
        # recording. Recover the anchor from the file's own first data row (col 1, sensor ns).
        if self.resumed and stream == "ecg":
            try:
                with open(path, "r", newline="\n") as _r:
                    for _ln in _r:
                        if _ln.startswith("#") or _ln.startswith("Phone"):
                            continue
                        _c = _ln.rstrip("\n").split(";")
                        if len(_c) > 1 and _c[1].strip().lstrip("-").isdigit():
                            self._first_ns = int(_c[1])
                            break
            except OSError:
                pass                       # unreadable ⇒ lazy init; worse column, never a crash
        # The constant-run sidecar, for optical streams only. Built LAST among the file handles so a
        # failure here cannot leave the sample file half-open; `_RunSidecar` swallows its own OSError
        # for the same reason — the recording must not fail because a note about it could not.
        # The sidecar's channel labels ARE this stream's header columns, so a run row can never name
        # a column the data file does not have.
        self._axis_labels = tuple(self.HEADERS[stream].split(";")[2:5]) if stream in self.HEADERS else ()
        self._runs: _RunSidecar | None = None
        if stream in RUN_MIN_BY_STREAM:
            self._runs = _RunSidecar(path, stream, RUN_MIN_BY_STREAM[stream], resumed=self.resumed,
                                     annotations=ANNOTATIONS_BY_STREAM.get(stream, frozenset()))
        self._flush_interval = flush_interval
        self._fsync = fsync
        self._last_flush = _time.monotonic()
        self._counted = True                # last: only a writer that fully opened is an open writer
        _writer_opened()

    # `timestamp [ms]` in a real PSL export is RELATIVE to the recording's first sample and FRACTIONAL:
    #   0.0, 7.692288, 15.384576, …  (= (sensor_ns - first_sensor_ns)/1e6, verified against a real H10
    #   export). ECGDex's headless parseECGText infers fs from this column's STEP, so it must NOT be
    #   rounded to integer ms (7.692→7/8 makes the parser read 143/125 Hz instead of 130) and must NOT be
    #   the absolute device-clock ms. Emit fractional, relative, trailing-zeros stripped → "0.0" first row.
    def _rel_ms(self, sensor_ns: int) -> str:
        if self._first_ns is None:
            self._first_ns = sensor_ns
        v = (sensor_ns - self._first_ns) / 1e6
        s = f"{v:.6f}".rstrip("0").rstrip(".")
        return s + ".0" if "." not in s else s   # "0" -> "0.0", "30.769280" -> "30.76928"

    # --- per-stream row appenders -------------------------------------------------------------
    # `phone` = host arrival datetime (local); `sensor_ns` = Polar device-clock ns of the sample
    # (monotonic, arbitrary epoch — carried verbatim as the secondary column, NOT ns-since-2000).
    # `t_ms` is accepted for call-site compatibility but the emitted ms column is derived from
    # `sensor_ns` via `_rel_ms` so it exactly matches PSL's relative/fractional semantics.

    def write_ecg(self, phone: _dt.datetime, sensor_ns: int, t_ms: float, uv: int) -> None:
        self._row(f"{_phone_ts(phone)};{sensor_ns};{self._rel_ms(sensor_ns)};{uv}\n")

    def write_acc(self, phone: _dt.datetime, sensor_ns: int | None, t_ms: float,
                  x: int, y: int, z: int) -> None:
        self._row(f"{_phone_ts(phone)};{_ns_col(sensor_ns)};{x};{y};{z}\n")
        # ACC feeds the run sidecar like the optical streams do. It was CREATING a sidecar and never
        # feeding it — `RUN_MIN_BY_STREAM` carries `acc`/`accraw`, so the file existed, said
        # "rule=stuck … runs=0" and had looked at nothing. An honest-empty file and a file that never
        # ran are the same bytes; the whole point of writing the empty one is that it means "looked".
        # The ring's ACC is also the case the hold classifier exists for, and it can only classify a
        # stream it is fed.
        if self._runs is not None:
            for _lbl, _v in zip(self._axis_labels, (x, y, z)):
                self._runs.feed(_lbl, _v, phone)

    def write_pletha(self, phone: _dt.datetime, sensor_ns: int | None, sample: int, beat: int) -> None:
        """One raw single-channel optical sample (O2Ring cmd=0x03), with the beat-marker flag.

        Its own method rather than a branch in `write_ppg2w` for the reason that one is separate from
        `write_ppg`: the column set IS the contract a reader resolves the layout from, and a
        two-column-plus-flag row is neither of the others."""
        self._row(f"{_phone_ts(phone)};{_ns_col(sensor_ns)};{sample};{beat}\n")

    def write_ppg2w(self, phone: _dt.datetime, sensor_ns: int | None, ch0: int, ch1: int,
                    motion: int) -> None:
        """One raw dual-wavelength sample (O2Ring cmd=0x05).

        A SEPARATE method rather than a branch inside `write_ppg`, because that function selects its
        layout by COUNTING optical columns — one means the ring's single reflectance path, three means
        the Verity. A two-wavelength row is neither, and squeezing it through the count would make the
        header and the row shape drift apart, which is the exact failure `ppg1` exists to prevent."""
        self._row(f"{_phone_ts(phone)};{_ns_col(sensor_ns)};{ch0};{ch1};{motion}\n")
        if self._runs is not None:          # both optical channels; `motion` is not an optical wave
            self._runs.feed("channel 0", ch0, phone)
            self._runs.feed("channel 1", ch1, phone)

    def write_ppg(self, phone: _dt.datetime, sensor_ns: int, t_ms: float, ch: Iterable[int], ambient: int) -> None:
        # ONE optical column stays ONE column (PPGDEX-O2RING-FINGER-SITE §3/§7). The O2Ring streams a
        # single reflectance path; this used to be fanned across ppg0/1/2 so it could ride the 3-LED
        # Polar layout, which made PpgDex's consensus vote report a structurally-guaranteed
        # ledAgreementPct 100 at `measured` tier — a fabricated quality claim (ENGINE-VERIFICATION §1.3).
        # PpgDex now parses a genuine 1-column file and tags it site:'finger', so the honest shape is
        # writable. No ambient column either: the ring AC-couples on-device, so a committed 0 would be
        # a fabricated reading rather than a measurement.
        # (The runtime degenerate-channel guard in ppgdex-dsp.js stays as defence-in-depth for any
        # already-captured replicated file, and for a future device that replicates.)
        cols = list(ch)
        if len(cols) == 1:
            self._row(f"{_phone_ts(phone)};{sensor_ns};{cols[0]}\n")
        else:
            c0, c1, c2 = cols[:3]
            self._row(f"{_phone_ts(phone)};{sensor_ns};{c0};{c1};{c2};{ambient}\n")
        # Run tracking follows the SAME column count the row above wrote, so the sidecar can never
        # describe a layout the file does not have. `ambient` is excluded: it is not an optical wave,
        # and a held ambient reading is not the absence this rule is looking for.
        if self._runs is not None:
            for _i, _v in enumerate(cols[:1] if len(cols) == 1 else cols[:3]):
                self._runs.feed(f"channel {_i}", _v, phone)

    # GYRO/MAG arrive SCALED to physical units (dps / gauss) — polar_pmd.axis_scale turns the device's
    # raw int16 into a float, so these two cannot use the integer formatting ACC keeps. `:.6g` holds the
    # full significance of a 16-bit sample (gyro 0.061 dps/LSB, mag 0.0015 G/LSB) without printing the
    # binary-fraction tail of the multiply.
    def write_gyro(self, phone: _dt.datetime, sensor_ns: int, t_ms: float, x: float, y: float, z: float) -> None:
        self._row(f"{_phone_ts(phone)};{sensor_ns};{x:.6g};{y:.6g};{z:.6g}\n")

    def write_mag(self, phone: _dt.datetime, sensor_ns: int, t_ms: float, x: float, y: float, z: float) -> None:
        self._row(f"{_phone_ts(phone)};{sensor_ns};{x:.6g};{y:.6g};{z:.6g}\n")

    def write_ppi(self, phone: _dt.datetime, sensor_ns: int, hr: int, pp_ms: int, err_ms: int, flags: int) -> None:
        # One row per beat, in PSL's PPI column ORDER: interval FIRST, hr LAST, and NO device-clock column.
        # `sensor_ns` is accepted for call-site compatibility and deliberately not emitted — PPI frames
        # carry no usable device clock (every row the box has written has sensor_ns == 0), which is what
        # nightqc.file_span_sec already assumes when it says "HR/RR/PPI carry no device clock".
        self._row(f"{_phone_ts(phone)};{pp_ms};{err_ms};"
                       f"{flags & 1};{(flags >> 1) & 1};{(flags >> 2) & 1};{hr}\n")

    def write_hr(self, phone: _dt.datetime, sensor_ns: int, bpm: int, rr_ms: Iterable[int]) -> None:
        # PSL layout: ONE HR row per notification in _HR.txt (HR only; HRV/Breathing left empty), and one
        # row per RR interval in the sibling _RR.txt (real intervals only — no blank rows). `sensor_ns` is
        # accepted for call-site compatibility but PSL's _HR/_RR carry only the phone timestamp.
        #
        # ⚠️ A 0 bpm IS THE SIG "no valid measurement" SENTINEL, NOT A RATE. The Heart Rate Measurement
        # characteristic (0x2A37) reports 0 when the sensor has no lock; writing it into a column headed
        # `HR [bpm]` publishes a heart rate of zero, which is physiologically impossible. Measured
        # 2026-09-04 on one night: 49/26086 rows on the H10 and 420/36533 on the Verity.
        #
        # THE FORMAT THIS FILE CLAIMS PARITY WITH NEVER DOES IT: 0 zero-bpm rows across 83 647 rows of
        # four genuine Polar Sensor Logger H10 exports (`uploads/Polar_H10_*_HR.txt`). So this was our
        # divergence from PSL, not a vendor convention being mirrored.
        #
        # SKIP THE ROW rather than blanking the column. `Number('')` is 0 in JavaScript, so an empty
        # field hands the sentinel straight back to any future reader that does not range-check — a
        # trap that looks like a fix. A row that does not exist cannot be misread by anyone. Both
        # current consumers happen to guard (`ecgdex-dsp` rejects hr < 20, `sigma-no-reference-analysis`
        # requires hr >= HR_MIN), which is precisely why this stayed invisible: the file was wrong and
        # every reader defended itself.
        if bpm:
            self._row(f"{_phone_ts(phone)};{bpm}\n")
        # RR IS INDEPENDENT OF THE HR SENTINEL and must survive it — one notification can carry valid
        # intervals while the rate byte reads 0, and those intervals are the HRV substrate.
        if self._rr_fh is not None:
            ts = _phone_ts(phone)
            for rr in rr_ms:
                self._health.put(self._rr_fh, f"{ts};{rr}\n")
        # UNCONDITIONAL, because `_bump` is now conditional. Flush cadence used to ride the HR bump, so
        # a stretch of no-lock notifications would otherwise park written RR rows behind a bump that
        # never comes. `rows` stays an honest count of rows actually written; flushing is time-based
        # and cheap to ask about.
        self._maybe_flush()

    def _row(self, text: str) -> None:
        """One sample row: counted in `rows` ONLY if it was actually written (a lost row is counted in
        `rows_lost` by the health object instead), flush cadence checked either way."""
        if self._health.put(self._fh, text):
            self._n += 1
        self._maybe_flush()

    def _maybe_flush(self) -> None:
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        """Force the buffered tail to the OS (flush) and to disk (fsync) — bounds crash/power-loss loss."""
        try:
            self._fh.flush()
            if self._fsync:
                self._health.fsync(self._fh)
            if self._rr_fh is not None:
                self._rr_fh.flush()
                if self._fsync:
                    self._health.fsync(self._rr_fh)
        except Exception as _e:
            self._health.failed(_e)
        else:
            self._health.ok()

    @property
    def rows(self) -> int:
        return self._n

    @property
    def paths(self) -> list[str]:
        """EVERY file this writer owns. `self.path` names only the primary, and the `hr` stream silently
        owns a second handle (`_RR.<ext>`) — so the header-only pruner's `path = wr.path; wr.close();
        os.remove(path)` deleted the HR file and left its RR sibling behind as an orphan
        (CAPTURE-HOST-DEEP-AUDIT §C8). Measured: 4 orphan 33-byte RR files with no HR sibling on
        2026-07-25 alone."""
        # The constant-run sidecar is a THIRD owned file and belongs here for the same reason the RR
        # sibling does: a header-only session that prunes `path` alone would leave a `…RUNS.txt`
        # orphan describing a recording that no longer exists — §C8's failure with a new filename.
        return ([self.path]
                + ([self._rr_path] if self._rr_path else [])
                + ([self._runs.path] if self._runs is not None else []))

    def discard(self) -> None:
        """Close and unlink everything this writer owns. The teardown path for a session that produced
        nothing but headers — use this rather than removing `path`, which cannot see the sibling."""
        self.close()
        for p in self.paths:
            try:
                os.remove(p)
            except OSError:
                pass          # a header-only file we could not unlink stays on disk carrying 0 rows:
                              # inert, and failing the teardown over it would be worse

    def close(self) -> None:
        try:
            self.flush()
            self._fh.close()
            if self._rr_fh is not None:
                self._rr_fh.close()
        except Exception as _e:
            self._health.failed(_e)
        try:
            if self._runs is not None:      # OUTSIDE the block above: a failed sample-file close must
                self._runs.close()          # still flush the open runs, and vice versa
        except Exception as _e:
            # Not swallowed: `_RunSidecar.close` handles its own IO errors, so reaching here means an
            # unexpected failure in the sidecar itself. The recording is already safe at this point —
            # say so in the log rather than resuming as if nothing happened.
            _log.warning("run sidecar close failed for %s: %r", self.path, _e)
        finally:
            # In the finally: a writer whose flush raised is still CLOSED as far as the open-file
            # count is concerned, and leaking a count would pin the clock anchor open forever.
            if self._counted:
                self._counted = False
                _writer_closed()

    @property
    def flush_failures(self) -> int:
        """How many flushes have failed on this file. Surfaced beside `rows` in STATUS: `rows`
        counts what we were HANDED, this counts what may never have reached the disk."""
        return self._health.failures

    @property
    def rows_lost(self) -> int:
        """Rows whose `write` itself raised (ENOSPC/EIO at the buffer, or a notification that arrived
        after `close`). `rows` no longer counts them; this does. `rows + rows_lost` is what was handed."""
        return self._health.rows_lost

    @property
    def fsync_max_ms(self) -> float:
        """The longest single `fsync` this file has cost the event loop (§S2 — measured, not moved)."""
        return self._health.fsync_max_ms


# ── OXYFRAME column order — ONE definition, because two copies is how it went stale ──────────────────
# The JS lane carries a fixture asserting `oxydex-dsp.parseCSV` ingests this layout byte-identically
# (tests/dex-tests.js, the OXYFRAME group). That fixture is a hand-written string, so for as long as
# this header was a hand-written string too, nothing connected them: appending a column here left the
# fixture passing forever against a layout no capture would ever again produce. Its own docstring warns
# about exactly that failure and could not prevent it.
#
# Naming the columns once, and gating the fixture against this tuple from the Python side
# (`test_oxyframe_header_is_the_single_source_the_js_fixture_tracks`), is what makes the append-never-
# insert rule enforceable rather than merely written down. APPEND to the end of this tuple; never
# insert, never reorder — a positional reader of an older layout must keep working.
#
# ⚠️ AND COLUMNS ARE ADDRESSED BY HEADER NAME: the row MAY grow at the tail, so an index counted from
# the END has no contract and never had one. Appending `alarm_raw` (2026-09-06) silently moved three
# writer tests that read `cells[-3]`/`[-2]`/`[-1]` onto different columns — one asserted `flag_raw`
# and got `199` from `ppg_offset`. Read the header line and look the name up, as `oxydex-dsp.js` does.
OXYFRAME_COLUMNS = (
    "Phone timestamp", "duration_s", "pi_pct", "motion", "spo2", "pr", "contact", "battery_pct",
    "batt_state", "flag",          # ── the original 10
    "ppg_n", "ppg_dur_step",       # O2RING-FRAME-SAMPLE-LOCK §7
    "ppg_offset", "flag_raw",      # DEVICE-RATE-TRUTH §6.1
    "alarm_raw",                   # RT_PARAM byte [14], four 2-bit alarm/IV subfields, raw and
                                   # uninterpreted (2026-09-06). Blank when the frame was too short
                                   # to carry it — an absent byte is not a quiet alarm.
    "run_status",                  # OXYII-PRESENCE-MODEL §5: parsed since day one, never persisted —
                                   # so no night could answer whether payload[4] discriminates states.
                                   # Recorded raw; interpretation happens in the brief, not here.
)
OXYFRAME_HEADER = ";".join(OXYFRAME_COLUMNS)


class OxyFrameLogWriter:
    """O2Ring per-frame sidecar — the live-header fields the vendor SpO2 CSV layout cannot carry.

    Originally built to identify byte [11]. That question is now ANSWERED (it is motion; [7] is the
    perfusion index — the two were swapped, see oxyii.parse_live), so this file's job has changed from
    experiment to capture: it records PERFUSION INDEX, which is a real physiological signal the
    `Time,Oxygen Level,Pulse Rate,Motion` vendor layout has no column for, plus session duration and
    the charge/run state.

    PI is genuinely useful — it is the standard oximetry measure of pulse-signal strength, and it is the
    honest denominator for judging whether an SpO2 reading was well-perfused. It is recorded here rather
    than surfaced as a metric: it earns a registry entry and an evidence badge only when a node actually
    consumes it.

    SIDECAR, NOT A COLUMN — the SpO2 CSV is a vendor layout OxyDex's adapter parses positionally.
    """

    def __init__(self, path: str, flush_interval: float = FLUSH_INTERVAL_S, fsync: bool = True):
        self.path = path
        self._health = _FlushHealth(path)
        self._fh = open(path, "w", buffering=1 << 16, newline="\n")
        # ppg_n / ppg_dur_step APPENDED, never inserted — the same "never shift an
        # existing column" discipline LinkLogWriter keeps, so a reader written against the 10-column
        # layout still parses positionally. They carry the per-frame PPG arithmetic
        # (O2RING-FRAME-SAMPLE-LOCK): the sample count the DEVICE declared, and the RAW step in its own
        # session-second counter since the previous row. A third column holding `PPG_FRAME_SAMPLES x
        # step` was retired 2026-08-04 before any capture was written in this format — see
        # O2PpgFrameLedger for why no nominal makes that number informative.
        #
        # `ppg_dur_step` is deliberately the raw step and NOT a derived "frames missing" — a step of 2
        # resembles a lost frame and is actually the ring's counter quantizing (measured: identical host
        # arrival interval, identical sample count). Recording the primitive is what lets a night be
        # re-audited from the file when the interpretation turns out to be wrong, which here it did.
        # ppg_offset / flag_raw APPENDED after those, same discipline again. `ppg_offset` is the ring's
        # own u32 stream position ([20:24], oxyii.ppg_stream_offset) — the only device-side sequence
        # number it exposes, and the one field that can settle whether its PPG_INVALID bytes are inserted
        # extras or replacements WITHOUT a host clock in the comparison (DEVICE-RATE-TRUTH §6.1).
        # `flag_raw` is the whole [10] byte whose bit 0 we already record: that bit is set on 100 % of
        # frames across 8 nights, so it is a setting, not an event — the varying bits are 1-7 and nothing
        # has ever read them.
        self._fh.write(OXYFRAME_HEADER + "\n")
        self.rows = 0
        self._flush_interval = flush_interval
        self._fsync = fsync
        self._last_flush = _time.monotonic()
        self._counted = True
        _writer_opened()

    def write(self, when: _dt.datetime, live: dict, ppg: dict | None = None) -> None:
        """One row per live frame (~1 Hz). Blank, never 0, for an absent value — a fabricated 0 is
        indistinguishable from a real reading of 0 (the bug this suite keeps re-learning).

        `ppg` is the per-frame dict `capture.O2PpgFrameLedger.frame()` returns, or None when the PPG
        stream is switched off — OPTIONAL AND LAST, so an existing caller keeps working and the
        ppg-derived columns (`ppg_n`, `ppg_dur_step`, `ppg_offset`) simply read blank. `flag_raw` comes
        off `live`, so it is present whenever the frame parsed at all.
        That blank is load-bearing here: a night captured with `ppg` disabled
        must not claim `ppg_n = 0`, which would read as "the ring declared no samples". `step` is None
        on the first row of a session and across a session restart, where no step exists to measure —
        again blank, because 0 there would assert a step we never observed."""
        def _f(v):
            return "" if v is None else str(v)
        p = ppg or {}
        stamp = when.strftime("%Y-%m-%dT%H:%M:%S.") + f"{when.microsecond // 1000:03d}"
        landed = self._health.put(self._fh, ";".join((stamp, _f(live.get("duration")), _f(live.get("pi")),
                                 _f(live.get("motion")), _f(live.get("spo2")), _f(live.get("pr")),
                                 _f(live.get("contact")), _f(live.get("batt")),
                                 _f(live.get("batt_state")), _f(live.get("flag")),
                                 _f(p.get("n")), _f(p.get("step")),
                                 _f(p.get("offset")), _f(live.get("flag_raw")),
                                 _f(live.get("alarm_raw")),
                                 _f(live.get("run_status")))) + "\n")
        if landed:
            self.rows += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        try:
            self._fh.flush()
            if self._fsync:
                self._health.fsync(self._fh)
        except (OSError, ValueError) as _e:
            self._health.failed(_e)
        else:
            self._health.ok()

    def close(self) -> None:
        try:
            self.flush()
            self._fh.close()
        except (OSError, ValueError) as _e:
            self._health.failed(_e)
        finally:
            if self._counted:
                self._counted = False
                _writer_closed()

    @property
    def flush_failures(self) -> int:
        """How many flushes have failed on this file. Surfaced beside `rows` in STATUS: `rows`
        counts what we were HANDED, this counts what may never have reached the disk."""
        return self._health.failures

    @property
    def rows_lost(self) -> int:
        """Rows whose `write` itself raised (ENOSPC/EIO at the buffer, or a notification that arrived
        after `close`). `rows` no longer counts them; this does. `rows + rows_lost` is what was handed."""
        return self._health.rows_lost

    @property
    def fsync_max_ms(self) -> float:
        """The longest single `fsync` this file has cost the event loop (§S2 — measured, not moved)."""
        return self._health.fsync_max_ms


class HostClockLogWriter:
    """Per-session HOST CLOCK PROVENANCE sidecar — what disciplined the box's clock during this night.

    The capture host pushes its own time into all three sensors, so a wrong host clock yields a night
    that is SELF-CONSISTENTLY wrong: cross-device work still succeeds (it only needs a common base) but
    the absolute wall time is wrong and nothing looks broken. This file is the evidence that lets a
    future reader tell "stratum-1 PPS all night" from "the box free-ran on its RTC" — a question that is
    unanswerable after the fact today.

    Sibling of LinkLogWriter: link provenance answers "what were the RADIO conditions", this answers
    "what were the TIME conditions". Slow cadence — the state changes on the order of NTP poll
    intervals, not seconds.

    TELEMETRY, not physiology: never a `ganglior.node-export` metric, never an evidence badge.
    """

    def __init__(self, path: str, flush_interval: float = FLUSH_INTERVAL_S, fsync: bool = True):
        self.path = path
        self._health = _FlushHealth(path)
        self._fh = open(path, "w", buffering=1 << 16, newline="\n")
        # chrony_skew_ppm then timebase are APPENDED LAST so a positional reader of the earlier columns is
        # unaffected — the same "never shift an existing column" discipline LinkLogWriter keeps.
        # chrony_skew_ppm = clock-frequency precision (ppm error bound), chrony-only, blank on timesyncd.
        # timebase = the RATE reference this capture is analysed on, 'device-crystal' | 'host-disciplined'
        # (host_clock.timebase_decision); the Stage-3 decision, recorded per capture (O2RING-ADAPTIVE-TIMEBASE).
        self._fh.write("Phone timestamp;trust;absolute_ok;synchronized;server;stratum;reference;"
                       "root_dispersion_ms;jitter_us;packet_count;reason;chrony_skew_ppm;timebase\n")
        self.rows = 0
        self._flush_interval = flush_interval
        self._fsync = fsync
        self._last_flush = _time.monotonic()

    def write(self, when: _dt.datetime, st: dict) -> None:
        """Blank, never 0/false, for an absent field — a fabricated value here would be a fabricated
        claim about how well-sourced the night's timestamps are."""
        def _f(v):
            if v is None:
                return ""
            if isinstance(v, bool):
                return "1" if v else "0"
            return str(v)
        stamp = when.strftime("%Y-%m-%dT%H:%M:%S.") + f"{when.microsecond // 1000:03d}"
        landed = self._health.put(self._fh, ";".join((
            stamp, _f(st.get("trust")), _f(st.get("absolute_ok")), _f(st.get("synchronized")),
            _f(st.get("server")), _f(st.get("stratum")), _f(st.get("reference")),
            _f(st.get("root_dispersion_ms")), _f(st.get("jitter_us")), _f(st.get("packet_count")),
            str(st.get("reason") or "").replace(";", ","), _f(st.get("chrony_skew_ppm")),
            _f(st.get("timebase")))) + "\n")
        if landed:
            self.rows += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        try:
            self._fh.flush()
            if self._fsync:
                self._health.fsync(self._fh)
        except (OSError, ValueError) as _e:
            self._health.failed(_e)
        else:
            self._health.ok()

    def close(self) -> None:
        try:
            self.flush()
            self._fh.close()
        except (OSError, ValueError) as _e:
            self._health.failed(_e)

    @property
    def flush_failures(self) -> int:
        """How many flushes have failed on this file. Surfaced beside `rows` in STATUS: `rows`
        counts what we were HANDED, this counts what may never have reached the disk."""
        return self._health.failures

    @property
    def rows_lost(self) -> int:
        """Rows whose `write` itself raised (ENOSPC/EIO at the buffer, or a notification that arrived
        after `close`). `rows` no longer counts them; this does. `rows + rows_lost` is what was handed."""
        return self._health.rows_lost

    @property
    def fsync_max_ms(self) -> float:
        """The longest single `fsync` this file has cost the event loop (§S2 — measured, not moved)."""
        return self._health.fsync_max_ms


CLOCKSYNC_NAME = "CLOCKSYNC.csv"
_CLOCKSYNC_HEADER = "Phone timestamp;device;address;event;skew_sec;detail\n"


def append_clock_sync_event(root, when: _dt.datetime, device, address, event: str,
                            skew_s: float | None = None, detail: str | None = None) -> bool:
    """Append ONE device clock-sync outcome to the night's own `CLOCKSYNC.csv` sidecar.

    THE PER-NIGHT EVIDENCE CHANNEL (H10-2019-ORIGIN, 2026-09-01). `auto_sync_clock` and
    `clock_watchdog` have always reported their outcomes — into live STATUS (a snapshot the next write
    erases) and journald (which rotates). Nothing wrote them into the night's own files, so "was THIS
    night's device clock actually synced?" was unanswerable after the fact — which is how 84 H10 nights
    recorded on the strap's 2019-01-01 firmware default went unnoticed for two months. A live status
    field is not an evidence channel; any question that will be asked about a night post-hoc must be
    persisted WITH the night.

    Event vocabulary (one word, greppable; the writer does not police it, the emitters do):
        synced          — a clock write reached the device (startup ladder or reconnect)
        deferred-absent — the sync was skipped because the device is not reachable; the reconnect
                          loop re-triggers it, so this defers rather than loses
        gave-up-busy    — the 12-attempt ladder exhausted on transient busy states
        gave-up-budget  — the ladder exceeded its wall-clock lock budget
        sync-failed     — a non-transient failure (the give-up the operator should read first)
        resynced        — the watchdog corrected a jump/adrift clock mid-session (detail = reason)
        resync-failed   — the watchdog's correction attempt failed hard
        uncorrectable   — repeated re-syncs did not move the skew; accepted and left alone

    Same disciplines as the sidecar family above: a SIDECAR, never a column in a vendor layout;
    TELEMETRY, never a `ganglior.node-export` metric. Two deliberate departures from the writer-class
    pattern, each earning its place:
    · OPEN-APPEND-CLOSE per event. Sync outcomes are sparse — a handful per night — so a held-open
      writer buys nothing and costs midnight-roll and teardown machinery in three async contexts.
      A FIXED name (like OXYLIFE.csv, unlike the stamped LINK/CLOCK pair) makes the append idempotent
      across calls; `nightqc.newest_data_mtime` excludes it from data-ranking by construction (it
      matches no capture-name pattern), so the 00:00 decoy-folder trap does not apply.
    · NEVER RAISES. Evidence must never take capture down — the same rule the PMD frame dump keeps.
      Returns False (logged at debug) when the row could not be written; callers do not branch on it.

    Keyed by the EVENT's wall date (`night_dir(root, when)`) — the LINK/CLOCK sidecar convention: a
    cross-midnight session leaves the late rows in the next date's folder, and the QC/fold layer
    already reads neighbouring folders as one session."""
    if not root:
        return False
    try:
        path = os.path.join(night_dir(root, when), CLOCKSYNC_NAME)
        fresh = not os.path.exists(path) or os.path.getsize(path) == 0
        with open(path, "a", encoding="utf-8", newline="\n") as fh:
            if fresh:
                fh.write(_CLOCKSYNC_HEADER)
            fh.write(";".join((
                _phone_ts(when),
                str(device or ""),
                str(address or ""),
                str(event),
                "" if skew_s is None else f"{skew_s:.3f}",
                # blank, never a fabricated value; ; and newlines would corrupt the row shape
                str(detail or "").replace(";", ",").replace("\n", " "),
            )) + "\n")
        return True
    except OSError as e:
        _log.debug("CLOCKSYNC append failed (%s): %r", event, e)
        return False


class RingClockLogWriter:
    """Per-session RING CLOCK sidecar — the O2Ring's RTC watched against the host, on disk.

    The RTC became READABLE 2026-08-19 (GET_INFO [24:31]); the daemon reads it every ~10 min and pushes
    0xC0 six-hourly. STATUS shows the latest reading and forgets the rest — but the ring's crystal is a
    clock this suite characterises (allan.py), a 0xC0 push is a claim until a readback confirms it, and
    an RTC RESET (battery event) silently ruins a stored .dat's timebase. All three need the history,
    not the latest value. One row per event:

        Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3

    `event`: read (periodic readback) · push (0xC0 sent — offset column blank; the NEXT read is its
    verification) · reset-suspect (offset jumped > threshold between reads: a battery event, flagged
    the moment it is seen instead of when a .dat fit fails) · battery (0xE4 poll; battery_raw2 is the
    ANALOG voltage-like byte mapped 2026-08-19 — logged raw because logging IS its characterisation).

    Same disciplines as LinkLogWriter: a SIDECAR, never a column in a vendor layout; TELEMETRY, never a
    ganglior export metric; blanks, never fabricated zeros."""

    def __init__(self, path: str, flush_interval: float = FLUSH_INTERVAL_S, fsync: bool = True):
        self.path = path
        self._health = _FlushHealth(path)
        self._fh = open(path, "w", buffering=1 << 16, newline="\n")
        self._fh.write("Phone timestamp;event;rtc_offset_s;battery_state;battery_level;"
                       "battery_raw2;battery_raw3\n")
        self.rows = 0
        self._flush_interval = flush_interval
        self._fsync = fsync
        self._last_flush = _time.monotonic()

    def write(self, when: _dt.datetime, event: str, rtc_offset_s=None,
              battery_state=None, battery_level=None, battery_raw2=None, battery_raw3=None) -> None:
        def _f(v):
            return "" if v is None else str(v)
        landed = self._health.put(self._fh, f"{_phone_ts(when)};{event};{_f(rtc_offset_s)};{_f(battery_state)};"
                       f"{_f(battery_level)};{_f(battery_raw2)};{_f(battery_raw3)}\n")
        if landed:
            self.rows += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        try:
            self._fh.flush()
            if self._fsync:
                self._health.fsync(self._fh)
        except (OSError, ValueError) as _e:
            self._health.failed(_e)
        else:
            self._health.ok()

    def close(self) -> None:
        try:
            self.flush()
            self._fh.close()
        except (OSError, ValueError) as _e:
            self._health.failed(_e)

    @property
    def flush_failures(self) -> int:
        """How many flushes have failed on this file. Surfaced beside `rows` in STATUS: `rows`
        counts what we were HANDED, this counts what may never have reached the disk."""
        return self._health.failures

    @property
    def rows_lost(self) -> int:
        """Rows whose `write` itself raised (ENOSPC/EIO at the buffer, or a notification that arrived
        after `close`). `rows` no longer counts them; this does. `rows + rows_lost` is what was handed."""
        return self._health.rows_lost

    @property
    def fsync_max_ms(self) -> float:
        """The longest single `fsync` this file has cost the event loop (§S2 — measured, not moved)."""
        return self._health.fsync_max_ms


class LinkLogWriter:
    """Per-session LINK PROVENANCE sidecar — the CONDITIONS a night was captured under.

    Answers a question the signal files cannot: when there is a gap at 03:00, was the link degrading, or
    did the sensor simply stop? Today that is unanswerable after the fact. This records connection state,
    RSSI, battery and frame-drop counters on a slow cadence (~25 s), so link quality becomes recorded
    evidence rather than an assumption — the same move as clock provenance.

    DELIBERATELY A SIDECAR, NOT A COLUMN. The vendor `*_ACC.txt` / `*_PPG.txt` layouts are a POSITIONAL
    contract that MotionDex/PPGDex/ECGDex parse by index; adding a field to them shifted every column and
    silently corrupted consumers once already (2026-07-18). One extra file cannot do that.

    It is TELEMETRY, not physiology: it must never enter a `ganglior.node-export` as a metric or carry an
    evidence badge as a health measurement.
    """

    def __init__(self, path: str, flush_interval: float = FLUSH_INTERVAL_S, fsync: bool = True,
                 adapter: str | None = None, hci: str | None = None):
        # WHICH RADIO CAPTURED THIS NIGHT. Written as a header COMMENT, once, before the column line.
        # Until 2026-07-26 nothing in a night recorded it: three BLE adapters were present on the box
        # and the only way to say which one produced a given night was to remember. That is fine right
        # up until you try to compare two of them, at which point the whole comparison rests on an
        # assertion — and this suite's rule is that a claim about the data must be IN the data.
        #
        # A comment line rather than a column because it is a per-FILE constant, and rather than a
        # separate manifest because the link record is exactly where a link fact belongs. Readers that
        # split on ';' are unaffected: the line starts with '#' and every existing parser skips the
        # header row anyway. `adapter` is the BD_ADDR the operator pinned; `hci` is what it resolved
        # to, and both are kept because indices re-enumerate (a controller power-cycle swapped
        # hci0/hci2 on 2026-07-18) so neither alone identifies the radio after the fact.
        self.path = path
        self._health = _FlushHealth(path)
        self._fh = open(path, "w", buffering=1 << 16, newline="\n")
        if adapter or hci:
            self._fh.write(f"# adapter={adapter or 'default'} hci={hci or 'unknown'}\n")
        self._fh.write("Phone timestamp;device;connected;rssi_dbm;battery_pct;"
                       "frames_dropped;frames_duplicated;link_epoch;address\n")
        self.rows = 0
        self._flush_interval = flush_interval
        self._fsync = fsync
        self._last_flush = _time.monotonic()

    def write(self, when: _dt.datetime, device: str, connected: bool, rssi, battery,
              dropped=None, duplicated=None, link_epoch=None, address=None) -> None:
        def _f(v):
            return "" if v is None else str(v)          # blank, never a fabricated 0
        # link_epoch (E5) and `address` are APPENDED last so a positional reader of the earlier columns is
        # unaffected — the same "never shift an existing column" discipline the class docstring keeps.
        #
        # WHY `address` (2026-07-26). `device` is the human NAME, and a name is not an identity: it can be
        # edited in the monitor, and on 2026-07-25 one re-pair rewrote the Verity's from "Polar Verity
        # Sense" to "Polar Sense 0C301E3F" mid-night. The sidecar then recorded ONE physical sensor under
        # TWO keys (3 samples under the old name, 1123 under the new), so any per-device aggregate over
        # that night silently splits in half. The MAC cannot be edited and cannot collide, so it is the
        # key an analysis should group on; the name stays for human reading.
        landed = self._health.put(self._fh, f"{_phone_ts(when)};{device};{1 if connected else 0};"
                       f"{_f(rssi)};{_f(battery)};{_f(dropped)};{_f(duplicated)};{_f(link_epoch)};"
                       f"{_f(address)}\n")
        if landed:
            self.rows += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    # Guarded like every sibling writer. This was the ONE writer of five whose flush()/close() raised on
    # an already-closed handle — StreamWriter, OxyFrameLogWriter, HostClockLogWriter and Spo2CsvWriter all
    # swallow it. Not reachable today (the poller closes once), but the asymmetry is exactly what bites
    # during a shutdown race, and a raise here would propagate out of the rssi_poller's teardown and mask
    # whatever actually went wrong.
    def flush(self) -> None:
        try:
            self._fh.flush()
            if self._fsync:
                self._health.fsync(self._fh)
        except (OSError, ValueError) as _e:
            self._health.failed(_e)
        else:
            self._health.ok()

    def close(self) -> None:
        try:
            self.flush()
            self._fh.close()
        except (OSError, ValueError) as _e:
            self._health.failed(_e)

    @property
    def flush_failures(self) -> int:
        """How many flushes have failed on this file. Surfaced beside `rows` in STATUS: `rows`
        counts what we were HANDED, this counts what may never have reached the disk."""
        return self._health.failures

    @property
    def rows_lost(self) -> int:
        """Rows whose `write` itself raised (ENOSPC/EIO at the buffer, or a notification that arrived
        after `close`). `rows` no longer counts them; this does. `rows + rows_lost` is what was handed."""
        return self._health.rows_lost

    @property
    def fsync_max_ms(self) -> float:
        """The longest single `fsync` this file has cost the event loop (§S2 — measured, not moved)."""
        return self._health.fsync_max_ms


class OxyLifeLogWriter:
    """Per-night OxyII LIFECYCLE sidecar — `OXYLIFE.csv`, beside `LINK.csv` (charter G4). One row per
    acquisition-lifecycle transition (connect / live / interrupted / paused-for-pull / pulling /
    idle-unworn / error / shutting-down), so a gap or an odd night is explainable after the fact from the
    daemon's own state history rather than guessed at.

    Same disciplines as LinkLogWriter: a SIDECAR, never a column in a vendor layout; TELEMETRY, never a
    metric in a ganglior.node-export or an evidence-badged health number. The row format is the
    transition's own `as_row()` (the module owns the schema); this class owns the file + cadence only.
    """

    def __init__(self, path: str, flush_interval: float = FLUSH_INTERVAL_S, fsync: bool = True,
                 device: str | None = None):
        self.path = path
        self._health = _FlushHealth(path)
        self._fh = open(path, "w", buffering=1 << 16, newline="\n")
        if device is not None:
            self._fh.write(f"# device={device}\n")
        # `axis` appended 2026-08-24 (append-never-insert): blank = the LINK axis (every historical row),
        # "rec" = the RECORDING axis (oxy_lifecycle.OxyRecEngine). No committed reader keys on column
        # count (checked at append time: timeline/webmon/tools carry no OXYLIFE reader); read by header.
        self._fh.write("host_wall;host_monotonic;prev;new;reason;device;session;failure;axis\n")
        self.rows = 0
        self._flush_interval = flush_interval
        self._fsync = fsync
        self._last_flush = _time.monotonic()

    def write(self, transition) -> None:
        """Append one transition (anything with `.as_row()` — an oxy_lifecycle.Transition). Duck-typed so
        writers.py stays decoupled from the lifecycle module."""
        landed = self._health.put(self._fh, transition.as_row() + "\n")
        if landed:
            self.rows += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        try:
            self._fh.flush()
            if self._fsync:
                self._health.fsync(self._fh)
        except (OSError, ValueError) as _e:
            self._health.failed(_e)
        else:
            self._health.ok()

    def close(self) -> None:
        try:
            self.flush()
            self._fh.close()
        except (OSError, ValueError) as _e:
            self._health.failed(_e)

    @property
    def flush_failures(self) -> int:
        """How many flushes have failed on this file. Surfaced beside `rows` in STATUS: `rows`
        counts what we were HANDED, this counts what may never have reached the disk."""
        return self._health.failures

    @property
    def rows_lost(self) -> int:
        """Rows whose `write` itself raised (ENOSPC/EIO at the buffer, or a notification that arrived
        after `close`). `rows` no longer counts them; this does. `rows + rows_lost` is what was handed."""
        return self._health.rows_lost

    @property
    def fsync_max_ms(self) -> float:
        """The longest single `fsync` this file has cost the event loop (§S2 — measured, not moved)."""
        return self._health.fsync_max_ms


class PmdArrivalLogWriter:
    """Per-session PACKET-ARRIVAL sidecar — the one measurement that makes the inter-device offset knowable.

    THE PROBLEM IT EXISTS FOR. Every wearable pair in this corpus is separated by a per-connection BLE
    buffering delay of hundreds of milliseconds — measured Verity-minus-H10 across nights: -867 to
    +1321 ms. PAT needs ~10 ms. The offset is CONSTANT per connection and arbitrary between them, so
    seven of ten nights come out anatomically impossible (the ankle, the longer path, arriving before
    the finger) and the usable corpus is two nights instead of ten.

    WHY IT CANNOT BE RECOVERED FROM THE SIGNAL FILES. The obvious estimator is the minimum of
    (host arrival - device timestamp) over a night: buffering is ONE-SIDED, so its minimum is the true
    offset, which is how NTP's minimum filter works. It was tried and it fails here, and the reason is
    in this file's sibling: `StreamWriter` records each sample's `phone` stamp BACK-TIMED across the
    packet from a single arrival. Every per-sample host stamp is therefore a derived quantity, and the
    lower edge of the distribution is smeared by the packet span rather than being an edge at all —
    measured, the minimum sits 27-115 ms below the 1st percentile, i.e. an outlier and not a floor.

    WHAT THIS RECORDS. The TRUE arrival instant of each PMD packet, beside the device timestamp of that
    packet's first and last sample. Nothing is derived and nothing is back-timed, so
    `min(arrival - first_sensor_ns)` has a real floor and the per-connection offset becomes measurable.
    `n_samples` is kept because the packet span is exactly the width of the smear this replaces.

    DELIBERATELY A SIDECAR, for the reason LinkLogWriter states: the vendor `*_ECG.txt` / `*_PPG.txt`
    layouts are a POSITIONAL contract that ECGDex/PPGDex/MotionDex parse by index, and adding a field to
    them silently corrupted consumers once already (2026-07-18). One extra file cannot.

    It is TELEMETRY, not physiology: it must never enter a `ganglior.node-export` as a metric.
    """

    def __init__(self, path: str, flush_interval: float = FLUSH_INTERVAL_S, fsync: bool = True):
        self.path = path
        self._health = _FlushHealth(path)
        # CAPTURE-FILESET-RESUME: a resumed set reuses this sidecar's name too — append, keep the header.
        # Torn-tail handling matches StreamWriter's (§3.5).
        _resume = False
        if os.path.exists(path) and os.path.getsize(path) > 0:
            with open(path, "rb+") as _t:
                _t.seek(-1, 2)
                if _t.read(1) != b"\n":
                    _t.seek(0)
                    _d = _t.read()
                    _c = _d.rfind(b"\n")
                    _t.truncate(_c + 1 if _c >= 0 else 0)
            _resume = os.path.getsize(path) > 0
        self._fh = open(path, "a" if _resume else "w", buffering=1 << 16, newline="\n")
        if not _resume:
            self._fh.write("Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples\n")
        self.rows = 0
        self._flush_interval = flush_interval
        self._fsync = fsync
        self._last_flush = _time.monotonic()

    def write(self, arrival: _dt.datetime, device: str, meas, first_ns, last_ns, n_samples: int) -> None:
        def _f(v):
            return "" if v is None else str(v)          # blank, never a fabricated 0
        landed = self._health.put(self._fh, f"{_phone_ts(arrival)};{device};{_f(meas)};"
                       f"{_f(first_ns)};{_f(last_ns)};{n_samples}\n")
        if landed:
            self.rows += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        try:
            self._fh.flush()
            if self._fsync:
                self._health.fsync(self._fh)
        except (OSError, ValueError) as _e:
            self._health.failed(_e)
        else:
            self._health.ok()

    def close(self) -> None:
        try:
            self.flush()
            self._fh.close()
        except (OSError, ValueError) as _e:
            self._health.failed(_e)

    @staticmethod
    def floor_ms(diffs_ms, q: float = 0.01):
        """The offset estimate, and whether it is a FLOOR or a smear — both, never one alone.

        NOT the bare minimum. Buffering is one-sided so the minimum is the estimator in principle, but a
        single anomalously early arrival — a scheduling artifact, a chrony step — moves it and nothing
        says so. A low QUANTILE is robust to that, and the GAP between the two is the diagnostic that
        made this sidecar necessary in the first place: on the back-timed per-sample stamps the minimum
        sat 27-115 ms below the 1st percentile, which is what a smeared edge looks like. A real floor has
        the two nearly coincident.

        Returns (estimate, spread), where spread = quantile - min. Small spread ⇒ a genuine floor and the
        estimate is usable; large spread ⇒ the edge is smeared and the number must NOT be spent as an
        offset. Callers are expected to check the second value; returning only the first is how the
        earlier attempt produced a confident answer from noise.
        """
        vals = sorted(v for v in diffs_ms if v is not None and v == v)
        if len(vals) < 100:
            return (None, None)          # too few to have an edge at all — refuse, do not guess
        lo = vals[0]
        qv = vals[min(len(vals) - 1, int(q * len(vals)))]
        return (qv, qv - lo)

    @property
    def flush_failures(self) -> int:
        """How many flushes have failed on this file. Surfaced beside `rows` in STATUS: `rows`
        counts what we were HANDED, this counts what may never have reached the disk."""
        return self._health.failures

    @property
    def rows_lost(self) -> int:
        """Rows whose `write` itself raised (ENOSPC/EIO at the buffer, or a notification that arrived
        after `close`). `rows` no longer counts them; this does. `rows + rows_lost` is what was handed."""
        return self._health.rows_lost

    @property
    def fsync_max_ms(self) -> float:
        """The longest single `fsync` this file has cost the event loop (§S2 — measured, not moved)."""
        return self._health.fsync_max_ms


class Spo2CsvWriter:
    """ViHealth-layout SpO2 CSV — `Time,Oxygen Level,Pulse Rate,Motion` with `HH:MM:SS DD/MM/YYYY`
    stamps, the exact shape OxyDex's oxydex-spo2 adapter reads (Clock Contract §2.4 vendor regex parses
    the stamp → floating tMs). One row per valid reading (~1/s). Used by the O2Ring/Viatom capture path."""

    def __init__(self, path: str, flush_interval: float = FLUSH_INTERVAL_S, fsync: bool = True):
        self.path = path
        self._health = _FlushHealth(path)
        self._fh = open(path, "w", buffering=1 << 16, newline="\n")
        self._fh.write("Time,Oxygen Level,Pulse Rate,Motion\n")
        self._n = 0
        self._flush_interval = flush_interval
        self._fsync = fsync
        self._last_flush = _time.monotonic()
        self._counted = True
        _writer_opened()

    def write(self, when: _dt.datetime, spo2, pr, motion: int) -> None:
        """`spo2` and `pr` may both be None — the ring reports values outside the physiologic range when
        it cannot read one (off the finger, poor perfusion).
        BLANK, never 0, for an absent value: a fabricated 0 is indistinguishable from a real reading
        (the rule OxyFrameLogWriter's docstring states, which this writer did not follow — capture.py
        passed `live["pr"] or 0`). Measured against the shipped OxyDex reader, `0` and blank are
        rejected IDENTICALLY (`parseInt('')` → NaN and `0 < 20` both `continue`), so this changes no
        downstream number — it stops the FILE asserting a pulse of zero that the ring never measured.
        Latent in practice: 0 occurrences across 110k rows of the real 2026-07-20..25 corpus.

        ⚠️ THE RULE APPLIES TO BOTH COLUMNS (audit F6, 2026-08-01). It was stated for `pr` and enforced
        only for `pr`: an absent SpO2 would have been formatted as the literal string `None` into the
        Oxygen Level column — not a fabricated 0, but not a blank either, and `parseInt('None')` is the
        same NaN by luck rather than by design. Both call sites in capture.py guard with
        `if spo2 is not None`, so this was never reached; the writer is where the rule is DOCUMENTED, so
        it is where it has to hold — the next caller does not read this docstring first."""
        stamp = when.strftime("%H:%M:%S %d/%m/%Y")   # LOCAL civil (Clock Contract) — O2Ring/ViHealth format
        landed = self._health.put(self._fh, f"{stamp},{'' if spo2 is None else spo2},{'' if pr is None else pr},{motion}\n")
        if landed:
            self._n += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        """Force the buffered tail to the OS (flush) and to disk (fsync) — bounds crash/power-loss loss."""
        try:
            self._fh.flush()
            if self._fsync:
                self._health.fsync(self._fh)
        except Exception as _e:
            self._health.failed(_e)
        else:
            self._health.ok()

    @property
    def rows(self) -> int:
        return self._n

    def close(self) -> None:
        try:
            self.flush(); self._fh.close()
        except Exception as _e:
            self._health.failed(_e)
        finally:
            if self._counted:
                self._counted = False
                _writer_closed()

    @property
    def flush_failures(self) -> int:
        """How many flushes have failed on this file. Surfaced beside `rows` in STATUS: `rows`
        counts what we were HANDED, this counts what may never have reached the disk."""
        return self._health.failures

    @property
    def rows_lost(self) -> int:
        """Rows whose `write` itself raised (ENOSPC/EIO at the buffer, or a notification that arrived
        after `close`). `rows` no longer counts them; this does. `rows + rows_lost` is what was handed."""
        return self._health.rows_lost

    @property
    def fsync_max_ms(self) -> float:
        """The longest single `fsync` this file has cost the event loop (§S2 — measured, not moved)."""
        return self._health.fsync_max_ms


# Polar's sensor clock is nanoseconds since 2000-01-01T00:00:00Z, carried verbatim as the secondary
# column.
#
# A `polar_ns_to_t_ms(ns) -> ns / 1e6` helper lived here, described as deriving "the 'timestamp [ms]'
# PSL column (ms since the same epoch)". That is the OPPOSITE of the real format: PSL's `timestamp [ms]`
# is RELATIVE to the recording's first sample and fractional — which `_rel_ms` states, verified against
# a real H10 export, and which a byte-for-byte diff against the vendor corpus confirms (a written ECG
# row reproduces a real one exactly, leading `0.0` included). It had ZERO production callers and two
# tests pinning the absolute semantics, so it read as validated. Its own neighbour says what a future
# caller would have caused: ECGDex infers `fs` from that column's STEP, and absolute ms makes it read
# 143/125 Hz instead of 130. Removed rather than corrected — `_rel_ms` is the single implementation,
# and it is the one the writers already use.
POLAR_EPOCH = _dt.datetime(2000, 1, 1, tzinfo=_dt.timezone.utc)

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
from typing import Iterable

# The writers use big OS buffers for throughput (StreamWriter 1 MB, Spo2CsvWriter 64 KB) and would
# otherwise only hit disk on close(). Overnight that means a hard kill or power loss loses the entire
# unflushed tail (up to a full buffer — minutes of ECG, or ~an hour of the slow 1/s SpO2 stream). So
# every writer force-flushes on a wall-clock cadence: flush() moves Python's buffer to the OS page
# cache (survives a process crash) and fsync() forces the OS cache to the physical medium (survives a
# power loss). At this cadence at most FLUSH_INTERVAL_S of the tail is ever at risk. `_time.monotonic()`
# drives the cadence — it's internal timing, not a written stamp, so the Clock Contract doesn't apply.
FLUSH_INTERVAL_S = 5.0

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
        self._failing = False

    def failed(self, exc: BaseException) -> None:
        self.failures += 1
        if self._failing:
            return                          # already said so; saying it again only hides the onset
        self._failing = True
        _log.warning("%s: WRITE FAILED (%s) — buffered data may NOT be on disk",
                     self.path, _write_error_name(exc))

    def ok(self) -> None:
        """Called ONLY from `flush`, never from `close`.

        `close` runs `flush` inside its own `try`, so a `close` that merely managed to shut a handle
        would otherwise clear a failing state its own flush had just set — and report "writing again"
        about a file whose tail never landed. The recovery claim belongs to the operation that
        actually wrote."""
        if not self._failing:
            return                          # the ordinary case: nothing to report about a live file
        self._failing = False
        _log.info("%s: writing again, after %d failed flush(es)", self.path, self.failures)



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


def _phone_ts(when: _dt.datetime) -> str:
    # Local civil time, zone-free, millisecond precision. `when` MUST be a local (naive or local-tz)
    # datetime — pass the host arrival time. Do not pass a UTC instant.
    return when.strftime("%Y-%m-%dT%H:%M:%S.") + f"{when.microsecond // 1000:03d}"


class StreamWriter:
    """One open file in a fixed vendor layout. Append rows as samples arrive; flush periodically."""

    # PSL-compatible headers, keyed by stream. `;`-separated, exactly as Polar Sensor Logger exports.
    HEADERS = {
        "ecg":  "Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]",
        "acc":  "Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]",
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
        self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{self._rel_ms(sensor_ns)};{uv}\n")
        self._bump()

    def write_acc(self, phone: _dt.datetime, sensor_ns: int, t_ms: float, x: int, y: int, z: int) -> None:
        self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{x};{y};{z}\n")
        self._bump()

    def write_ppg2w(self, phone: _dt.datetime, sensor_ns: int, ch0: int, ch1: int, motion: int) -> None:
        """One raw dual-wavelength sample (O2Ring cmd=0x05).

        A SEPARATE method rather than a branch inside `write_ppg`, because that function selects its
        layout by COUNTING optical columns — one means the ring's single reflectance path, three means
        the Verity. A two-wavelength row is neither, and squeezing it through the count would make the
        header and the row shape drift apart, which is the exact failure `ppg1` exists to prevent."""
        self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{ch0};{ch1};{motion}\n")
        self._bump()

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
            self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{cols[0]}\n")
        else:
            c0, c1, c2 = cols[:3]
            self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{c0};{c1};{c2};{ambient}\n")
        self._bump()

    # GYRO/MAG arrive SCALED to physical units (dps / gauss) — polar_pmd.axis_scale turns the device's
    # raw int16 into a float, so these two cannot use the integer formatting ACC keeps. `:.6g` holds the
    # full significance of a 16-bit sample (gyro 0.061 dps/LSB, mag 0.0015 G/LSB) without printing the
    # binary-fraction tail of the multiply.
    def write_gyro(self, phone: _dt.datetime, sensor_ns: int, t_ms: float, x: float, y: float, z: float) -> None:
        self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{x:.6g};{y:.6g};{z:.6g}\n")
        self._bump()

    def write_mag(self, phone: _dt.datetime, sensor_ns: int, t_ms: float, x: float, y: float, z: float) -> None:
        self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{x:.6g};{y:.6g};{z:.6g}\n")
        self._bump()

    def write_ppi(self, phone: _dt.datetime, sensor_ns: int, hr: int, pp_ms: int, err_ms: int, flags: int) -> None:
        # One row per beat, in PSL's PPI column ORDER: interval FIRST, hr LAST, and NO device-clock column.
        # `sensor_ns` is accepted for call-site compatibility and deliberately not emitted — PPI frames
        # carry no usable device clock (every row the box has written has sensor_ns == 0), which is what
        # nightqc.file_span_sec already assumes when it says "HR/RR/PPI carry no device clock".
        self._fh.write(f"{_phone_ts(phone)};{pp_ms};{err_ms};"
                       f"{flags & 1};{(flags >> 1) & 1};{(flags >> 2) & 1};{hr}\n")
        self._bump()

    def write_hr(self, phone: _dt.datetime, sensor_ns: int, bpm: int, rr_ms: Iterable[int]) -> None:
        # PSL layout: ONE HR row per notification in _HR.txt (HR only; HRV/Breathing left empty), and one
        # row per RR interval in the sibling _RR.txt (real intervals only — no blank rows). `sensor_ns` is
        # accepted for call-site compatibility but PSL's _HR/_RR carry only the phone timestamp.
        self._fh.write(f"{_phone_ts(phone)};{bpm}\n")
        self._bump()
        if self._rr_fh is not None:
            ts = _phone_ts(phone)
            for rr in rr_ms:
                self._rr_fh.write(f"{ts};{rr}\n")

    def _bump(self) -> None:
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
                os.fsync(self._fh.fileno())
            if self._rr_fh is not None:
                self._rr_fh.flush()
                if self._fsync:
                    os.fsync(self._rr_fh.fileno())
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
        return [self.path] + ([self._rr_path] if self._rr_path else [])

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
OXYFRAME_COLUMNS = (
    "Phone timestamp", "duration_s", "pi_pct", "motion", "spo2", "pr", "contact", "battery_pct",
    "batt_state", "flag",          # ── the original 10
    "ppg_n", "ppg_dur_step",       # O2RING-FRAME-SAMPLE-LOCK §7
    "ppg_offset", "flag_raw",      # DEVICE-RATE-TRUTH §6.1
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
        self._fh.write(";".join((stamp, _f(live.get("duration")), _f(live.get("pi")),
                                 _f(live.get("motion")), _f(live.get("spo2")), _f(live.get("pr")),
                                 _f(live.get("contact")), _f(live.get("batt")),
                                 _f(live.get("batt_state")), _f(live.get("flag")),
                                 _f(p.get("n")), _f(p.get("step")),
                                 _f(p.get("offset")), _f(live.get("flag_raw")),
                                 _f(live.get("run_status")))) + "\n")
        self.rows += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        try:
            self._fh.flush()
            if self._fsync:
                os.fsync(self._fh.fileno())
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
        self._fh.write(";".join((
            stamp, _f(st.get("trust")), _f(st.get("absolute_ok")), _f(st.get("synchronized")),
            _f(st.get("server")), _f(st.get("stratum")), _f(st.get("reference")),
            _f(st.get("root_dispersion_ms")), _f(st.get("jitter_us")), _f(st.get("packet_count")),
            str(st.get("reason") or "").replace(";", ","), _f(st.get("chrony_skew_ppm")),
            _f(st.get("timebase")))) + "\n")
        self.rows += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        try:
            self._fh.flush()
            if self._fsync:
                os.fsync(self._fh.fileno())
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
        self._fh.write(f"{_phone_ts(when)};{event};{_f(rtc_offset_s)};{_f(battery_state)};"
                       f"{_f(battery_level)};{_f(battery_raw2)};{_f(battery_raw3)}\n")
        self.rows += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        try:
            self._fh.flush()
            if self._fsync:
                import os as _os
                _os.fsync(self._fh.fileno())
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
        self._fh.write(f"{_phone_ts(when)};{device};{1 if connected else 0};"
                       f"{_f(rssi)};{_f(battery)};{_f(dropped)};{_f(duplicated)};{_f(link_epoch)};"
                       f"{_f(address)}\n")
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
                import os as _os
                _os.fsync(self._fh.fileno())
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
        self._fh.write(transition.as_row() + "\n")
        self.rows += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        try:
            self._fh.flush()
            if self._fsync:
                import os as _os
                _os.fsync(self._fh.fileno())
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
        self._fh.write(f"{_phone_ts(arrival)};{device};{_f(meas)};"
                       f"{_f(first_ns)};{_f(last_ns)};{n_samples}\n")
        self.rows += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        try:
            self._fh.flush()
            if self._fsync:
                import os as _os
                _os.fsync(self._fh.fileno())
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
        self._fh.write(f"{stamp},{'' if spo2 is None else spo2},{'' if pr is None else pr},{motion}\n")
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
                os.fsync(self._fh.fileno())
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

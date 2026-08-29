# tepna-capture — timeline.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# PER-STREAM CAPTURE TIMELINE + PER-DEVICE SIGNAL TRACE, for the monitor's cards.
#
# A green "connected" dot and a rolling 5 s waveform tell you about NOW. They cannot tell you that the
# ring spent 14 minutes off-link at 00:31, or that the H10 sat at -93 dBm for an hour before it dropped.
# That history exists on disk already — this module reads it and buckets it for display.
#
# TWO SOURCES, DELIBERATELY DIFFERENT, because they answer different questions:
#
#   capture files  -> WAS THIS STREAM WRITING? Each session file's start stamp is in its NAME and its
#                     row count gives its duration at the stream's rate, so a file covers
#                     [start, start + rows/fs] with no need to read a single row of content. That is a
#                     per-STREAM fact: the Verity's MAG can stall while its PPG keeps flowing.
#   LINK sidecar   -> WHAT WAS THE RADIO DOING? connected/rssi sampled ~every 34 s. That is a per-DEVICE
#                     fact — every stream on one sensor shares one link — so the signal trace is drawn
#                     per device and repeated on each of its stream cards.
#
# ── THE STATES, AND WHY GREY IS NOT RED ────────────────────────────────────────────────────────────
# The point of the strip is to distinguish WHY there is no data, because those causes are not equally
# bad and painting them the same colour would be the same dishonesty as fabricating a sample:
#
#   captured  the stream was writing
#   degraded  writing, but below its expected rate — a weak link losing packets, not a clean gap
#   nosignal  this device was disconnected while others kept going — out of range, off, or on charge
#   wedged    the ADAPTER was down, so EVERY device stopped at once. A different fault with a
#             different fix, and the only one that is the box's own doing.
#   idle      nothing was recording yet (before the first session) or it had ended. NOT a loss.
#
# `idle` vs `nosignal` is the distinction that matters most: a night that started at 22:30 has four
# hours of "no data" before it that are not gaps, and colouring them as loss would make every night
# look broken.
from __future__ import annotations

import datetime as _dt
import os

import nightqc
import writers

# One bucket per ~2 minutes over an 8 h night gives ~240 columns — about one per pixel on a phone-width
# strip, so nothing is averaged away that the eye could have seen anyway.
DEFAULT_BUCKETS = 240

# Below this fraction of the expected row count a bucket that DID write is called `degraded` rather than
# `captured`. Deliberately generous: bucket edges clip real sessions, so a stricter bar would paint
# healthy capture amber at every session boundary.
DEGRADED_BELOW = 0.6

# Stamp parsing moved to writers.file_stamp (audit F5) — anchored, year-validated, one implementation.
# The filename's id field and a device's full identity (current id + corrected-away
# predecessors) live in writers, next to the capture_filename they invert.
_file_device_id = writers.file_device_id
# capture_filename writes `{vendor}_{model}_{device_id}_{stamp}_{TAG}.{ext}`. Vendor and model may
# themselves contain underscores ("O2Ring-S", and a model could be renamed to anything), so the id is
# not a fixed field index — but it is ALWAYS the token immediately before the 14-digit stamp.
def covered_seconds(intervals: list[tuple[float, float]]) -> float:
    """Total wall time the intervals cover, counting OVERLAP ONCE.

    Summing raw lengths let coverage exceed 100 %. Sessions overlap whenever `rows / fs` over-states a
    session's duration, which happens as soon as the configured rate is below the rate the device
    actually ran at — and it also happens whenever two session files for one stream genuinely overlap.
    A '104.8 % captured' badge is not a number anyone can act on.
    """
    merged: list[list[float]] = []
    for s, e in sorted(intervals):
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    return sum(e - s for s, e in merged)


def _stamp_ms(name: str) -> float | None:
    """Session start from the filename stamp → epoch seconds (local civil, per the Clock Contract).

    The stamp is `YYYYMMDDHHMMSS` written by writers.capture_filename from a naive local datetime, so it
    is parsed back the same way — never through a timezone-aware path that would shift it."""
    stamp = writers.file_stamp(name)
    if not stamp:
        return None
    # ⚠️ THE CLOCK CONTRACT'S `24:00:00` CLAUSE HAS NO PRODUCER ON THIS PATH — a documented
    # NON-divergence, traced 2026-08-28 rather than assumed. §2.7 requires that end-of-day `24:00:00`
    # be ACCEPTED and normalised to next-day 00:00, and explicitly forbids "a bare `h > 23` guard".
    # `strptime("%H")` IS that bare guard: `20260228240000` raises here. That would be a divergence if
    # anything could emit it — and nothing can. The stamp's SOLE producer is
    # `writers.capture_filename`, which formats `started.strftime("%Y%m%d%H%M%S")` from a `datetime`
    # whose hour is 0–23 by construction; `writers.file_stamp` is anchored to that filename layout and
    # requires a plausible year, so a vendor name cannot reach here either. Both consumers
    # (`timeline._stamp_ms`, `nightqc._session_of`) read only what that writer wrote.
    # If a NON-strftime producer is ever routed into this path, this clause becomes live and the
    # rejection becomes a real bug — that is the condition that retires this comment.
    try:
        return _dt.datetime.strptime(stamp, "%Y%m%d%H%M%S").timestamp()
    except ValueError:
        return None


def stream_intervals(files: list[dict], device_id, tag: str, fs: float) -> list[tuple[float, float]]:
    """[(start_s, end_s)] this stream was writing, from session files alone.

    Duration is the file's OWN recorded span (`span_sec`, from its device-clock column) when it has one,
    and `rows / fs` otherwise — never the file's mtime, which for a killed or still-open session is when
    the last flush landed rather than where the data ends.

    Preferring the file's own clock is what makes an OLD night measurable (CAPTURE-HOST-DEEP-AUDIT §A4c):
    `fs` is the rate configured TODAY, and a rate that has been re-negotiated or corrected since the night
    was recorded over-states its duration — measured at 196.7 % coverage on the real 2026-07-16 H10 ACC
    and 134.6 % on the 2026-07-20 Verity ACC. The device wrote its own clock into the file; that number
    cannot go stale.

    `device_id` may be one id or several — a device that had its id corrected still owns the
    files written under the old one (writers.device_ids)."""
    ids = {device_id} if isinstance(device_id, str) else {i for i in (device_id or []) if i}
    ids.discard("")
    out = []
    for f in files:
        if f["stream"] != tag or not ids or _file_device_id(f["file"]) not in ids:
            continue
        t0 = _stamp_ms(f["file"])
        if t0 is None or not f["rows"]:
            continue
        dur = f.get("span_sec")
        if not dur:
            if fs <= 0:
                continue
            dur = f["rows"] / fs
        out.append((t0, t0 + dur))
    return sorted(out)


def bucket_stream(intervals: list[tuple[float, float]], t0: float, t1: float, n: int,
                  fs: float) -> list[str]:
    """Bucket the covered intervals into `n` states across [t0, t1].

    A bucket is `captured` when the intervals cover enough of it, `degraded` when they cover some but
    not enough, and `idle` when they cover none. `nosignal`/`wedged` are layered on afterwards by
    apply_link_states — this function only knows whether bytes were written, which is the honest limit
    of what session files can tell us."""
    if n <= 0 or t1 <= t0:
        return []
    width = (t1 - t0) / n
    out = []
    for i in range(n):
        b0, b1 = t0 + i * width, t0 + (i + 1) * width
        covered = 0.0
        for s, e in intervals:
            if e <= b0:
                continue
            if s >= b1:
                break
            covered += min(e, b1) - max(s, b0)
        frac = covered / width if width else 0.0
        out.append("captured" if frac >= DEGRADED_BELOW else ("degraded" if frac > 0.02 else "idle"))
    return out


def bucket_link(samples: list[tuple[float, int, float | None]], t0: float, t1: float,
                n: int) -> tuple[list[int | None], list[float | None]]:
    """(connected_per_bucket, median_rssi_per_bucket) from LINK samples [(ts, connected, rssi)].

    A bucket with no sample at all reports None for BOTH rather than carrying the previous value
    forward — the sidecar samples every ~34 s, so a gap means the poller itself was not running, and
    interpolating across that would invent link history."""
    if n <= 0 or t1 <= t0:
        return [], []
    width = (t1 - t0) / n
    conn: list[int | None] = [None] * n
    rssi: list[float | None] = [None] * n
    buckets: list[list[tuple[int, float | None]]] = [[] for _ in range(n)]
    for ts, c, r in samples:
        # int() truncates TOWARD ZERO, so a sample up to one bucket before t0 gives i == 0 and
        # slips past the `0 <= i` guard — a stale disconnected reading then paints the first
        # bucket nosignal. Reject out-of-window samples explicitly instead.
        if ts < t0 or ts > t1:
            continue
        # Clamp the right edge rather than excluding it. build() derives t1 from the samples, so the
        # LAST sample always sits exactly on t1 — and that is the most recent reading, the one a live
        # card is showing. `ts >= t1` silently dropped it every time.
        i = min(int((ts - t0) / width), n - 1)
        if 0 <= i < n:   # pragma: no branch — cannot be false once the explicit window check above
            buckets[i].append((c, r))   # exists: n >= 1 and t1 > t0 are guaranteed by the early
            # return, so width > 0; `ts >= t0` gives i >= 0 and the min() clamp gives i <= n-1. Kept
            # as an assertion of that reasoning rather than deleted, since it is the guard the
            # truncate-toward-zero comment above is describing the replacement of.
    for i, b in enumerate(buckets):
        if not b:
            continue
        conn[i] = 1 if any(c for c, _ in b) else 0
        vals = sorted(v for _, v in b if v is not None)
        if vals:
            rssi[i] = vals[len(vals) // 2]
    return conn, rssi


def apply_link_states(states: list[str], conn: list[int | None], wedged: list[bool]) -> list[str]:
    """Layer the radio's story onto the stream's.

    Only ever REPLACES `idle` — a bucket that genuinely wrote data stays `captured`/`degraded` whatever
    the link sampler thought, because bytes on disk outrank a 34 s poll. An idle bucket becomes
    `nosignal` when this device was disconnected, or `wedged` when the adapter itself was down, and
    stays `idle` when nothing was recording at all."""
    out = list(states)
    for i, s in enumerate(states):
        if s != "idle":
            continue
        if i < len(wedged) and wedged[i]:
            out[i] = "wedged"
        elif i < len(conn) and conn[i] == 0:
            out[i] = "nosignal"
    return out


def merge_link_samples(link: dict, keys) -> list[tuple[float, int, float | None]]:
    """Every sample belonging to one device, gathered from ALL of its keys and time-ordered.

    This used to be `link.get(addr) or link.get(name)`. The `or` is the bug: the first non-empty
    bucket won and every other key's history was silently dropped. On the real 2026-07-26 night the
    sidecar held 1238 name-keyed rows and 158 address-keyed rows for the same H10 — the address won,
    so the signal trace showed one hour of an eleven-hour night. A short flat trace reads as a quiet
    night, not a missing one, which is why nothing looked wrong."""
    out: list[tuple[float, int, float | None]] = []
    seen = set()
    for k in keys:
        if not k or k in seen:
            continue
        seen.add(k)
        out.extend(link.get(k) or [])
    out.sort()
    return out


def read_link_samples(
    night_dir: "str | list[str]",
) -> dict[str, list[tuple[float, int, float | None]]]:
    # `str | list[str]`: the body already fans a sequence out — see
    # `dirs = [night_dir] if isinstance(night_dir, str) else list(night_dir)` below. Both callers
    # (timeline.build, adapter_ab.night_profile) pass a LIST and always have; the annotation was
    # the only thing claiming otherwise.
    """LINK sidecar → {device key: [(ts, connected, rssi)]}, one bucket per PHYSICAL device.

    Keyed on ADDRESS wherever the file gives one, because a device can be renamed from the monitor and
    one was, mid-night, on 2026-07-25.

    The address column itself arrived mid-corpus, so a single night's sidecar is routinely half
    name-keyed and half address-keyed for the same sensor. Rows written after the column landed carry
    BOTH, and that is enough to place the earlier name-only rows: the mapping is learned from the file
    and the older rows fold onto the address. A name never seen beside an address is LEFT UNDER ITS
    NAME rather than guessed at — inventing that mapping would be fabrication, and an explicit
    `name_aliases` entry can still claim it."""
    rows: list[tuple[str, str | None, float, int, float | None]] = []
    name_to_addr: dict[str, str] = {}
    # One directory or several. A night that crosses midnight has its two halves in two folders, so the
    # name→address mapping learned in the later one has to reach the earlier one's rows.
    dirs = [night_dir] if isinstance(night_dir, str) else list(night_dir)
    paths = []
    for d in dirs:
        try:
            paths += [os.path.join(d, n) for n in sorted(os.listdir(d)) if n.endswith("_LINK.csv")]
        except OSError:
            continue
    for path in paths:
        try:
            with open(path, errors="replace") as fh:
                # Skip any leading '#' provenance comments — the LINK sidecar records which radio
                # captured the night on the line above the columns (writers.LinkLogWriter). Older
                # sidecars have none; both shapes must read.
                line0 = fh.readline()
                while line0.startswith("#"):
                    line0 = fh.readline()
                head = line0.rstrip("\n").split(";")
                idx = {k: i for i, k in enumerate(head)}
                i_ts, i_dev = idx.get("Phone timestamp", 0), idx.get("device", 1)
                i_c, i_r = idx.get("connected", 2), idx.get("rssi_dbm", 3)
                i_a = idx.get("address")
                for line in fh:
                    p = line.rstrip("\n").split(";")
                    if len(p) <= i_c:
                        continue
                    dev = p[i_dev].strip() if len(p) > i_dev else ""
                    addr = (p[i_a].strip() if i_a is not None and len(p) > i_a else "") or None
                    try:
                        ts = _dt.datetime.fromisoformat(p[i_ts]).timestamp()
                    except ValueError:
                        continue
                    r = None
                    if len(p) > i_r and p[i_r].strip():
                        try:
                            r = float(p[i_r])
                        except ValueError:
                            r = None
                    if addr and dev:
                        name_to_addr.setdefault(dev, addr)
                    rows.append((dev, addr, ts, 1 if p[i_c] == "1" else 0, r))
        except OSError:
            continue
    out: dict[str, list[tuple[float, int, float | None]]] = {}
    for dev, addr, ts, c, r in rows:
        key = addr or name_to_addr.get(dev) or dev
        if key:
            out.setdefault(key, []).append((ts, c, r))
    for v in out.values():
        v.sort()
    return out


def link_adapter(night_dir) -> dict[str, str]:
    """{sidecar filename: "adapter=… hci=…"} — which radio captured this night, read from the artifact.

    The A/B between two BLE adapters is only worth running if each night can say which one produced
    it. Before 2026-07-26 nothing did, and three adapters were present on the box."""
    out: dict[str, str] = {}
    dirs = [night_dir] if isinstance(night_dir, str) else list(night_dir)
    for d in dirs:
        try:
            names = sorted(n for n in os.listdir(d) if n.endswith("_LINK.csv"))
        except OSError:
            continue
        for n in names:
            try:
                with open(os.path.join(d, n), errors="replace") as fh:
                    first = fh.readline()
            except OSError:
                continue
            if first.startswith("#"):
                out[n] = first.lstrip("#").strip()
    return out


def wedge_buckets(link: dict[str, list[tuple[float, int, float | None]]], t0: float, t1: float,
                  n: int) -> list[bool]:
    """Buckets where EVERY device with samples was disconnected at once — the adapter's own failure.

    One sensor dropping is range; all of them dropping together is the radio, and that distinction is
    the whole reason the two get different colours. Requires ≥2 devices to have reported: with a single
    device there is no way to tell its own dropout from an adapter fault, and guessing would invent the
    more alarming of the two."""
    if n <= 0:
        return [False] * max(n, 0)
    # A DEVICE THAT NEVER CONNECTS IS NOT EVIDENCE OF ANYTHING. Tested against the real 2026-07-25
    # night, the naive quorum painted the first 20 minutes RED: the COOSPO is an optional backup that
    # was never present, so it contributed a permanent `disconnected` vote, and any bucket where one
    # real sensor was still bonding then read as "every device down = adapter wedge". A device that was
    # never up all night cannot distinguish a radio fault from its own absence, so it is excluded from
    # the quorum entirely.
    connected_ever = {k: v for k, v in link.items() if any(c for _, c, _ in v)}
    if len(connected_ever) < 2:
        # With fewer than two devices that ever worked there is no way to separate one sensor's dropout
        # from an adapter fault — and guessing would pick the more alarming of the two.
        return [False] * n
    per = {k: bucket_link(v, t0, t1, n)[0] for k, v in connected_ever.items()}
    # YOU CANNOT LOSE AN ADAPTER YOU NEVER HAD. Before the first successful connection every device is
    # naturally down — the daemon is still scanning and bonding — and the quorum above reads that as
    # "all devices down = wedge". On the real 2026-07-25 night that painted the first ~20 minutes red,
    # which is startup, not a fault. Wedge detection therefore starts only after the radio has been
    # demonstrably working at least once.
    first_up = next((i for i in range(n) if any(c[i] == 1 for c in per.values())), None)
    if first_up is None:
        return [False] * n
    # ...AND A DROPOUT YOU NEVER CAME BACK FROM IS THE NIGHT ENDING. The mirror of the rule above, and
    # the third false positive found in this function. At the end of a night you take the strap off and
    # dock the armband; both links drop within a bucket or two of each other, which is precisely the
    # adapter's signature — every device down at once. Firing there would paint a red "adapter fault"
    # on the tail of essentially every night. A wedge is a dropout the radio RECOVERED from, so only
    # buckets before the last successful connection can be one. A terminal silence is reported as
    # `nosignal`, which is the honest reading: the devices went away and we cannot say why.
    last_up = next((i for i in range(n - 1, -1, -1) if any(c[i] == 1 for c in per.values())), None)
    out = []
    for i in range(n):
        if i <= first_up or last_up is None or i >= last_up:
            out.append(False)
            continue
        seen = [c[i] for c in per.values() if c[i] is not None]
        out.append(len(seen) >= 2 and not any(seen))
    return out


def build(night_dir: str, devices: list[dict], buckets: int = DEFAULT_BUCKETS) -> dict:
    """The whole timeline for one night: per-stream state strips + per-device signal traces.

    `coverage_pct` is measured against the stream's OWN expected rate — nightqc._expected_hz, which
    prefers the device's configured rate over a model nominal. Grading against the nominal is what
    reported a complete night as `acc 24%` on 2026-07-25."""
    files = nightqc.scan_night(night_dir)
    data = [f for f in files if f["stream"] not in nightqc._SIDECAR_TAGS]
    # THE NIGHT CROSSES MIDNIGHT; THE FOLDER DOES NOT. night_dir() rolls by SESSION START date, so a
    # night that began at 22:26 leaves its first hours in yesterday's folder. Reading one directory
    # showed only the post-midnight half — every device's line appeared to start in the middle of the
    # night, and the missing hours rendered `idle`, the colour that means "nothing was recording".
    # Same gate nightqc has always used: pool only when THIS folder's earliest session opened just
    # after midnight, so an ordinary daytime session never drags in a whole prior day.
    dirs = [night_dir]
    if data:
        midnight = nightqc._midnight_of(night_dir)
        earliest = min(f["session"] for f in data)
        if midnight is not None and 0 <= earliest - midnight < nightqc._SESSION_GAP_SEC:
            prev = nightqc._prev_day_dir(night_dir)
            if prev and os.path.isdir(prev):
                data = [f for f in nightqc.scan_night(prev)
                        if f["stream"] not in nightqc._SIDECAR_TAGS] + data
                dirs.insert(0, prev)
    link = read_link_samples(dirs)

    # ── THE COVERAGE WINDOW (CAPTURE-HOST-DEEP-AUDIT §A4) ──────────────────────────────────────────
    # It comes from THE RECORDING, and it used to come from the LINK sidecar. The sidecar rolls per
    # calendar day, so a continuously running box always has one spanning 00:00→23:59 — and seeding
    # `spans` with its first/last sample made that the denominator. A flawless zero-loss 4 h night
    # (02:00→06:00, 1 872 000 rows, no gaps) therefore rendered as 16.7 % captured, against a line
    # whose own comment promises the opposite. The sidecar is still the fallback for a night that
    # recorded NOTHING — a device that connected and never streamed has no other window, and dropping
    # it would take the "connected but silent" view away with it.
    sessions = nightqc.merge_sessions(data) if data else []
    spans: list[float] = []
    if sessions:
        cur = max(sessions, key=lambda s: s[1])   # same scoping as nightqc.summarize, so they agree
        data = cur[2]
        spans = [cur[0], cur[1]]
        for f in data:
            s = _stamp_ms(f["file"])
            if s is None:
                continue
            spans.append(s)
            # ...and its END. `spans` collected file START stamps only, so the window stopped where the
            # last session BEGAN and `covered` — which does count durations — ran past it: 156.5 % on a
            # 9 h night with a 50 min outage, 466.7 % on a 1 h + 6 h pair. `span_sec` is the file's own
            # device clock, so it is also era-correct where `rows / fs` against today's configured rate
            # is not (the third mechanism, and the one that reaches 196.7 % on real corpus).
            if f.get("span_sec"):
                spans.append(s + f["span_sec"])
    else:
        for v in link.values():
            if v:   # pragma: no branch — read_link_samples only creates a key by appending to it, so
                spans.append(v[0][0]); spans.append(v[-1][0])   # no value here is ever the empty list
    if not spans:
        return {"night": os.path.basename(night_dir.rstrip("/")), "buckets": 0, "devices": []}
    t0, t1 = min(spans), max(spans)
    if t1 <= t0:
        t1 = t0 + 1
    wedged = wedge_buckets(link, t0, t1, buckets)

    out_devs = []
    for d in devices:
        did, addr = d.get("device_id"), d.get("address")
        # Address, current name, and any name the device has been called before — a rename does
        # not make the earlier half of the night somebody else's radio.
        samples = merge_link_samples(
            link, [addr, d.get("name"), *(d.get("name_aliases") or [])])
        conn, rssi = bucket_link(samples, t0, t1, buckets)
        streams = {}
        for s in d.get("streams") or []:
            fs = nightqc._expected_hz(d, s) or 0
            iv = stream_intervals(data, writers.device_ids(d), s.upper(), fs)
            st = apply_link_states(bucket_stream(iv, t0, t1, buckets, fs), conn, wedged)
            covered = covered_seconds(iv)
            streams[s] = {
                "states": st,
                "covered_sec": round(covered),
                # Against the SESSION span, not the wall-clock night: a sensor worn from 22:30 is not
                # 60 % complete because midnight-to-midnight exists.
                "coverage_pct": round(100 * covered / (t1 - t0), 1) if t1 > t0 else 0.0,
            }
        out_devs.append({"name": d.get("name"), "address": addr, "device_id": did,
                         "rssi": rssi, "streams": streams})
    return {"night": os.path.basename(night_dir.rstrip("/")),
            "t0": t0, "t1": t1, "buckets": buckets,
            "bucket_sec": round((t1 - t0) / buckets, 1) if buckets else 0,
            "devices": out_devs}

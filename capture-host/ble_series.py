# tepna-capture — ble_series.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The per-device BLE error-backoff RATE as a SERIES, read back from the daemon's own
`ble: since last line …` journal lines.

Row `2026-10-20-ble-backoff-rate-is-drawn-as-a-level-not-a-curve`. The card draws the newest rate
against the 20/h budget, so 4/h yesterday and 14/h tonight draw identically and a CLIMB is read by
comparing journal lines by hand. `blestats.log_line` already writes the rate on every line, and until
this module nothing read it back.

THE DECISION THE ROW ASKED FOR — journal or sampler, and what shape the value is:
  · THE JOURNAL, as `mem_series` already does for the memory block: the line is written at the status
    cadence, so a sampler would be a second producer of a number that already has one, and
    `status.json` is rewritten every tick and answers only "what is it now";
  · `backoff_rate` IS NOT A LEVEL, which is why this row was logged separately from the memory one. It
    is a WINDOWED RATE — `retry_rate_report` averages over a trailing window — so a point already
    spans that window, and the window travels WITH the point (`window_min`) rather than being assumed
    by whoever draws it;
  · COVERAGE RESTARTS WITH THE PROCESS. `retry_rate_report` reports `null` until observation covers
    the window, so the early points of a segment are null BY CONSTRUCTION rather than for want of a
    backoff. The line names that reason per device and this module carries it on the point, so a gap
    in the curve says why it is a gap (§∅ — a named reason, never a borrowed one).

Segmented per daemon PID for `mem_series`' reason and one of its own: a restart is a new process, and
the rate's own observation window restarts with it, so no point carries another PID's value.

§∅: a rate the line printed as `null` is `None`, never 0 — a measured 0.0/h is the figure an operator
wants after a bad night ends, and the two must never draw alike. `read_ble_series` returns `None`,
never an empty series, when the journal cannot be read."""

from __future__ import annotations

import datetime as _dt
import re
import subprocess

import journal_line

#: The row's decision, published with the series so no reader has to infer it.
SHAPES = {"backoff_rate": "windowed-rate-per-pid", "window_min": "window-of-the-point"}

BLE_NEEDLE = "INFO ble: since last line "
#: `blestats.log_line`: `backoff rate <device> <X.X|null>/h over <N> min`.
_RATE = re.compile(r"backoff rate (\S+) (null|\d+(?:\.\d+)?)/h over (\d+) min")
#: `retry_rate_report`'s own reason, which names its device: `backoff rate <device>: observed …`.
_REASON = re.compile(r"backoff rate (\S+): observed (\d+) s of the (\d+) s window")


def parse_ble_line(line: str) -> dict | None:
    """One journal line → `{pid, tMs, offsetMin, rates}`, or `None` when it is not a BLE line.

    `rates` is `{device: {rate, window_min, reason}}` — the devices this line reported, which is
    `retry_rate_report`'s set and may be empty on a line written before any backoff was observed."""
    if BLE_NEEDLE not in line:
        return None
    head = journal_line.stamp_of(line)
    if head is None:
        return None
    # The FIRST needle starts the body, so a line that somehow carries the marker twice keeps every
    # report rather than the last one. `split` states that decision where index arithmetic only
    # implied it, and two surviving mutants over that arithmetic were equivalent on every real line.
    body = line.split(BLE_NEEDLE, 1)[1]
    # The reasons are appended at the END of the line rather than beside their segment, so they are
    # read first and matched back by the device each one names. A device with a measured rate carries
    # no reason, and `None` there is the absence of a reason, not an unread one.
    reasons = {dev: f"observed {obs} s of the {win} s window" for dev, obs, win in _REASON.findall(body)}
    rates = {
        dev: {
            "rate": None if rate == "null" else float(rate),
            "window_min": int(mins),
            "reason": reasons.get(dev),
        }
        for dev, rate, mins in _RATE.findall(body)
    }
    return dict(head, rates=rates)


def series(lines) -> dict:
    """BLE lines → one segment per PID, points in time order, and the devices seen anywhere in them.

    `devices` is the UNION over the window, not the newest point's keys: a device that stopped being
    reported mid-window still has a curve to draw, and one that first appears late still gets a colour.
    A PID stays one segment only while it is contiguous, so no segment spans a restart."""
    segments: list[dict] = []
    devices: set[str] = set()
    for ln in lines:
        row = parse_ble_line(ln)
        if row is None:
            continue
        pid = row.pop("pid")
        devices.update(row["rates"])
        if not segments or segments[-1]["pid"] != pid:
            segments.append({"pid": pid, "points": []})
        segments[-1]["points"].append(row)
    for seg in segments:
        seg["points"].sort(key=lambda p: p["tMs"])
    return {
        "schema": "tepna.ble-series/1",
        "shapes": SHAPES,
        "devices": sorted(devices),
        "segments": segments,
    }


def read_ble_series(hours: float, now: _dt.datetime | None = None, run=None) -> dict | None:
    """The last `hours` of the capture unit's BLE lines, or `None` when journalctl cannot be read."""
    # Resolved at call time, not bound as a default: a default binds at import, so a test cannot swap
    # it without patching `__defaults__`, and mutmut's trampoline never reads the patched tuple.
    if run is None:
        run = subprocess.run
    until = now or _dt.datetime.now()
    since = until - _dt.timedelta(hours=hours)
    try:
        r = run(
            [
                "journalctl",
                "-u",
                "tepna-capture",
                "--no-pager",
                "-o",
                "short-iso",
                "--grep",
                "since last line",
                "--since",
                since.strftime("%Y-%m-%d %H:%M:%S"),
                "--until",
                until.strftime("%Y-%m-%d %H:%M:%S"),
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    # journalctl exits 1 AND prints `-- No entries --` when `--grep` matches nothing: an empty window,
    # not an unreadable one. Any other non-zero exit is unreadable (`mem_series` states the measurement).
    if r.returncode == 1 and "-- No entries --" in r.stdout:
        lines: list[str] = []
    elif r.returncode != 0:
        return None
    else:
        lines = r.stdout.split("\n")
    out = series(lines)
    out["window"] = {
        "hours": hours,
        "since": since.isoformat(timespec="seconds"),
        "until": until.isoformat(timespec="seconds"),
    }
    return out

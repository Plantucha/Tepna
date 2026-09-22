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
import os
import re
import subprocess

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
# the device's OWN wear evidence for the night: a file whose rows are beats/valid readings
WORN_EVIDENCE_BY_MODEL: dict[str, tuple[str, int]] = {
    "H10": ("Polar_H10_*_HR.txt", 1),
    "VeritySense": ("Polar_VeritySense_*_PPI.txt", 1),
    "O2Ring-S": ("Wellue_O2Ring-S_*_SPO2.csv", 1),
}


def read_journal(
    name: str, since: _dt.datetime, until: _dt.datetime, run=subprocess.run
) -> list[tuple[_dt.datetime, str]] | None:
    """[(local stamp, cause)] for one device's lines in the window, or None when journalctl is unavailable."""
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
        if not m or (name not in ln and "Starting tepna-capture" not in ln):
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


def attribute(gaps, events) -> dict[str, float]:
    """Minutes per cause. `events` None ⇒ every gap 'unattributed (no journal)'."""
    out: dict[str, float] = {}
    if events is None:
        for _, g in gaps:
            out["unattributed (no journal)"] = out.get("unattributed (no journal)", 0.0) + g / 60.0
        return out
    ts = [e[0] for e in events]
    for t0, g in gaps:
        i = bisect.bisect_right(ts, t0) - 1
        cause = events[i][1] if i >= 0 and (t0 - ts[i]).total_seconds() <= ATTRIB_WINDOW_S else "unattributed"
        out[cause] = out.get(cause, 0.0) + g / 60.0
    return out


def _has_worn_evidence(night_dir: str, model: str) -> bool | None:
    spec = WORN_EVIDENCE_BY_MODEL.get(model)
    if spec is None:
        return None
    files = glob.glob(os.path.join(night_dir, spec[0]))
    if not files:
        return None
    for f in files:
        try:
            with open(f, encoding="utf-8", errors="replace") as fh:
                next(fh, None)
                for line in fh:
                    parts = re.split(r"[;,]", line.rstrip("\n"))
                    if len(parts) > spec[1]:
                        try:
                            if float(parts[spec[1]]) > 0:
                                return True
                        except ValueError:
                            continue  # a torn row (a live file's tail, a repeated header) is not evidence either way
        except OSError:
            continue  # an unreadable evidence file cannot vouch for wear; the next file may
    return False


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
    journal_missing = False
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
        ev = journal(name, since, until)
        if ev is None:
            journal_missing = True
        by_cause = attribute(gaps, ev)
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
            "worn_evidence": worn,
            "worn_lost_min": round(lost, 1) if worn else (0.0 if worn is False else None),
            "daemon_caused_min": round(sum(v for k, v in by_cause.items() if k.startswith("daemon:")), 1),
        }
    if journal_missing:
        out["journal"] = "unavailable — every gap is unattributed"
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

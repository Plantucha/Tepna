# tepna-capture — night_report.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE MORNING REPORT — one file per night, and one line an operator reads on a phone.
#
# WHY A SEPARATE UNIT. The daemon is not touched: it is holding BLE links all night and a reporting
# bug must not be able to cost a recording. This runs on its own timer after the night closes, reads
# what the night left behind, and writes. Nothing here can block, restart or slow capture.
#
# WHAT IT IS FOR. A night either happened or it did not, and today the only way to know is to open the
# box and read four artifacts. The single line answers that question at breakfast; the file beside it
# holds the numbers the line compresses.
#
# 🔴 EVERY MISSING INPUT IS `unknown`, NEVER A NUMBER. This is the whole discipline of the file.
# An absent QC summary, an absent back-check, an absent sniffer verdict — each renders as the word
# `unknown`, and NOT as 0, `--`, `n/a`, or a silently omitted field. A zero in this report would be a
# measurement nobody took, and the report exists precisely so that a night nobody watched cannot read
# like a night that went well. `unknown` is the owner-ratified vocabulary (2026-09-06).
#
# ⚠️ THE WEBHOOK URL IS A SECRET AND IS NEVER PRINTED. It carries a token. This module builds the
# TEXT; delivery is `alerts.Notifier`'s job, which already validates the URL and never logs it. No
# function here accepts, stores, formats or returns the URL, so no future edit can leak it through the
# report file — the file is written from the same text the line carries.

from __future__ import annotations

import json
import os
import sys as _sys

#: The one word every absent input renders as. Not a sentinel to be tested against with `==` by
#: consumers — read the structured dict if you need to branch; this is what a HUMAN reads.
UNKNOWN = "unknown"

#: The ring's SpO2 stream is exactly one row per second, so its row count IS its measured seconds.
#: That is why hours come from this stream and not from the night's wall-clock span: the span includes
#: time the ring was on the charger, and reporting that as "ring hours" would overstate every night.
_SPO2_HZ = 1.0


def _hours_from_spo2(devices) -> float | None:
    """Ring hours from the SpO2 row count, or None when the ring is not in the summary at all.

    None, not 0.0 — a night with no ring entry is a night nobody can speak for, and 0.0 would claim the
    ring was present and measured nothing.
    """
    for dev in devices or []:
        if "O2Ring" in str((dev or {}).get("name", "")):
            rows = ((dev or {}).get("streams") or {}).get("spo2")
            if isinstance(rows, (int, float)) and rows >= 0:
                return float(rows) / _SPO2_HZ / 3600.0
            return None
    return None


def back_check(summary: dict | None) -> tuple[str, int | None]:
    """(verdict, span_count) for the end-of-night class-B back-check.

    Three outcomes, and the third is the one that must not be flattened into the second:
      * `ok`      — the back-check ran and no session reported a clipped span.
      * `fail`    — it ran and at least one session did.
      * `unknown` — it did NOT run: the key is absent, which is what a summary written by a daemon
                    predating the back-check looks like (measured on the 2026-09-06 night, whose
                    QC-SUMMARY.json carries no `class_b` key at all).

    An EMPTY list is `ok` with zero spans — the back-check looked and found nothing. An ABSENT key is
    `unknown` with no count. Those are different facts and the report says so.
    """
    if not isinstance(summary, dict) or "class_b" not in summary:
        return UNKNOWN, None
    blocks = summary.get("class_b")
    if not isinstance(blocks, list):
        return UNKNOWN, None
    spans = 0
    for b in blocks:
        got = (b or {}).get("clip")
        spans += len(got) if isinstance(got, list) else 0
    return ("fail" if spans else "ok"), spans


def sniffer_verdict(verdict_text: str | None) -> tuple[str, str]:
    """(pass_fail, coverage) read out of a `*.verdict.txt` written by tepna-sniff.sh.

    `unknown` for both when there is no verdict to read — which is the state on this box today,
    because the nightly sniffer timer is not installed. An absent air audit must never render as a
    clean one: that is the same failure the audit itself exists to prevent, one layer out.
    """
    if not verdict_text:
        return UNKNOWN, UNKNOWN
    ok = fail = False
    coverage = UNKNOWN
    for line in verdict_text.splitlines():
        st = line.strip()
        if st.startswith("AIR AUDIT:"):
            ok = "OK" in st.split("AIR AUDIT:", 1)[1][:6]
            fail = "FAILED" in st
        elif st.startswith("coverage"):
            after = st.split(":", 1)[1].strip() if ":" in st else ""
            coverage = after.split()[0] if after else UNKNOWN
    if not (ok or fail):
        return UNKNOWN, coverage
    return ("pass" if ok else "fail"), coverage


def build(night: str, summary: dict | None, verdict_text: str | None) -> dict:
    """Everything the report says, as data. `line` is what the operator reads; `detail` is the file."""
    hours = _hours_from_spo2((summary or {}).get("devices") if isinstance(summary, dict) else None)
    check, spans = back_check(summary)
    sniff, coverage = sniffer_verdict(verdict_text)
    return {
        "night": night,
        "ring_hours": hours,
        "spans": spans,
        "back_check": check,
        "sniffer": sniff,
        "coverage": coverage,
        "line": "%s: ring %s h, %s spans, back-check %s, sniffer coverage %s %s" % (
            night,
            UNKNOWN if hours is None else "%.1f" % hours,
            UNKNOWN if spans is None else spans,
            check,
            coverage,
            "?" if sniff == UNKNOWN else ("✓" if sniff == "pass" else "✗"),
        ),
    }


def render(report: dict) -> str:
    """The file beside the night: the line, then the numbers it compressed, one per row."""
    out = [report["line"], ""]
    for k in ("night", "ring_hours", "spans", "back_check", "sniffer", "coverage"):
        v = report.get(k)
        out.append("%-12s %s" % (k, UNKNOWN if v is None else v))
    out.append("")
    out.append("Every field above is a reading or the word `unknown`. A missing input is never a 0 —")
    out.append("a night nobody watched must not read like a night that went well.")
    return "\n".join(out) + "\n"


def read_night(captures_root: str, night: str, sniffer_dir: str | None = None) -> dict:
    """Gather one night's inputs off disk. Anything unreadable is simply absent → `unknown`."""
    summary = None
    try:
        with open(os.path.join(captures_root, night, "QC-SUMMARY.json"), encoding="utf-8") as fh:
            summary = json.load(fh)
    except (OSError, ValueError):
        summary = None
    verdict = None
    if sniffer_dir:
        try:
            names = sorted(n for n in os.listdir(sniffer_dir) if n.endswith(".verdict.txt"))
            if names:
                with open(os.path.join(sniffer_dir, names[-1]), encoding="utf-8") as fh:
                    verdict = fh.read()
        except OSError:
            verdict = None
    return build(night, summary, verdict)


def main(argv: list[str]) -> int:
    """`night_report.py <captures_root> <night> [sniffer_dir]` — write the file, print the LINE.

    Prints the line and nothing else on stdout, so the caller can hand it straight to the notifier
    without this module ever seeing a webhook URL. Writes `<captures_root>/<night>/NIGHT-REPORT.txt`.
    Exit 0 whatever the night contained: a report that fails on a bad night reports nothing, and a
    bad night is exactly when it is read.
    """
    if not 2 <= len(argv) <= 3:
        print("usage: night_report.py <captures_root> <night> [sniffer_dir]", file=_sys.stderr)
        return 2
    root, night = argv[0], argv[1]
    report = read_night(root, night, argv[2] if len(argv) > 2 else None)
    try:
        with open(os.path.join(root, night, "NIGHT-REPORT.txt"), "w", encoding="utf-8") as fh:
            fh.write(render(report))
    except OSError as exc:                     # a night dir that is gone or read-only
        print("night_report: could not write the report file: %r" % (exc,), file=_sys.stderr)
    print(report["line"])
    return 0


if __name__ == "__main__":                     # pragma: no cover - exercised via main(argv)
    _sys.exit(main(_sys.argv[1:]))

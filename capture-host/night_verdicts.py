# tepna-capture — night_verdicts.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Emit the two box-side nightly `tepna.verdict/1` objects from the command line.

    night_verdicts.py <captures_root> <night>        # from the night's QC-SUMMARY.json, beside it
    night_verdicts.py --sample <out_dir>             # both objects from synthetic input, into a directory
    night_verdicts.py --sample-json night-qc|night-backcheck
                                                     # ONE object from synthetic input, to stdout — the
                                                     # corpus-free `emits.cmd` the adoption gate
                                                     # (tools/verdict-adoption.mjs) runs in CI

The daemon writes QC-VERDICT.json and BACKCHECK-VERDICT.json on every QC tick (capture.qc_poller →
nightqc.write_verdicts). This CLI exists for two other readers: a night written before the verdicts
existed (re-emit from its summary, so the sealed-night reader finds an object rather than prose), and
the adoption manifest, which needs a well-formed object without a corpus. Exit 0 whatever the night
contained — a FAIL verdict is a successful emission; exit 2 only for a usage error or when nothing
could be written (no summary to read).
"""

from __future__ import annotations

import json
import os
import sys as _sys

import nightqc

SAMPLE_DEVICES: list[dict] = [
    {"name": "Ring", "device_id": "S8AW", "streams": ["spo2", "ppg"]},
    {"name": "Spare", "device_id": "ZZZZ", "streams": ["hr"], "optional": True},
]
SAMPLE_SUMMARY: dict = {
    "night": "sample",
    "devices": [{"name": "Ring", "coverage": {"spo2": 0.99, "ppg": 0.98}}],
    "missing": [],
    "degraded": [],
    "gaps_in_night": [],
    "span_sec": 7200,
    "class_b": [{"file": "Wellue_O2Ring-S_S8AW_sample_PPG.txt", "clips": {"ppg": 0}, "held": None}],
}


def emit(night_dir: str, summary: dict, devices: list[dict]) -> list[str]:
    nightqc.write_verdicts(night_dir, summary, devices)
    return [os.path.join(night_dir, n) for n in (nightqc._QC_VERDICT_NAME, nightqc._BACKCHECK_VERDICT_NAME)]


def sample_object(gate: str) -> dict:
    """The synthetic-input object for one gate, built by the same functions the daemon runs."""
    if gate == nightqc._QC_GATE:
        return nightqc.qc_verdict(SAMPLE_SUMMARY, SAMPLE_DEVICES, night_dir="<sample>")
    if gate == nightqc._BACKCHECK_GATE:
        # the back-check reads the directory: a scratch one holding the file the sample summary names
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "Wellue_O2Ring-S_S8AW_sample_PPG.txt"), "a", encoding="utf-8").close()
            return nightqc.backcheck_verdict(d, SAMPLE_SUMMARY)
    raise ValueError(f"unknown gate {gate!r}: {nightqc._QC_GATE} | {nightqc._BACKCHECK_GATE}")


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "--sample-json":
        try:
            obj = sample_object(argv[1])
        except ValueError as exc:
            print(f"night_verdicts: {exc}", file=_sys.stderr)
            return 2
        print(json.dumps(obj, indent=1))
        return 0
    if len(argv) == 2 and argv[0] == "--sample":
        out = argv[1]
        os.makedirs(out, exist_ok=True)
        # the sample night holds the one class-B file its summary names, so the back-check is a PASS over 1
        open(os.path.join(out, "Wellue_O2Ring-S_S8AW_sample_PPG.txt"), "a", encoding="utf-8").close()
        for p in emit(out, SAMPLE_SUMMARY, SAMPLE_DEVICES):
            print(p)
        return 0
    if len(argv) != 2:
        print(
            "usage: night_verdicts.py <captures_root> <night> | --sample <out_dir> | --sample-json <gate>",
            file=_sys.stderr,
        )
        return 2
    root, night = argv
    night_dir = os.path.join(root, night)
    try:
        with open(os.path.join(night_dir, nightqc._SUMMARY_NAME), encoding="utf-8") as fh:
            summary = json.load(fh)
    except (OSError, ValueError) as exc:
        print(f"night_verdicts: no readable {nightqc._SUMMARY_NAME} in {night_dir} ({exc!r})", file=_sys.stderr)
        return 2
    if not isinstance(summary, dict):
        print(f"night_verdicts: {nightqc._SUMMARY_NAME} in {night_dir} is not an object", file=_sys.stderr)
        return 2
    # the summary carries the JUDGED devices, not the config: rebuild the declared-stream list from it
    # (every device the daemon judged was non-optional — optional ones only appear under optional_absent)
    devices: list[dict] = [
        {"name": d.get("name"), "streams": list((d.get("streams") or {}).keys())}
        for d in summary.get("devices") or []
        if isinstance(d, dict)
    ]
    for p in emit(night_dir, summary, devices):
        print(p)
    return 0


if __name__ == "__main__":  # pragma: no cover — the CLI seam; main() is tested directly
    raise SystemExit(main(_sys.argv[1:]))

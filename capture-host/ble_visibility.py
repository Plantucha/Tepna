# tepna-capture — ble_visibility.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Record WHICH RADIO CAN SEE WHICH DEVICE, with the denominator, so the question is a read.
#
# WHY THIS EXISTS. On 2026-09-04 `hci0` stopped seeing the CPAP. Answering "is this adapter broken,
# and since when?" took an hour, three wrong hypotheses (oversubscribed radio, dead antenna, missing
# capability) and about twenty ad-hoc commands. Every fact needed already existed on the box; none
# of it was written down anywhere a later session could read.
#
# ⚠️ THE JOURNAL CANNOT ANSWER IT, AND THAT IS THE WHOLE POINT OF THIS FILE. capture.py logs
# `CPAP discovery failed over: <primary> did not answer, found on <sibling>` — so a FAILURE names
# both adapters and a SUCCESS on the primary logs nothing at all. Measured over 7 days:
#
#     found on 28:0C:50:0C:18:FD   863
#     found on AC:A7:F1:29:9D:1D     0   ← the primary; structurally silent when it works
#
# So a failure COUNT is available and a failure RATE is not, and a count without its denominator
# supports no conclusion: "2 failovers in the last hour" is compatible with 2 scans and with 200.
# I read that zero as "the adapter never worked" and was wrong. Every record here therefore carries
# `devices_seen` — how many devices that adapter found IN THAT SCAN — so the denominator exists by
# construction and both a rate and an absence become computable after the fact.
#
# An adapter that ERRORED is not an adapter that saw nothing. `scans_failed` is counted separately
# and excluded from the rate, because "could not look" and "looked and found nothing" are different
# facts and collapsing them is how a blind instrument reads as a clean one.

from __future__ import annotations

import json
import sys
from statistics import median

RECORD_VERSION = 1


def make_record(when: str, scans: dict, targets: list[str]) -> dict:
    """One scan round -> one record.

    `scans` maps adapter -> {"devices": {mac: rssi}} or {"error": "why"}. `targets` are the MACs we
    care about; each is recorded as an RSSI or an explicit None, never omitted — an absent key and
    a device that was not seen would otherwise read identically.
    """
    wanted = [t.upper() for t in targets]
    adapters: dict[str, dict] = {}
    for adapter, result in sorted(scans.items()):
        error = result.get("error")
        if error:
            adapters[adapter] = {"error": error, "devices_seen": None, "targets": {}}
            continue
        seen = {mac.upper(): rssi for mac, rssi in result.get("devices", {}).items()}
        adapters[adapter] = {
            "error": None,
            "devices_seen": len(seen),
            "targets": {t: seen.get(t) for t in wanted},
        }
    return {"v": RECORD_VERSION, "t": when, "adapters": adapters}


def append_record(path: str, record: dict) -> None:
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, sort_keys=True) + "\n")


def read_records(path: str) -> list[dict]:
    """Skip unparseable lines rather than failing the whole history on one bad write.

    A partially-written final line is the normal cost of appending from a killed process; losing
    every earlier record to it would be the worse failure.
    """
    out = []
    with open(path, encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except ValueError:
                # SAY WHAT WAS HIDDEN. Skipping quietly would make the history under-report by an
                # unknown amount, which is the same defect as a count with no denominator: the
                # digest would look complete while resting on fewer records than it claims.
                print("ble_visibility: %s line %d is not JSON — SKIPPED, the digest below is "
                      "missing it" % (path, lineno), file=sys.stderr)
    return out


def visibility(records: list[dict], target: str) -> dict:
    """Per adapter: how often it saw `target`, out of how many scans it actually completed."""
    want = target.upper()
    stats: dict[str, dict] = {}
    for rec in records:
        for adapter, info in rec.get("adapters", {}).items():
            st = stats.setdefault(adapter, {"scans_ok": 0, "scans_failed": 0,
                                            "seen": 0, "rssi": [],
                                            "devices_seen": []})
            if info.get("error"):
                st["scans_failed"] += 1
                continue
            st["scans_ok"] += 1
            st["devices_seen"].append(info.get("devices_seen") or 0)
            rssi = info.get("targets", {}).get(want)
            if rssi is not None:
                st["seen"] += 1
                st["rssi"].append(rssi)
    for st in stats.values():
        st["rate"] = (st["seen"] / st["scans_ok"]) if st["scans_ok"] else None
        st["median_rssi"] = median(st["rssi"]) if st["rssi"] else None
        st["median_devices_seen"] = (median(st["devices_seen"])
                                     if st["devices_seen"] else None)
        del st["rssi"], st["devices_seen"]
    return stats


def _rate_cell(st: dict) -> str:
    if st["scans_ok"] == 0:
        return "no completed scan"
    return "%d/%d (%.0f%%)" % (st["seen"], st["scans_ok"], 100 * st["rate"])


def format_visibility(stats: dict, target: str) -> str:
    """A digest that states the denominator on every line, and never implies one it lacks."""
    if not stats:
        return "no records for %s — nothing has been collected yet." % target
    lines = ["visibility of %s" % target,
             "%-20s %-18s %-9s %s" % ("adapter", "saw it", "med RSSI", "med devices/scan")]
    for adapter, st in sorted(stats.items()):
        lines.append("%-20s %-18s %-9s %s%s" % (
            adapter,
            _rate_cell(st),
            "-" if st["median_rssi"] is None else "%d" % st["median_rssi"],
            "-" if st["median_devices_seen"] is None else "%g" % st["median_devices_seen"],
            "   (%d scan(s) FAILED — excluded)" % st["scans_failed"] if st["scans_failed"] else "",
        ))
    blind = [a for a, st in sorted(stats.items()) if st["scans_ok"] and st["seen"] == 0]
    if blind:
        lines.append("")
        lines.append("BLIND: %s completed scans and never saw %s."
                     % (", ".join(blind), target))
        lines.append("  A radio that enumerates other devices but never this one is a bluez")
        lines.append("  per-device state wedge, not range. Remedy: tepna-btreset.sh <usb-bus-port>.")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    """Read the log and answer 'which radio can see this device' in one command.

    Hand-invoked, like adapter_ab: the point of collecting is that the question becomes a read
    instead of twenty ad-hoc commands, so the reader ships with the recorder.
    """
    if len(argv) < 2:
        print("usage: ble_visibility.py <records.jsonl> <MAC>", file=sys.stderr)
        return 2
    try:
        records = read_records(argv[0])
    except OSError as exc:
        print("ble_visibility: cannot read %s: %s" % (argv[0], exc), file=sys.stderr)
        return 1
    print(format_visibility(visibility(records, argv[1]), argv[1]))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main(sys.argv[1:]))

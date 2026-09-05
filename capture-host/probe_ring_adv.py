# tepna-capture — probe_ring_adv.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
"""probe_ring_adv — record every advertisement the O2Ring emits, labelled with what the ring was DOING.

THE FIRST MEASUREMENT TASK of the automatic-harvest work, and the reason it exists is an absence:
no advertisement byte from the ring has ever been captured in this repo. Every fact Tepna holds about
the ring's radio behaviour comes from a CONNECTED link (the live 0x04 reply says worn/recording), or
from a brief quoting the vendor app's expectations — `O2RING-PROTOCOL` §6 names two advertising modes
(manufacturer id 0x036F "recording", 0xF34E "sync after the button") and marks both UNTESTED, and its
"advertises only while worn" is flagged there as possibly a scanner artefact. A harvest state machine
that decides WHEN to connect from advertisements cannot be built on that, and inventing a bit mask to
fill the gap is the one thing the task forbids. So: measure first.

What one row records (JSONL, one per sighting):
    host_wall · host_mono · scan_mode actually used · address · local_name (DISPLAY metadata only —
    identity is the address, standing ruling) · rssi · tx_power · manufacturer data as {id_hex: payload_hex}
    · service_data {uuid: hex} · service_uuids · whatever raw the BlueZ backend exposes (AdvertisingData /
    AdvertisingFlags / AddressType / Connectable, when present) · the operator's LABEL of the ring's
    physical state at that instant · `expected` (address == the configured ring) · `hypothesis` (which of
    the two brief-quoted manufacturer ids, if any, this payload carries — a TAG for the analyst, not a
    decision the tool makes).

The label is the measurement. Run one invocation per phase of the protocol, or keep one running and
change the label through `--label-file` (the tool re-reads it on every sighting), so a TRANSITION —
finger out, button press, ring into the charger — lands in the same stream with the label flipping
at the operator's stamp:

    worn-recording · removed-idle · button-pressed · charger · post-harvest · connecting-while-worn ·
    auto-power-off-wait · after-failed-connect-N

Privacy: only the expected address and rows carrying a hypothesised ring manufacturer id are written.
Everything else in radio range is COUNTED (per-mode totals in the summary) and never stored — a
neighbour's phone address is not this measurement's business. `--all` widens that, deliberately.

Passive vs active. BlueZ offers passive scanning only through or_patterns (AD-type prefix filters) on
a bluetoothd with --experimental (see `capture._connect_scan`'s note; without patterns the scanner
REFUSES at construction). A pattern is a hypothesis about the payload, so a passive run can only see
what the hypothesis predicts — it cannot discover an unexpected mode. Default is therefore ACTIVE with
duplicate suppression OFF (every advert, so intervals can be measured), and `--mode passive` is the
declared experiment: patterns on the two manufacturer ids, and the row says which mode saw it.

Usage (on the box; the daemon's O2Ring runner must be off the link — link_guard):
    .venv/bin/python probe_ring_adv.py --address F2:35:.. --label worn-recording --duration 600 \
        --out /srv/tepna/probe/ring_adv/2026-09-05_worn.jsonl [--label-file /run/ring_label] [--mode passive]
Then `--summarize <jsonl>` prints per-address counts, advert intervals (median/p90/max), RSSI range and
the distinct manufacturer payloads seen under each label — the table the harvest brief will cite.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
from typing import Any, Callable

sys.path.insert(0, ".")

# Manufacturer ids the protocol brief attributes to the ring's two advertising modes. They are quoted
# here as TAGS so the analyst can find the rows — nothing in this tool (or the daemon) treats them as
# decoded state. `O2RING-PROTOCOL-2026-07-17-BRIEF.md` §6, both marked untested there.
MFR_HYPOTHESES: dict[int, str] = {
    0x036F: "brief§6: T8520 recording-mode advert (UNTESTED)",
    0xF34E: "brief§6: S8-AW sync-mode advert after the button (UNTESTED)",
}

# BlueZ Device1 properties worth keeping verbatim when the backend hands them over. `AdvertisingData` is
# the raw AD-structure dict (type → bytes) and only appears on newer bluetoothd builds; recording it when
# present is the only way this tool ever sees bytes the decoded fields dropped.
_PLATFORM_KEYS = ("AdvertisingFlags", "AdvertisingData", "AddressType", "Connectable", "TxPower", "Name", "Alias")


def _hex(b: Any) -> str:
    return bytes(b).hex()


def platform_extras(platform_data: Any) -> dict[str, Any]:
    """The BlueZ-specific leftovers of a sighting, hex-encoded. Tolerates any shape: bleak's BlueZ
    backend passes `(object_path, props_dict)`, other backends pass something else, tests pass None."""
    props = platform_data[1] if isinstance(platform_data, (tuple, list)) and len(platform_data) >= 2 else platform_data
    if not isinstance(props, dict):
        return {}  # an empty dict falls through and yields {} from the loop — no sentinel to mutate
    out: dict[str, Any] = {}
    for k in _PLATFORM_KEYS:
        if k not in props:
            continue
        v = props[k]
        v = getattr(v, "value", v)              # dbus_fast Variant → payload
        if isinstance(v, dict):
            out[k] = {str(t): _hex(p) for t, p in v.items()}
        elif isinstance(v, (bytes, bytearray)):
            out[k] = _hex(v)
        else:
            out[k] = v
    return out


def hypotheses_for(manufacturer_data: dict[int, Any]) -> list[str]:
    """Which brief-quoted manufacturer ids this payload carries — an analyst tag, never a state."""
    return [f"0x{cid:04X}: {MFR_HYPOTHESES[cid]}" for cid in sorted(manufacturer_data) if cid in MFR_HYPOTHESES]


def decode_sighting(address: str, adv: Any, *, expected_addr: str, label: str, scan_mode: str,
                    host_wall: float, host_mono: float) -> dict[str, Any]:
    """One advertisement → one flat, JSON-safe row. Pure; `adv` is anything with bleak's
    AdvertisementData attribute names (the fake in the tests is a namespace)."""
    mfr = {int(k): v for k, v in (getattr(adv, "manufacturer_data", None) or {}).items()}
    svc = getattr(adv, "service_data", None) or {}
    return {
        "host_wall": round(host_wall, 3),
        "host_mono": round(host_mono, 6),
        "scan_mode": scan_mode,
        "label": label,
        "address": address.upper(),
        "expected": address.upper() == expected_addr.upper(),
        "local_name": getattr(adv, "local_name", None),
        "rssi": getattr(adv, "rssi", None),
        "tx_power": getattr(adv, "tx_power", None),
        "manufacturer_data": {f"0x{cid:04X}": _hex(p) for cid, p in sorted(mfr.items())},
        "service_data": {str(u): _hex(p) for u, p in svc.items()},
        "service_uuids": list(getattr(adv, "service_uuids", None) or []),
        "platform": platform_extras(getattr(adv, "platform_data", None)),
        "hypothesis": hypotheses_for(mfr),
    }


def keep_row(row: dict[str, Any], *, keep_all: bool) -> bool:
    """Privacy filter: the configured ring, or a payload carrying a hypothesised ring id. Everything
    else is counted, never written."""
    return keep_all or row["expected"] or bool(row["hypothesis"])


def label_reader_for(initial: str, path: str | None) -> Callable[[], str]:
    """The current operator label: the CLI value, overridden by the first line of `path` whenever that
    file exists and is non-empty — so a transition can be stamped from a second shell without
    stopping the run."""
    def read() -> str:
        if path:
            try:
                with open(path, encoding="utf-8") as fh:
                    first = fh.readline().strip()
                if first:
                    return first
            except OSError:
                pass  # label file absent/unreadable this instant → the initial label stands; not a failure
        return initial
    return read


class JsonlSink:
    """Append-only JSONL with a flush per row: a probe run ends with Ctrl-C, and the row written the
    instant before must be on disk."""

    def __init__(self, path: str):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self._fh = open(path, "a", encoding="utf-8")
        self.n = 0

    def write(self, row: dict[str, Any]) -> None:
        self._fh.write(json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n")
        self._fh.flush()
        self.n += 1

    def close(self) -> None:
        self._fh.close()


async def run_probe(*, scanner_factory, expected_addr: str, sink, duration_s: float | None,
                    label_reader: Callable[[], str], scan_mode: str, keep_all: bool = False,
                    mono=time.monotonic, wall=time.time, sleep=asyncio.sleep,
                    progress: Callable[[str], None] | None = None) -> dict[str, Any]:
    """The testable orchestration. `scanner_factory(callback)` returns an object with async
    `start()`/`stop()` that calls `callback(device, adv)` per advertisement — bleak's BleakScanner
    shape, faked in the tests. Returns the run's counters (written rows, dropped-other-address
    sightings, distinct other addresses seen — the last as a COUNT, so the summary can say how busy
    the air was without naming anyone)."""
    counters = {"written": 0, "dropped": 0, "expected_seen": 0}
    others: set[str] = set()
    t_end = None if duration_s is None else mono() + duration_s

    def on_adv(device, adv):
        row = decode_sighting(device.address, adv, expected_addr=expected_addr, label=label_reader(),
                              scan_mode=scan_mode, host_wall=wall(), host_mono=mono())
        if row["expected"]:
            counters["expected_seen"] += 1
        if keep_row(row, keep_all=keep_all):
            sink.write(row)
            counters["written"] += 1
            if progress:
                progress(f"{row['label']} {row['address']} rssi={row['rssi']} "
                         f"mfr={row['manufacturer_data']} name={row['local_name']!r}")
        else:
            counters["dropped"] += 1
            others.add(row["address"])

    scanner = scanner_factory(on_adv)
    await scanner.start()
    try:
        while t_end is None or mono() < t_end:
            await sleep(1.0)
    finally:
        await scanner.stop()
        sink.close()
    return {"written": counters["written"], "dropped": counters["dropped"],
            "other_addresses": len(others), "expected_seen": counters["expected_seen"]}


def _quantile(xs: list[float], q: float) -> float:
    """Nearest-rank quantile for q in [0, 1]; the only caller passes 0.9. No clamp: a clamp against
    q > 1 guards nothing reachable and only breeds equivalent mutants."""
    s = sorted(xs)
    return s[int(round(q * (len(s) - 1)))]


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Per address × label: sightings, span, inter-advert intervals (median / p90 / max), RSSI range,
    the DISTINCT manufacturer payloads and local names seen. Intervals come from `host_mono`, so they
    are the host's view of the advert cadence including whatever the scanner dropped — a lower bound
    on the ring's rate, never the rate itself, and the summary says so."""
    by: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in rows:
        by.setdefault((r["address"], r["label"]), []).append(r)
    out: dict[str, Any] = {"note": "intervals are host-observed (scanner drops included): a LOWER bound on advert rate",
                           "groups": []}
    for (addr, label), grp in sorted(by.items()):
        grp.sort(key=lambda r: r["host_mono"])
        monos = [r["host_mono"] for r in grp]
        gaps = [b - a for a, b in zip(monos, monos[1:]) if b > a]
        rssis = [r["rssi"] for r in grp if isinstance(r["rssi"], (int, float))]
        payloads = sorted({json.dumps(r["manufacturer_data"], sort_keys=True) for r in grp})
        out["groups"].append({
            "address": addr, "label": label, "n": len(grp),
            "span_s": round(monos[-1] - monos[0], 3),     # a group is never empty; one row → 0.0
            "interval_s": None if not gaps else {
                "median": round(statistics.median(gaps), 3),
                "p90": round(_quantile(gaps, 0.9), 3),
                "max": round(max(gaps), 3),
            },
            "rssi": None if not rssis else {"min": min(rssis), "max": max(rssis)},
            "scan_modes": sorted({r["scan_mode"] for r in grp}),
            "manufacturer_payloads": payloads,
            "hypotheses": sorted({h for r in grp for h in r["hypothesis"]}),
            "local_names": sorted({str(r["local_name"]) for r in grp}),
        })
    return out


def load_rows(path: str) -> list[dict[str, Any]]:
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def _or_patterns():  # pragma: no cover - bleak/BlueZ type construction, exercised only on the box
    from bleak.args.bluez import OrPattern
    from bleak.assigned_numbers import AdvertisementDataType

    # Manufacturer-specific data, company id little-endian at offset 0 — the two hypothesised ids.
    return [OrPattern(0, AdvertisementDataType.MANUFACTURER_SPECIFIC_DATA, cid.to_bytes(2, "little"))
            for cid in MFR_HYPOTHESES]


def make_bleak_scanner_factory(mode: str, adapter: str | None):  # pragma: no cover - bleak I/O edge, CI has no radio
    from bleak import BleakScanner

    def factory(callback):
        bluez: dict[str, Any] = {}
        if adapter:
            bluez["adapter"] = adapter
        if mode == "passive":
            bluez["or_patterns"] = _or_patterns()
        else:
            # BlueZ's DuplicateData=True DISABLES duplicate suppression: every advert surfaces, which is
            # what an interval measurement needs. bleak's default (False) would hand us only RSSI changes.
            # bleak wraps the value in the D-Bus Variant itself (set_scanning_filter).
            bluez["filters"] = {"DuplicateData": True}
        return BleakScanner(detection_callback=callback, scanning_mode=mode, bluez=bluez)

    return factory


def _print_summary(path: str) -> int:
    print(json.dumps(summarize(load_rows(path)), indent=1))
    return 0


async def main(argv=None):  # pragma: no cover - CLI wiring over the pragma'd bleak edge
    from link_guard import require_free_link

    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--address", help="the paired ring's BLE address (identity is the address; names are display)")
    ap.add_argument("--label", default="unlabelled", help="what the ring is physically doing during this run")
    ap.add_argument("--label-file", default=None, help="re-read on every sighting; first line overrides --label")
    ap.add_argument("--duration", type=float, default=None, help="seconds (default: until Ctrl-C)")
    ap.add_argument("--out", default=None, help="JSONL path (one row per sighting)")
    ap.add_argument("--mode", choices=("active", "passive"), default="active")
    ap.add_argument("--adapter", default=None, help="hciN to pin the free radio")
    ap.add_argument("--all", action="store_true", help="also write sightings of OTHER addresses (privacy: default off)")
    ap.add_argument("--summarize", default=None, metavar="JSONL", help="print the per-address×label table and exit")
    args = ap.parse_args(argv)
    if args.summarize:
        return _print_summary(args.summarize)
    if not args.address or not args.out:
        ap.error("--address and --out are required for a capture run")
    require_free_link()
    sink = JsonlSink(args.out)
    result = await run_probe(
        scanner_factory=make_bleak_scanner_factory(args.mode, args.adapter),
        expected_addr=args.address, sink=sink, duration_s=args.duration,
        label_reader=label_reader_for(args.label, args.label_file), scan_mode=args.mode,
        keep_all=args.all, progress=lambda s: print(s, file=sys.stderr),
    )
    print(json.dumps(result), file=sys.stderr)
    return 0


if __name__ == "__main__":  # pragma: no cover
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        raise SystemExit(130) from None

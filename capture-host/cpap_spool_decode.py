# tepna-capture — cpap_spool_decode.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# CPAP-AS11-BLE-WIRE-NOW WU1: decode the committed AS11 `Summary` spool rounds rig-side.
#
# `cpap_spool.py` stores each round's raw bytes and decodes NOTHING; this is the read-only consumer it
# names. It reads the ledger (the consumer contract's read index — never a directory listing), walks
# each committed `.bin` as protobuf, and emits one JSON object per daily Summary record.
#
# Schema FACTS (field ids, scales, subfield layout) are cited from m-kozlowski/airbreak-plus
# docs/as11/rpc_spools.md, "Summary records". The implementation is Tepna's own. Summary records are
# plain nested protobuf: the Rice / second-difference coding in that document belongs to RC03
# archived signals (WU8), not to Summary.
#
# §∅: every documented field is present in the output, `null` when the record does not carry it.
# Nothing is defaulted. A field the schema does not name is never dropped silently: it is counted in
# `unknown` with its byte length, and the round's `unknown_bytes` total is the decode-correctness
# signal (WU1 done-when: zero unknown-field bytes left over).
#
# The walker is strict: a length that runs past the buffer raises TruncatedRound rather than yielding
# a short slice. It mirrors `polar_psftp._iter_fields(strict=True)`; that module imports bleak at load,
# and a rig-side decoder must not need a BLE stack, so the ~25 lines are restated here.
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any


class TruncatedRound(ValueError):
    """A field declared more bytes than the round holds. Raised, never decoded as a short value."""


def _varint(buf: bytes, i: int) -> tuple[int, int]:
    shift = val = 0
    while True:
        if i >= len(buf):
            raise TruncatedRound(f"varint runs off the end at byte {i} of {len(buf)}")
        b = buf[i]
        i += 1
        val |= (b & 0x7F) << shift
        if not b & 0x80:
            return val, i
        shift += 7
        if shift > 63:
            raise TruncatedRound(f"varint longer than 10 bytes at byte {i}")


def walk(buf: bytes):
    """Yield `(field, wire_type, value, n_bytes)` for one message level. `n_bytes` is the whole
    field's span, tag included, so a caller can account for every byte it does not interpret."""
    i, n = 0, len(buf)
    while i < n:
        start = i
        v: Any  # int for wire types 0/1/5, bytes for 2
        tag, i = _varint(buf, i)
        fn, wt = tag >> 3, tag & 7
        if wt == 0:
            v, i = _varint(buf, i)
        elif wt in (1, 5):
            ln = 8 if wt == 1 else 4
            if i + ln > n:
                raise TruncatedRound(f"field {fn} declares {ln} bytes, {n - i} remain")
            v, i = int.from_bytes(buf[i : i + ln], "little"), i + ln
        elif wt == 2:
            ln, i = _varint(buf, i)
            if i + ln > n:
                raise TruncatedRound(f"field {fn} declares {ln} bytes, {n - i} remain")
            v, i = bytes(buf[i : i + ln]), i + ln
        else:
            raise TruncatedRound(f"wire type {wt} (field {fn}) at byte {start} is not one Summary uses")
        yield fn, wt, v, i - start


def _int64(v: int) -> int:
    """A protobuf int32/int64 varint is two's complement over 64 bits."""
    return v - (1 << 64) if v >= 1 << 63 else v


def _zigzag(v: int) -> int:
    return (v >> 1) ^ -(v & 1)


# ── schema (rpc_spools.md "Summary records") ──
# Direct scalars: field -> (name, divisor). Divisor None = an integer kept as served.
_SCALARS = {
    1: ("init_marker", None),
    2: ("period_start_ms", None),
    3: ("period_end_ms", None),
    5: ("duration_min", None),
    7: ("ahi", 100),
    8: ("apnea_index", 100),
    9: ("hypopnea_index", 100),
    10: ("obstructive_apnea_index", 100),
    11: ("central_apnea_index", 100),
    12: ("unknown_apnea_index", 100),
    13: ("rera_index", 100),
    16: ("csr", None),
    17: ("spo2_thresh_min", None),
    18: ("spont_trigger_pct", 100),
    19: ("spont_cycle_pct", 100),
    34: ("humidifier_connected", None),
    35: ("tube_connected", None),
    39: ("session_count", None),
    40: ("record_timestamp_ms", None),
    # SmdSmtTimestamp. The document calls it an SMD/SMT date/time pair; firmware 17.8.6.0 serves ONE
    # varint, UTC ms (measured 2026-10-17: 1785354106968 in all 16 records of every round).
    43: ("smd_smt_timestamp_ms", None),
}
_TZ_FIELD = 4  # TimeZoneOffsetMin, sint (zigzag): EDT serves 479 -> -240
_SESSIONS_FIELD = 6

_P3 = {2: "p50", 3: "p95", 4: "p100"}
_P1 = {2: "p50"}
_P5_95 = {1: "p5", 3: "p95"}
# Percentile subrecords: field -> (name, subfield map, divisor).
_METRICS = {
    14: ("leak_lps", {2: "p50", 3: "p70", 4: "p95", 5: "p100"}, 100),
    15: ("inspiratory_pressure_cmh2o", _P3, 100),
    20: ("expiratory_pressure_cmh2o", _P3, 100),
    21: ("mean_mask_pressure_cmh2o", _P3, 100),
    22: ("tidal_volume_l", _P3, 100),
    23: ("minute_ventilation_lpm", _P3, 100),
    24: ("target_minute_ventilation_lpm", _P3, 100),
    25: ("respiratory_rate_bpm", _P3, 100),
    26: ("inspiratory_duration_s", _P3, 1000),
    27: ("ie_ratio_pct", _P3, 100),
    28: ("spo2_pct", _P3, 100),
    29: ("ambient_humidity_mgl", _P1, 100),
    30: ("humidifier_temperature_c", _P1, 100),
    31: ("heated_tube_temperature_c", _P1, 100),
    32: ("humidifier_power_pct", _P1, 100),
    33: ("heated_tube_power_pct", _P1, 100),
    36: ("blower_pressure_cmh2o", _P5_95, 100),
    37: ("respiratory_flow_lps", _P5_95, 100),
    38: ("blower_flow_lps", _P1, 100),
    41: ("heart_rate_bpm", _P3, 100),
    42: ("alveolar_minute_ventilation_lpm", _P3, 100),
}

FIELD_NAMES = [n for n, _ in _SCALARS.values()] + ["tz_offset_min", "sessions"] + [n for n, _, _ in _METRICS.values()]


def _scale(v: int, div):
    v = _int64(v)
    return v if div is None else v / div


def _unknown(out: list, path: str, fn: int, wt: int, nb: int) -> None:
    out.append({"field": f"{path}{fn}", "wire": wt, "bytes": nb})


def _metric(body: bytes, sub: dict, div, path: str, unknown: list) -> dict:
    m = {name: None for name in sub.values()}
    for fn, wt, v, nb in walk(body):
        if fn in sub and wt == 0:
            m[sub[fn]] = _scale(v, div)
        else:
            _unknown(unknown, path, fn, wt, nb)
    return m


def decode_record(body: bytes) -> dict:
    """One Summary record -> a flat dict over FIELD_NAMES plus `unknown` (fields the schema does not
    name, with byte counts). A repeated scalar keeps its LAST value and the earlier one is reported
    unknown, so a duplicate can never pass as a clean decode."""
    rec: dict = {name: None for name in FIELD_NAMES}
    unknown: list = []
    seen: set = set()
    for fn, wt, v, nb in walk(body):
        if fn == _SESSIONS_FIELD and wt == 2:
            rec["sessions"] = rec["sessions"] or []
            for sfn, swt, sv, snb in walk(v):
                if sfn != 1 or swt != 2:
                    _unknown(unknown, "6.", sfn, swt, snb)
                    continue
                s: dict[str, int | None] = {"start_ms": None, "duration_min": None}
                for efn, ewt, ev, enb in walk(sv):
                    if efn == 1 and ewt == 0:
                        s["start_ms"] = _int64(ev)
                    elif efn == 2 and ewt == 0:
                        s["duration_min"] = _int64(ev)
                    else:
                        _unknown(unknown, "6.1.", efn, ewt, enb)
                rec["sessions"].append(s)
            continue
        if fn in seen:
            _unknown(unknown, "dup.", fn, wt, nb)
        seen.add(fn)
        if fn in _SCALARS and wt == 0:
            name, div = _SCALARS[fn]
            rec[name] = _scale(v, div)
        elif fn == _TZ_FIELD and wt == 0:
            rec["tz_offset_min"] = _zigzag(v)
        elif fn in _METRICS and wt == 2:
            name, sub, div = _METRICS[fn]
            rec[name] = _metric(v, sub, div, f"{fn}.", unknown)
        else:
            _unknown(unknown, "", fn, wt, nb)
    rec["unknown"] = unknown
    return rec


def decode_round(raw: bytes) -> dict:
    """A committed round: repeated outer field 2, one Summary record each."""
    records: list[dict] = []
    unknown: list[dict] = []
    for fn, wt, v, nb in walk(raw):
        if fn == 2 and wt == 2:
            records.append(decode_record(v))
        else:
            _unknown(unknown, "outer.", fn, wt, nb)
    unknown_bytes = sum(u["bytes"] for u in unknown) + sum(u["bytes"] for r in records for u in r["unknown"])
    return {"records": records, "unknown": unknown, "unknown_bytes": unknown_bytes}


def local_day(rec: dict) -> str | None:
    """The therapy day a record belongs to: PeriodStart in the record's own local offset. A bucket
    that starts at local noon belongs to the calendar date of that noon."""
    if rec["period_start_ms"] is None or rec["tz_offset_min"] is None:
        return None
    t = datetime.fromtimestamp(rec["period_start_ms"] / 1000, timezone.utc) + timedelta(minutes=rec["tz_offset_min"])
    return t.date().isoformat()


def iter_committed(root: str):
    """`(ledger_row, path)` for each committed round, in ledger order. A row whose file is missing is
    yielded with `path=None` so the caller reports it instead of skipping it."""
    with open(os.path.join(root, "cpap_spool_ledger.jsonl"), encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            p = os.path.join(root, "committed", row["file"])
            yield row, (p if os.path.exists(p) else None)


def _physical(sig) -> list[float]:
    span = int(sig.dmax) - int(sig.dmin)
    f = (float(sig.pmax) - float(sig.pmin)) / span
    return [float(sig.pmin) + (d - int(sig.dmin)) * f for d in sig.samples]


def str_days(raw: bytes) -> dict:
    """The SD card's STR.edf as `{day: {"duration_min", "sessions": [(on_min, off_min), ...]}}`.

    One data record per therapy day. `Date` is days since 1970-01-01; `MaskOn`/`MaskOff` are minutes
    after that day's local noon, `-1` for an unused slot; `Duration` is minutes. This is the ground
    truth independent of the BLE query, which is what lets a quiet device be told from a query that
    cannot see it."""
    import cpap_edf

    edf = cpap_edf.read_edf(raw)
    sig = {s.label.strip(): s for s in edf.signals}
    dates, dur = _physical(sig["Date"]), _physical(sig["Duration"])
    on, off = _physical(sig["MaskOn"]), _physical(sig["MaskOff"])
    spr = int(sig["MaskOn"].spr)
    days = {}
    for r, dn in enumerate(dates):
        pairs = [(int(a), int(b)) for a, b in zip(on[r * spr : (r + 1) * spr], off[r * spr : (r + 1) * spr]) if a >= 0]
        day = (datetime(1970, 1, 1) + timedelta(days=int(dn))).date().isoformat()
        days[day] = {"duration_min": int(dur[r]), "sessions": pairs}
    return days


def _spool_sessions(rec: dict) -> list[tuple[int, int]]:
    """Summary sessions as `(on_min, off_min)` after the bucket's start — STR's own coordinates."""
    out = []
    for s in rec["sessions"] or []:
        if s["start_ms"] is None or s["duration_min"] is None:
            continue
        on = round((s["start_ms"] - rec["period_start_ms"]) / 60000)
        out.append((on, on + s["duration_min"]))
    return out


def compare_str(records: dict, days: dict) -> list[dict]:
    """One row per day the spool and the card share: duration and every session, to the minute."""
    rows = []
    for day in sorted(set(records) & set(days)):
        rec, sd = records[day], days[day]
        sp = _spool_sessions(rec)
        rows.append(
            {
                "day": day,
                "spool_min": rec["duration_min"],
                "str_min": sd["duration_min"],
                "spool_sessions": sp,
                "str_sessions": sd["sessions"],
                "match": rec["duration_min"] == sd["duration_min"] and sp == sd["sessions"],
            }
        )
    return rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Decode committed AS11 Summary spool rounds to JSON lines.")
    ap.add_argument("root", help="the spool store root (holds cpap_spool_ledger.jsonl and committed/)")
    ap.add_argument("--str", dest="str_path", help="SD-card STR.edf: compare usage per day, to the minute")
    a = ap.parse_args(argv)
    bad = 0
    latest: dict = {}  # day -> record from the LAST round that served it (ledger order)
    for row, path in iter_committed(a.root):
        if row.get("spool_type") != "Summary":
            continue
        if path is None:
            print(json.dumps({"file": row["file"], "error": "missing"}))
            bad += 1
            continue
        raw = open(path, "rb").read()
        try:
            r = decode_round(raw)
        except TruncatedRound as e:
            print(json.dumps({"file": row["file"], "error": f"truncated: {e}"}))
            bad += 1
            continue
        bad += r["unknown_bytes"] > 0
        for rec in r["records"]:
            day = local_day(rec)
            latest[day] = rec
            print(json.dumps({"file": row["file"], "day": day, **rec}, sort_keys=True))
        print(
            json.dumps(
                {
                    "file": row["file"],
                    "bytes": len(raw),
                    "records": len(r["records"]),
                    "unknown_bytes": r["unknown_bytes"],
                    "outer_unknown": r["unknown"],
                }
            )
        )
    if a.str_path:
        rows = compare_str(latest, str_days(open(a.str_path, "rb").read()))
        for c in rows:
            print(json.dumps({"compare": c}))
        miss = sum(not c["match"] for c in rows)
        print(json.dumps({"compare_days": len(rows), "mismatched_days": miss}))
        bad += miss
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

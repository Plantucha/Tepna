# tepna-capture — probe_oxyii_0x03.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Measure the cmd=0x03 LIVE_SAMPLES_A record rate on a WORN ring, to settle
# O2RING-RAW-DUAL-WAVELENGTH-FOLLOWUPS §7.4 — is channel A 112.9 Hz, or the 125.000 Hz the ADC
# nominally runs at? A 10 % difference, so a few minutes separates them statistically.
#
# WHY A PROBE AND NOT AN ANALYSIS. When the question was asked, the answer could not be read off bytes
# already on disk, and the reason was structural: **0x03 was never captured.** `capture.py` polled 0x04
# (vitals) and 0x05 (ppg2w) only, so no `*_PPG2W.txt`, no OXYFRAME row and no stored `.dat` held a
# single 0x03 record, and a worn session was the only source. That is what this probe was built for,
# and it is the instrument the §7.4 answer came off.
#
# ⚠️ THAT PARAGRAPH IS NOW HISTORY, and the correction is the point of writing it down: **#2282 wired
# 0x03 into the daemon** as the opt-in `pletha` stream, so a new night CAN carry 0x03 — but only where
# the ring's `streams:` names `pletha`, which is off unless the owner enabled it, and no recording made
# before #2282 has a byte of it either way. So the probe stays the instrument for a fresh measurement
# on a ring whose config does not carry the stream, and for any question the writer's own decoding
# would beg. Check `config.yaml` before assuming a night answers you.
#
# ⚠️ THE TRAP THIS PROBE EXISTS TO AVOID, and it has already cost this project months on the sibling
# opcode: **if the device fills its buffer faster than the host drains it, every reply pins at the cap
# and the "rate" you compute is `cap ÷ poll period` — a property of the POLLING, not the device.** On
# 0x05 that made the rate read ~100 Hz until #1596, with 282 402 of 284 420 buffers pinned at the
# 102-record cap across 39 files. Here the cap is 250 records, so:
#   * poll fast (default 5 Hz) so counts sit well under the cap;
#   * log the declared count for EVERY reply;
#   * compute the rate over UNSATURATED replies only, and report the saturated fraction beside it.
# A run with any saturated replies is a run whose rate is suspect, and this probe says so out loud
# rather than printing a confident number.
#
# READ-ONLY. 0x03 is a read; nothing here writes device state, and nothing goes near the gated
# 0xE3/0xEE resets. The ring must be WORN — an unworn ring reports no optical records.
#
#   The O2Ring holds ONE BLE link, so the capture daemon must not hold it. Use the DEADMAN-TIMED
#   helper, never a bare `systemctl stop` — the helper restarts the daemon on its own timer, so a
#   probe run that dies, hangs or loses its terminal cannot leave the box not recording overnight:
#     sudo -n /usr/local/lib/tepna/tepna-restart.sh stop 20     # minutes; auto-restart after
#     python probe_oxyii_0x03.py --seconds 600
#     sudo -n /usr/local/lib/tepna/tepna-restart.sh restart     # or just let the deadman timer fire
from __future__ import annotations

import argparse
import asyncio
import json
import struct
import time

from bleak import BleakClient, BleakScanner

import oxy_presence
import oxyii

OP_SAMPLES_A = 0x03
#: Same shape as RT_PPG_ARG — the 0x05 sibling takes (0x07, 0x01); 0x03 is documented as taking the
#: same two-byte "give me the buffer" argument. If the ring answers empty for every poll, try `--arg`
#: before concluding the opcode is unsupported: an empty reply and a wrong argument look identical.
SAMPLES_A_ARG = bytes([0x07, 0x01])
REC_CAP = 250                        # §4: u16 count at [4:6], capped at 250 records per reply
HDR = 6                              # 6-byte header before the 8-bit sample body
#: The inserted beat marker. On 0x04 §7.3 MEASURED it as exactly ONE ROW PER BEAT (ratio 0.986-0.996
#: over 7 worn sessions, modal gap = 125 x 60/PR + 1), and the same value appears on 0x03 (372
#: occurrences, "100 % isolated"). It is a MARKER, not a sample: counting it as one inflates the rate,
#: which is precisely how 0x05's row rate read 126.06 against a 125.000 ADC.
BEAT_MARKER = 156


def parse_counts(payload: bytes) -> tuple[int | None, int]:
    """`(declared_record_count, body_len)` for one 0x03 reply. Declared count is the u16 LE at [4:6].

    Returns `None` for the count when the payload is too short to carry the header — which is a
    DIFFERENT fact from a reply declaring zero records, and the caller must not merge them."""
    if len(payload) < HDR:
        return None, max(0, len(payload) - HDR)
    return struct.unpack_from("<H", payload, 4)[0], len(payload) - HDR


def marker_stats(body: bytes, marker: int = BEAT_MARKER) -> tuple[int, int]:
    """`(marker_count, isolated_count)` in one reply body. ISOLATED means neither neighbour is also the
    marker value — the property §2/§7.3 rely on to tell an inserted row from a sample that merely
    happens to equal 156. A run of markers is NOT a beat, and merging the two counts would reproduce
    the error those sections exist to document. Reply boundaries are edges: a marker at position 0 or
    -1 is judged on the neighbour it has, because the alternative is dropping real markers."""
    n = iso = 0
    for i, v in enumerate(body):
        if v != marker:
            continue
        n += 1
        prev_ok = i == 0 or body[i - 1] != marker
        next_ok = i == len(body) - 1 or body[i + 1] != marker
        if prev_ok and next_ok:
            iso += 1
    return n, iso


def summarise(samples: list[dict], cap: int = REC_CAP) -> dict:
    """PURE: turn the per-reply log into the two rates §7.4 asks for, plus the saturation evidence.

    `rate_all` uses every reply with records; `rate_unsat` excludes any reply that pinned at the cap
    AND the interval that follows it, because a saturated reply tells you the buffer was full at some
    unknown earlier moment — its records did not all arrive in that interval. Both are reported: if
    they disagree, the saturated ones are the reason, and that disagreement is the finding."""
    with_recs = [s for s in samples if (s["count"] or 0) > 0]
    sat = [s for s in with_recs if s["count"] >= cap]
    out = {
        "replies": len(samples),
        "replies_with_records": len(with_recs),
        "saturated_replies": len(sat),
        "saturated_fraction": round(len(sat) / len(with_recs), 4) if with_recs else None,
        "cap": cap,
        "total_records": sum(s["count"] or 0 for s in with_recs),
        "rate_all_hz": None,
        "rate_unsaturated_hz": None,
        "span_s": None,
    }
    span = 0.0
    if len(with_recs) >= 2:
        span = with_recs[-1]["t"] - with_recs[0]["t"]
        out["span_s"] = round(span, 3)
        # The first reply's records were buffered BEFORE the window opened, so they are not part of
        # what arrived during it — counting them inflates the rate on short runs.
        if span > 0:
            out["rate_all_hz"] = round(sum(s["count"] for s in with_recs[1:]) / span, 3)
    # Unsaturated: keep consecutive pairs where NEITHER end saturated, and sum records over those
    # intervals only. This is stricter than dropping saturated replies, because the interval AFTER a
    # saturated reply is also untrustworthy.
    num = den = 0.0
    for a, b in zip(with_recs, with_recs[1:]):
        if a["count"] >= cap or b["count"] >= cap:
            continue
        num += b["count"]
        den += b["t"] - a["t"]
    if den > 0:
        out["rate_unsaturated_hz"] = round(num / den, 3)
        out["unsaturated_span_s"] = round(den, 3)
    # MARKER-CORRECTED rate: rows minus inserted markers, the comparison §2 used to recover the
    # 125.000 ADC from 0x05's 126.06 row rate. Reported SEPARATELY from the row rate, never instead
    # of it — which of the two is "the sample rate" is the question, so collapsing them answers it by
    # assumption.
    out["markers_total"] = sum(s.get("markers") or 0 for s in with_recs)
    out["markers_isolated"] = sum(s.get("isolated") or 0 for s in with_recs)
    # Gated on the ROW RATE rather than on the span, because they have exactly the same precondition
    # (a positive span over >=2 record-bearing replies) and testing the span twice invites the two to
    # drift apart — the second test then guards a case the first has already made impossible.
    if out["rate_all_hz"] is not None:
        mk = sum(s.get("markers") or 0 for s in with_recs[1:])
        out["marker_rate_hz"] = round(mk / span, 3)
        out["rate_minus_markers_hz"] = round(out["rate_all_hz"] - mk / span, 3)
    return out


def verdict(s: dict) -> list[str]:
    """State what the numbers support, INCLUDING when they support nothing. §7.4 is a choice between
    112.9 and 125.000, so the honest outcomes are 'one of them', 'neither', and 'cannot tell'."""
    r = s.get("rate_unsaturated_hz")
    if s["replies_with_records"] == 0:
        return ["VERDICT: the ring returned NO 0x03 records — worn? correct argument? See --arg.",
                "  An empty reply and a wrong request argument are indistinguishable here."]
    if r is None:
        return ["VERDICT: no unsaturated interval — every usable pair had a reply at the cap.",
                f"  {s['saturated_replies']}/{s['replies_with_records']} replies pinned at {s['cap']}."
                "  Poll faster (--hz) and re-run; this run measures the POLLING, not the device."]
    lines = [f"VERDICT: unsaturated rate {r} Hz over {s.get('unsaturated_span_s')} s"]
    if s["saturated_fraction"]:
        lines.append(f"  ⚠ {s['saturated_replies']}/{s['replies_with_records']} replies "
                     f"({s['saturated_fraction']:.1%}) hit the {s['cap']}-record cap — see the warning "
                     "in this file's header; a high fraction makes even the unsaturated rate suspect.")
    for name, hz in (("112.9", 112.9), ("125.000", 125.0)):
        if abs(r - hz) / hz <= 0.02:
            lines.append(f"  → consistent with {name} Hz (within 2 %)")
    if all(abs(r - hz) / hz > 0.02 for hz in (112.9, 125.0)):
        lines.append("  → consistent with NEITHER candidate — a third answer, not a tie-break")
    return lines


async def run(address: str, seconds: float, hz: float, arg_hex: str | None) -> dict:
    arg = bytes.fromhex(arg_hex) if arg_hex else SAMPLES_A_ARG
    # ADDRESS-ONLY (standing ruling): a name filter would connect to a stranger's ring as readily.
    dev = await BleakScanner.find_device_by_filter(
        lambda d, adv: oxy_presence.is_expected_ring(d.address, address), timeout=25)
    if dev is None:
        raise SystemExit("ring not advertising — wear it (finger in), app closed, daemon stopped.")

    reasm = oxyii.Reassembler()
    samples: list[dict] = []
    beats: list[dict] = []
    got: asyncio.Queue = asyncio.Queue()

    def on_notify(_h, data) -> None:
        # feed() yields whole FRAMES; decode() is the validator that splits one into (op, payload)
        # and returns None on a bad header/CRC (capture.py:3995). Timestamp at arrival, not after
        # decode, so a slow decode cannot smear the interval the rate is computed from.
        t = time.monotonic()
        for frame in reasm.feed(bytes(data)):
            r = oxyii.decode(frame)
            if r:
                got.put_nowait((t, r[0], r[1]))

    async with BleakClient(dev, timeout=30) as cl:
        # Resolve the two characteristics the way capture.py does (capture.py:3908-3913) — by UUID
        # over the discovered services, not by a hardcoded handle.
        wch = nch = None
        for svc in getattr(cl, "services", []) or []:
            for ch in svc.characteristics:
                u = ch.uuid.lower()
                if u == oxyii.OXYII_WRITE.lower(): wch = ch
                if u == oxyii.OXYII_NOTIFY.lower(): nch = ch
        if wch is None or nch is None:
            raise SystemExit("ring GATT does not expose the OxyII write/notify pair")
        await cl.start_notify(nch, on_notify)
        await cl.write_gatt_char(wch, oxyii.auth_frame(), response=False)
        await asyncio.sleep(0.4)
        await cl.write_gatt_char(wch, oxyii.setup_frame(), response=False)
        await asyncio.sleep(0.4)
        period = 1.0 / hz
        end = time.monotonic() + seconds
        n = 0
        while time.monotonic() < end:
            await cl.write_gatt_char(wch, oxyii.encode(OP_SAMPLES_A, arg, n & 0xFF), response=False)
            n += 1
            # Poll 0x04 once a second alongside, for §2.1's marker-vs-beat ratio — same session, so
            # the two are directly comparable rather than being stitched from separate runs.
            if n % max(1, int(hz)) == 0:
                await cl.write_gatt_char(wch, oxyii.live_frame(), response=False)
            await asyncio.sleep(period)
            while not got.empty():
                t, op, payload = got.get_nowait()
                if op == OP_SAMPLES_A:
                    cnt, blen = parse_counts(payload)
                    body = payload[HDR:HDR + (cnt or 0)]
                    mk, iso = marker_stats(body)
                    samples.append({"t": t, "count": cnt, "body_len": blen,
                                    "payload_len": len(payload), "markers": mk, "isolated": iso,
                                    # Kept so the LAYOUT itself stays checkable after the fact rather
                                    # than only the numbers derived from it.
                                    "body_hex": body.hex()})
                elif op == oxyii.OP_LIVE:
                    live = oxyii.parse_live(payload)
                    if live:
                        beats.append({"t": t, "pr": live.get("pr"), "spo2": live.get("spo2")})
        await cl.stop_notify(nch)

    s = summarise(samples)
    s["beats_polled"] = len(beats)
    prs = [b["pr"] for b in beats if b.get("pr")]
    s["reported_pr_mean"] = round(sum(prs) / len(prs), 1) if prs else None
    if s.get("rate_unsaturated_hz") and prs:
        # §2.1: markers per beat. Reported PR is beats/min; records are per second.
        s["records_per_beat"] = round(s["rate_unsaturated_hz"] * 60.0 / (sum(prs) / len(prs)), 3)
    return {"summary": s, "samples": samples, "beats": beats}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Measure the 0x03 LIVE_SAMPLES_A record rate (worn ring).")
    ap.add_argument("--address", default="D1:98:62:7C:92:B3")
    ap.add_argument("--seconds", type=float, default=600.0, help="≥600 recommended (§7.4)")
    ap.add_argument("--hz", type=float, default=5.0, help="poll rate; higher = less saturation risk")
    ap.add_argument("--arg", default=None, help="request-argument hex override, e.g. 0701")
    ap.add_argument("--json", default=None, help="write the full per-reply log here")
    a = ap.parse_args(argv)
    res = asyncio.run(run(a.address, a.seconds, a.hz, a.arg))
    for line in verdict(res["summary"]):
        print(line)
    print()
    for k, v in res["summary"].items():
        print(f"  {k:24} {v}")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(res, fh, indent=1)
        print(f"\nper-reply log → {a.json}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

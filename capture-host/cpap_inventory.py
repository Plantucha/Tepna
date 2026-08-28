# tepna-capture — cpap_inventory.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE CPAP SPOOL AS AN INVENTORY ORACLE — what did we MISS?
#
# Owner-ratified 2026-08-28. Every other CPAP surface answers "what did we get". None of them can
# answer "what was there", because a night we never captured leaves nothing behind to count. The
# Summary spool can: the device keeps its own session list, so it knows a session EXISTED even when we
# captured nothing at all.
#
# ⚠️ SUMMARY IS THE ONLY SPOOL WE HAVE, AND THAT IS STRUCTURAL. Detail returns -32602 at every
# parameter shape tried over AS11 BLE; it is not a tuning problem and nothing here may be designed
# against it. Whatever Summary cannot say, we do not know.
#
# WHAT THIS MODULE IS. Pure reconciliation of three inventories, with NO transport, NO async, NO BLE
# and NO polling — modelled on cpap_acq.py, which is the house template for exactly this shape. It
# consumes what other modules already produce and returns records; it writes nothing and calls nothing.
#
#   spool     — sessions the DEVICE lists            (cpap_spool / acq_evidence_cpap.assemble_spool)
#   envelopes — sessions WE captured live            (acq_evidence_cpap.assemble_live)
#   card      — nights present on the SD card        (cpap_harvest, DATALOG/<YYYYMMDD>/)
#
# 🔴 THE STATES ARE ENUMERATED, NOT COLLAPSED, because they have OPPOSITE remedies. "A session is
# missing from somewhere" is not an actionable sentence: missing from the envelopes means the live
# capture did not run, missing from the card means harvest is behind or the card rotated, and missing
# from the spool means our own record describes a session the device does not list — which is the one
# that impugns US rather than the acquisition. Folding them into a count would produce a number that
# cannot be acted on, which is this repo's most frequent defect wearing a new hat.
#
# ⚠️ THE JOIN KEY IS THE NIGHT, AND THAT IS A DELIBERATE LOSS. Spool sessions carry start times, the
# card is foldered per night, and envelopes carry an acquisition start. Only the night is common to all
# three, so a night containing TWO sessions reconciles as one unit and a session crossing midnight is
# attributed to its start night. Both are stated here rather than discovered later: this oracle answers
# "was this night accounted for", not "was this session accounted for", and a per-session join needs a
# device-side session id that Summary does not expose.

from __future__ import annotations

import re

# 🔴 PRESENCE IS EVIDENCE; ABSENCE IS EVIDENCE ONLY FROM A SOURCE THAT WAS ACTUALLY CONSULTED.
# This asymmetry is the module's spine, and it was nearly missed. Vigil box, 2026-08-28: the spool is a
# ONCE-DAILY Summary-only transaction, so on a therapy-end trigger an empty spool result is the EXPECTED
# case on the second and later sessions of a day — nothing new to fetch. A reconciliation that read that
# emptiness as "the device lists no sessions" would mark every night of every evening SPOOL-SILENT and
# manufacture a discrepancy per night, forever.
#
# ⚠️ THE CARD'S CONSULTED FLAG COMES FROM THE HARVEST, NOT FROM ITS OUTCOME — and my first reading of it
# was wrong. I had `barren` (the walk found nothing) as card_consulted=False. It is TRUE: the walk RAN
# and the card held nothing, which is a real absence and therefore evidence. The unread case is the
# harvest's two EARLY EXITS — Wi-Fi never came up, or the listing THREW, the latter being the exit an
# absent card takes. Vigil box's transport now reports `consulted` explicitly for exactly this reason,
# so this module reads that flag and never infers it from `state`. Inferring it was a second-order
# version of the same error: deriving "was the instrument pointed at the subject" from what the
# instrument returned.
#
# So each inventory arrives with a CONSULTED flag. An unconsulted source contributes its presences and
# NONE of its absences, and a night whose classification would have rested on an unconsulted absence is
# reported as NOT-DIAGNOSABLE rather than as a finding. A discrepancy invented from a source nobody read
# is worse than no reconciliation at all: it is a false alarm wearing an oracle's authority.

# The seven states a night can be in, keyed (spool, envelope, card) as booleans. Each names what to DO,
# because a diagnosis nobody can act on is a count with extra words.
STATES = {
    (True, False, False): (
        "MISSED-BOTH",
        "the device lists this session and we have neither a live capture nor a card night — "
        "it happened, and nothing of ours recorded it",
    ),
    (True, False, True): (
        "MISSED-LIVE",
        "on the device list and on the card, but no live envelope — the live capture did not run; "
        "the data is recoverable by harvest, the realtime waveform is not",
    ),
    (True, True, False): (
        "NOT-ON-CARD",
        "captured live and listed by the device, but no DATALOG night — harvest is behind, or the "
        "card has rotated it away",
    ),
    (False, True, True): (
        "SPOOL-SILENT",
        "captured and harvested, but the device list does not mention it — a spool window or "
        "pagination gap; our data is fine and our INVENTORY is not",
    ),
    (False, False, True): (
        "UNSPOOLED-CARD-NIGHT",
        "a card night the device list does not cover and we never captured live — outside the "
        "spool's window, so its absence from the list is not evidence of anything",
    ),
    (False, True, False): (
        "ENVELOPE-ONLY",
        "we hold a live envelope for a night neither the device nor the card knows — this impugns "
        "OUR record, not the acquisition: a clock mismatch, or an envelope for a session that "
        "produced nothing",
    ),
    (True, True, True): ("COMPLETE", "accounted for in all three inventories"),
}

NOT_DIAGNOSABLE = (
    "NOT-DIAGNOSABLE",
    "this night's classification would rest on the ABSENCE of a source that was not consulted "
    "on this run — reported as unknown rather than as a finding",
)

# The QC-SUMMARY field this oracle owns, and the journal event name for one discrepancy.
QC_FIELD = "cpap_inventory"
JOURNAL_EVENT = "cpap-inventory-discrepancy"


def night_key(value: str) -> str | None:
    """`YYYYMMDD` from a night folder, an ISO stamp, or a compact stamp. Returns None when the input
    carries no resolvable date — a key we cannot form is NOT a night we can reconcile, and guessing one
    would attribute a real session to the wrong day. (Clock Contract §2.6: a missing value is null.)"""
    # ⚠️ SCAN THE DIGIT RUNS; DO NOT CONCATENATE THEM — and then, only if that finds nothing, strip
    # DATE SEPARATORS and scan again. Two passes because the two real input shapes fail each other's
    # single-pass version, and my first fix traded one for the other:
    #
    #   `AS11_20260827_BRP.edf.meta.json`  — concatenating every digit yields "1120260827", whose
    #                                        leading eight are "11202608": year 1120, rejected, night
    #                                        LOST. The protocol name is part of the filename, so this
    #                                        is the ordinary input, not an exotic one.
    #   `2026-08-27T22:14:05`              — has NO eight-digit run at all; scanning runs alone
    #                                        returns None and loses every ISO stamp. My first fix did
    #                                        exactly this, and the existing test caught it.
    #
    # Pass 2 removes only `- : T` and space — never `_` — so an `AS11_`-style prefix stays a separate
    # run and cannot merge into the date. Both cases are planted in the tests, as a pair, because each
    # one alone is satisfied by a version that breaks the other.
    for candidate in (str(value), re.sub(r"[-:T ]", "", str(value))):
        for run in re.finditer(r"\d+", candidate):
            digits = run.group(0)
            for i in range(len(digits) - 7):
                ymd = digits[i:i + 8]
                y, m, d = int(ymd[:4]), int(ymd[4:6]), int(ymd[6:8])
                if 2000 <= y <= 2100 and 1 <= m <= 12 and 1 <= d <= 31:
                    return ymd
    return None


def _keys(values) -> tuple[set[str], list[str]]:
    """(resolvable night keys, the inputs that produced none). The rejects are RETURNED rather than
    dropped: an unparseable entry is a fact about the source, and silently discarding it would shrink
    an inventory without saying so — which is how a reconciliation reports agreement it never had."""
    good: set[str] = set()
    bad: list[str] = []
    for v in values or []:
        k = night_key(v)
        if k is None:
            bad.append(str(v))
        else:
            good.add(k)
    return good, bad


def reconcile(*, spool=None, envelopes=None, card=None,
              spool_consulted=True, envelopes_consulted=True, card_consulted=True) -> dict:
    """Three inventories in, discrepancy records out. PURE.

    🔴 ALL THREE EMPTY IS A REFUSAL, NOT A CLEAN BILL. "No discrepancies" and "no data" produce the
    same empty list and mean opposite things: the first says every night is accounted for, the second
    says nothing was examined. A caller that cannot tell them apart will eventually report a green
    inventory for a device it never reached — the exact shape this module exists to expose, committed
    by the module exposing it. So emptiness is `ok: False`, and it is checked before anything else.
    """
    s_keys, s_bad = _keys(spool)
    e_keys, e_bad = _keys(envelopes)
    c_keys, c_bad = _keys(card)

    if not (s_keys or e_keys or c_keys):
        return {
            "ok": False,
            "reason": "all three inventories are empty — that is no data, not no discrepancies",
            "records": [],
            "unparseable": s_bad + e_bad + c_bad,
            "counts": {"spool": 0, "envelopes": 0, "card": 0},
        }

    consulted = (bool(spool_consulted), bool(envelopes_consulted), bool(card_consulted))
    records = []
    for k in sorted(s_keys | e_keys | c_keys):
        sig = (k in s_keys, k in e_keys, k in c_keys)
        # An ABSENCE from an unconsulted source is not evidence of anything. If any of this night's
        # three answers is such an absence, the night is not diagnosable — never silently classified
        # as though the unread source had reported empty.
        if any((not present) and (not was_consulted) for present, was_consulted in zip(sig, consulted)):
            state, why = NOT_DIAGNOSABLE
            records.append(
                {
                    "night": k,
                    "state": state,
                    "detail": why,
                    "in_spool": sig[0],
                    "in_envelope": sig[1],
                    "on_card": sig[2],
                    "unconsulted": [n for n, c in zip(("spool", "envelopes", "card"), consulted) if not c],
                }
            )
            continue
        state, why = STATES[sig]
        if state == "COMPLETE":
            continue
        records.append(
            {
                "night": k,
                "state": state,
                "detail": why,
                "in_spool": sig[0],
                "in_envelope": sig[1],
                "on_card": sig[2],
            }
        )

    return {
        "ok": True,
        "records": records,
        "complete": sorted(s_keys & e_keys & c_keys),
        "unparseable": s_bad + e_bad + c_bad,
        "counts": {"spool": len(s_keys), "envelopes": len(e_keys), "card": len(c_keys)},
        "consulted": {"spool": consulted[0], "envelopes": consulted[1], "card": consulted[2]},
    }


def qc_field(result: dict) -> dict:
    """The QC-SUMMARY payload. A refusal is carried THROUGH rather than rendered as zero discrepancies:
    the field says `ok: false` and why, so a reader of QC-SUMMARY sees the same distinction the caller
    saw. Rendering it as `{"discrepancies": 0}` would launder a no-data run into a clean one at exactly
    the boundary where the evidence stops."""
    if not result.get("ok"):
        return {"ok": False, "reason": result.get("reason", "unknown"), "discrepancies": None}
    by_state: dict[str, int] = {}
    for r in result["records"]:
        by_state[r["state"]] = by_state.get(r["state"], 0) + 1
    return {
        "ok": True,
        "discrepancies": len(result["records"]),
        "by_state": by_state,
        "complete_nights": len(result.get("complete", [])),
        "counts": result.get("counts", {}),
        "unparseable": len(result.get("unparseable", [])),
    }


def journal_lines(result: dict) -> list[dict]:
    """One line per discrepancy, per the unit's output contract. A refusal produces ONE line saying so
    — never zero lines, which is what a healthy night also produces."""
    if not result.get("ok"):
        return [{"event": JOURNAL_EVENT, "ok": False, "reason": result.get("reason", "unknown")}]
    return [
        {"event": JOURNAL_EVENT, "ok": True, "night": r["night"], "state": r["state"], "detail": r["detail"]}
        for r in result["records"]
    ]

# tepna-capture — cpap_inventory_adapter.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE LAST LINK: harvest completion → the three inventories → the reconciliation → QC + journal.
#
# `cpap_inventory` is pure and knows nothing about disk. This is the thin impure half that reads the
# three inventories and hands them over. Every root is a PARAMETER, so the whole path is testable
# against a tmp tree with no BLE, no network and no daemon.
#
# 🔴 EACH SOURCE REPORTS WHETHER IT WAS CONSULTED, AND NONE OF THEM DERIVES IT.
# The oracle's rule is that absence is evidence only from a source that was actually read, so this
# adapter's one real job is to answer that question honestly for three different kinds of "empty":
#
#   card       — taken VERBATIM from the harvest result's `consulted` flag. NEVER derived from
#                `state`: a completed walk with short reads is `state == "error"` AND
#                `consulted == True`, while a walk that never happened is `error` and False. The
#                information is not present in `state` at all, which is why the transport publishes
#                the flag (Vigil box, 2026-08-28).
#   spool      — the LEDGER FILE existing and parsing. An absent ledger is "we never transacted the
#                spool", not "the device listed nothing"; the spool is a once-daily Summary
#                transaction, so on most therapy-end runs there is simply nothing new to have read.
#   envelopes  — the envelope DIRECTORY existing. No directory means live capture has never written
#                here, which is not the same as a night with no envelope.
#
# WHAT THIS DOES NOT DO: it never writes into a night's data, never triggers a harvest or a spool
# pull, and never raises into its caller. It is a reporter.

from __future__ import annotations

import json
import os

import cpap_inventory

# The QC-SUMMARY key and the journal file, both owned by the oracle rather than invented here.
QC_FIELD = cpap_inventory.QC_FIELD
JOURNAL_NAME = "CPAP-INVENTORY.jsonl"


def _listdir(path) -> list[str] | None:
    """Directory entries, or None when there was nothing to read. The None is load-bearing: it is the
    difference between "read it, found nothing" and "there was nothing to read".

    🔴 THE FALSY CHECK IS NOT DEFENSIVE PADDING — `os.listdir(None)` LISTS THE CURRENT WORKING
    DIRECTORY. Not an error, not an exception: a confident listing of somewhere else entirely. The
    envelope root is `cpap.ble_stream.edf_dir`, which is OPTIONAL — a bus-only box streams to the
    telemetry bus with no on-disk EDFs at all, and that is a real deployment mode. Without this line
    such a box returns `([], True)`: "I looked, and there are no envelopes", on every night, forever.
    A crash would have been kinder; this fails green. (Raised by Vigil box, 2026-08-28, before the
    wire — the last seam of three.)"""
    if not path:
        return None
    try:
        return sorted(os.listdir(path))
    except (OSError, TypeError):
        return None


def card_nights(dest_root: str) -> tuple[list[str], bool]:
    """The nights we HOLD — the local `DATALOG/` mirror, which is an INVENTORY.

    ⚠️ NOT the harvest's `night_keys`, which is this run's PULLED DELTA. `night_keys == []` with
    `skipped == 54` is a healthy night where nothing was new, and reading that delta as the inventory
    would report all 54 nights missing (caught by Vigil box before this was wired, 2026-08-28)."""
    # The falsy guard is here too, BEFORE the join: `os.path.join(None, ...)` raises TypeError, which
    # `on_harvest_complete`'s broad except would swallow — the reconciliation would simply never run
    # and the only evidence would be one log line. `_listdir`'s own guard is too late to help.
    entries = _listdir(os.path.join(dest_root, "DATALOG")) if dest_root else None
    if entries is None:
        return [], False
    return entries, True


def envelope_nights(envelope_root: str) -> tuple[list[str], bool]:
    """Nights with a live acquisition envelope — the `*.meta.json` sidecars written beside each live
    EDF. The night comes from the filename, which `cpap_inventory.night_key` resolves or refuses."""
    entries = _listdir(envelope_root)
    if entries is None:
        return [], False
    return [e for e in entries if e.endswith(".meta.json")], True


def spool_nights(spool_root: str, *, read_ledger=None) -> tuple[list[str], bool]:
    """Sessions the DEVICE listed, from the spool ledger.

    Consulted means the ledger was READ, not that it held rows. An unreadable or absent ledger returns
    `consulted=False` so the oracle refuses to draw spool-shaped conclusions from its silence."""
    if read_ledger is None:
        import cpap_spool

        read_ledger = cpap_spool.read_ledger
    try:
        rows = read_ledger(spool_root)
    except Exception:  # noqa: BLE001 — an unreadable ledger is "not consulted", never "empty"
        return [], False
    if rows is None:
        return [], False
    out = []
    for r in rows:
        for key in ("night", "session_start", "committed_cursor", "cursor"):
            v = r.get(key) if isinstance(r, dict) else None
            if v:
                out.append(str(v))
                break
    return out, True


def reconcile_after_harvest(result: dict, *, dest_root: str, envelope_root: str, spool_root: str,
                            read_ledger=None) -> dict:
    """Collect the three inventories and reconcile them. Returns the oracle's result verbatim.

    `result` is the harvest outcome from `capture.py`'s `on_complete` hook. Only two of its keys are
    read — `consulted` and (for the log line) `state` — because everything else this module needs is
    an inventory on disk rather than a fact about one run."""
    card, card_ok = card_nights(dest_root)
    env, env_ok = envelope_nights(envelope_root)
    spool, spool_ok = spool_nights(spool_root, read_ledger=read_ledger)
    return cpap_inventory.reconcile(
        spool=spool, envelopes=env, card=card,
        # VERBATIM from the transport. `result.get("consulted")` with no default-True: a hook result
        # that omits the flag is a hook we do not understand, and assuming True would manufacture
        # findings from an unread card.
        card_consulted=bool(result.get("consulted")) and card_ok,
        envelopes_consulted=env_ok,
        spool_consulted=spool_ok,
    )


def write_reports(res: dict, *, qc_path: str, journal_path: str) -> dict:
    """Write the QC-SUMMARY field and one journal line per discrepancy. Returns the QC payload.

    A refusal is carried through as `ok: false` rather than rendered as zero discrepancies, and it
    still produces ONE journal line — zero lines is what a healthy night produces, so a silent journal
    would make "nothing wrong" and "nothing examined" identical on disk."""
    payload = cpap_inventory.qc_field(res)
    try:
        existing = {}
        if os.path.exists(qc_path):
            with open(qc_path) as fh:
                existing = json.load(fh)
        existing[QC_FIELD] = payload
        with open(qc_path, "w") as fh:
            json.dump(existing, fh, indent=2)
    except (OSError, ValueError):
        pass  # the report is not the data; losing it must not look like losing the capture
    try:
        with open(journal_path, "a") as fh:
            for line in cpap_inventory.journal_lines(res):
                fh.write(json.dumps(line) + "\n")
    except OSError:
        pass  # same reason as the report above: the JOURNAL is not the data. Losing it must not
              # look like losing the capture, and the capture's own writers report their own faults
    return payload


def on_harvest_complete(result: dict, *, dest_root: str, envelope_root: str, spool_root: str,
                        qc_path: str, journal_path: str, read_ledger=None, log=None) -> dict | None:
    """The callee for `capture.py`'s `on_complete` hook. Never raises into its caller.

    The daemon wires this with the roots it already owns; everything else here is pure enough to test
    against a tmp tree."""
    try:
        res = reconcile_after_harvest(result, dest_root=dest_root, envelope_root=envelope_root,
                                      spool_root=spool_root, read_ledger=read_ledger)
        payload = write_reports(res, qc_path=qc_path, journal_path=journal_path)
        if log is not None:
            if not res["ok"]:
                log.info("cpap inventory: %s", res["reason"])
            else:
                log.info("cpap inventory: %d discrepancy(ies) over %d night(s) %s",
                         payload["discrepancies"], payload["complete_nights"] + payload["discrepancies"],
                         payload.get("by_state", {}))
        return payload
    except Exception:  # noqa: BLE001 — a reporter must not be able to change a harvest's outcome
        if log is not None:
            log.exception("cpap inventory reconciliation failed; the harvest itself is unaffected")
        return None

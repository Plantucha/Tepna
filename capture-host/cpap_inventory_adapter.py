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
#   spool      — the LEDGER FILE existing and every committed round decoding. An absent ledger is
#                "we never transacted the spool", not "the device listed nothing"; the spool is a
#                once-daily Summary transaction, so on most therapy-end runs there is nothing new.
#   envelopes  — the live stream's DIRECTORY existing. No directory means live capture has never
#                written here, which is not the same as a night the stream did not capture.
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
    """Nights the live stream captured — the `DATALOG/<night>/` folders under `cpap.ble_stream.edf_dir`
    that hold at least one `.edf`. The stream files its EDFs in the card's own layout, so the folder
    name IS the night, and `cpap_inventory.night_key` resolves or refuses it.

    ⚠️ NOT `*.meta.json`. The acquisition-evidence sidecar sits beside the RAW RECORD, under
    `raw_record_dir`, and only when that sink is on. This reader looked for it at the top of `edf_dir`,
    where no writer puts it, so every box read "consulted, no envelopes" (vigil 2026-10-31: 0 sidecars,
    58 stream nights). A folder with no `.edf` is a night the stream opened and never wrote."""
    root = _listdir(envelope_root)
    if root is None:
        return [], False
    if "DATALOG" not in root:
        return [], True  # the stream dir exists and has never filed a night: read, and empty is real
    nights = _listdir(os.path.join(envelope_root, "DATALOG"))
    if nights is None:
        return [], False
    return [
        n for n in nights if any(e.endswith(".edf") for e in _listdir(os.path.join(envelope_root, "DATALOG", n)) or [])
    ], True


def decoded_spool_days(spool_root: str) -> list[str] | None:
    """The therapy days the DEVICE listed: every committed Summary round, decoded, one day per record
    that carries a session. None when the spool cannot be read whole.

    ⚠️ THE LEDGER ROW DOES NOT NAME A NIGHT. A row's `committed_cursor` is the START of the block the
    device served, and one block covers ~16 nights, so keying rows named 4 nights for 37 rounds. The
    nights live inside the round's bytes, which `cpap_spool_decode` reads (vigil 2026-10-31: 92 days,
    0 unknown bytes). A round whose file is absent makes the list partial, and a partial list would
    turn every night it lost into a finding — so it returns None, which reads as not consulted."""
    import cpap_spool
    import cpap_spool_decode

    if not spool_root or not os.path.exists(cpap_spool.ledger_path(spool_root)):
        return None
    days = []
    for _row, path in cpap_spool_decode.iter_committed(spool_root):
        if path is None:
            return None
        with open(path, "rb") as fh:
            for rec in cpap_spool_decode.decode_round(fh.read())["records"]:
                day = cpap_spool_decode.local_day(rec)
                if day is not None and rec.get("sessions"):
                    days.append(day)
    return days


def spool_nights(spool_root: str, *, read_spool=None) -> tuple[list[str], bool]:
    """Nights the DEVICE listed, from the decoded spool.

    Consulted means the spool was READ whole, not that it held rows. An absent ledger, an absent round
    file or a round that does not decode returns `consulted=False`, so the oracle refuses to draw
    spool-shaped conclusions from its silence."""
    if read_spool is None:
        read_spool = decoded_spool_days
    try:
        days = read_spool(spool_root)
    except Exception:  # noqa: BLE001 — an unreadable spool is "not consulted", never "empty"
        return [], False
    if days is None:
        return [], False
    return [str(d) for d in days], True


def reconcile_after_harvest(
    result: dict, *, dest_root: str, envelope_root: str, spool_root: str, read_spool=None
) -> dict:
    """Collect the three inventories and reconcile them. Returns the oracle's result verbatim.

    `result` is the harvest outcome from `capture.py`'s `on_complete` hook. Only two of its keys are
    read — `consulted` and (for the log line) `state` — because everything else this module needs is
    an inventory on disk rather than a fact about one run."""
    card, card_ok = card_nights(dest_root)
    env, env_ok = envelope_nights(envelope_root)
    spool, spool_ok = spool_nights(spool_root, read_spool=read_spool)
    return cpap_inventory.reconcile(
        spool=spool,
        envelopes=env,
        card=card,
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


def on_harvest_complete(
    result: dict,
    *,
    dest_root: str,
    envelope_root: str,
    spool_root: str,
    qc_path: str,
    journal_path: str,
    read_spool=None,
    log=None,
) -> dict | None:
    """The callee for `capture.py`'s `on_complete` hook. Never raises into its caller.

    The daemon wires this with the roots it already owns; everything else here is pure enough to test
    against a tmp tree."""
    try:
        res = reconcile_after_harvest(
            result, dest_root=dest_root, envelope_root=envelope_root, spool_root=spool_root, read_spool=read_spool
        )
        payload = write_reports(res, qc_path=qc_path, journal_path=journal_path)
        if log is not None:
            if not res["ok"]:
                log.info("cpap inventory: %s", res["reason"])
            else:
                log.info(
                    "cpap inventory: %d discrepancy(ies) over %d night(s) %s",
                    payload["discrepancies"],
                    payload["complete_nights"] + payload["discrepancies"],
                    payload["by_state"],  # qc_field writes it on every ok payload
                )
        return payload
    except Exception:  # noqa: BLE001 — a reporter must not be able to change a harvest's outcome
        if log is not None:
            log.exception("cpap inventory reconciliation failed; the harvest itself is unaffected")
        return None

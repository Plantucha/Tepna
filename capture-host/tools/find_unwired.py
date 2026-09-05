#!/usr/bin/env python3
# tepna-capture — tools/find_unwired.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Find machinery that exists, is tested, and is connected to NOTHING. Seconds, no suite run.

THE CLASS. This suite's documented failure mode is *a check that reports success about something it
never examined*. This finds its sibling: **a check that examines correctly and reports to nobody.** No
CI job can see it, because every instance has passing tests — the tests call the function directly, and
that direct call is exactly the wiring production lacks. Five instances were found by hand on
2026-08-14 (CAPTURE-HOST-UNWIRED-MACHINERY brief), three more shipped the same day:

  · the charging veto      — correct, 24 green assertions, unreachable from the live path   (#1245)
  · the Deploy button      — green 12-minute gate, failed on the first real press    (#1244 → #1249)
  · `clock_uncorrectable`  — set, retracted, 7 tests, read by nothing                       (#1254)

⚠️ ADVISORY, NEVER A HARD GATE, and the allowlist is why. A declarative constant (`PMD_SERVICE`), a
CLI-only entry point, a protocol builder used solely by `probe_*.py` — all are legitimately "unused" by
this scan's definition. A gate that fails on those trains people to silence it, which is the same
failure one level up. Exit is always 0; the report is the product.

⚠️ TWO SCAN DRAFTS WERE WRONG BEFORE THIS ONE, both in ways that produced confident nonsense:

  1. Matching `name(` MISSES CALLBACK REFERENCES. `to_thread(diskguard.prune_old_nights, …)` passes the
     function without parentheses, so retention and night-archiving both read as dead when both are
     wired into the daemon. Scan 2 therefore matches the BARE NAME.
  2. Regexing `_set(name, key=…)` out of source text catches kwargs of NESTED calls — `timespec` is an
     argument to `isoformat`, not a status key — and misses keys whose quoting the pattern did not
     anticipate (`tool` was reported orphaned while `webmon` and the monitor both read it). Scan 1 there-
     fore walks the AST and takes only the keywords of the `_set` call itself.

  3. And covering ONE publication shape while reporting an unqualified "0 unexplained" (2026-09-01):
     scan 1 saw only `_set(name, key=…)` — the per-DEVICE shape — so top-level `STATUS["k"] = …`
     publications were invisible, and `STATUS["radio_distress"]` (computed nightly, read by nothing,
     #2031) then `STATUS["radio_switches"]` sailed past a green gate. `top_status_keys` closes the
     shape, and the report now prints WHICH shapes were enumerated with their counts, so the zero
     carries its filter.

Usage:
    python3 tools/find_unwired.py            # report (always exits 0)
    python3 tools/find_unwired.py --json     # machine-readable
    python3 tools/find_unwired.py --check    # exit 1 on anything unexplained (run by check.sh)
"""
from __future__ import annotations

import ast
import json
import io
import os
import re
import sys
import tokenize

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Modules that CONSUME device status. A key published by capture.py and named in none of these reaches
# no operator, no alert and no report — which is the whole finding.
CONSUMERS = ("webmon.py", "alerts.py", "nightqc.py", "timeline.py", "telemetry.py",
             "diskguard.py", "cpap_harvest.py", "monitor.html")

# Known-intentional, with the reason. Anything here is reported as ALLOWED rather than silently dropped:
# a suppression you cannot see is how the next real finding gets hidden behind a stale entry.
ALLOW_KEYS = {
    # ── Found 2026-09-02, the first run after `_comments_only` stopped counting prose as a consumer.
    #    Both are REAL orphans, not intentional publications, and they are listed here to keep the
    #    gate green-because-explained rather than green-because-blind while they are routed. Each
    #    names what retires it; if that condition is met and the entry stays, the stale-suppression
    #    scan below will say so.
    "autopull": "ORPHAN, not intentional (2026-09-02). capture.py publishes {last,new,trigger} and "
                "`trigger` is the only runtime evidence that the doff/presence auto-pull ever fired, "
                "but /api/state does not forward it and nothing reads it — monitor.html names this "
                "exact field as a past instance of the class in a COMMENT, which is what masked it "
                "from this scan until now. RETIRES when webmon forwards it beside `radio_switches` "
                "or the key is deleted.",
    "updated": "ORPHAN, not intentional (2026-09-02). Written on every status publish; no reader "
               "anywhere — status_union.instance_health deliberately ages heartbeat_ms instead. "
               "RETIRES when the key is deleted or given a reader.",
    "oxy_lifecycle": "published to STATUS by the G4 lifecycle wiring (run_oxyii emits the acquisition "
                     "state) for /api/state inspection — the charter's STATUS half; the webmon-forward "
                     "+ monitor lifecycle indicator is a tracked follow-up, same pattern the "
                     "ring_rtc_reset_suspect draw followed, alongside the IDLE_UNWORN/PULLING hooks",
    "oxy_recording": "the RECORDING axis's STATUS half (OxyRecEngine via _rec_emit) for /api/state "
                     "inspection — the same charter pattern as oxy_lifecycle directly above, with the "
                     "same tracked monitor-draw follow-up; the close-triggered pull (DAT-AUTO-HARVEST "
                     "unit 2) is its first in-daemon consumer and lands next",
    # ── top-level shape (STATUS[key]= / setdefault) — covered since 2026-09-01 ──────────────────────
    "heartbeat_ms": "read by status_union.read_instance (staleness verdict) — the §3.6 merge layer of "
                    "PER-DEVICE-ADAPTER-PINNING, itself in ALLOW_MODULES as PENDING with its missing "
                    "producer named; when that brief lands or is retired, this entry goes with it",
    "instance": "same consumer and same pending brief as heartbeat_ms directly above — the identity "
                "field status_union folds N instances by",
    "cpap_wedge": "the DURABLE record is the on-disk WEDGEFIRE journal (_wedge_fire_record), written "
                  "at the same site — this STATUS copy is the live snapshot for a monitor draw that "
                  "is a tracked follow-up (bluez_wedge.py's own comment names the journal as the "
                  "outcome channel precisely because status.json snapshots cannot be one)",
}
# Fields the API publishes that the monitor does not draw — either for a consumer OTHER than the monitor,
# or a monitor draw that is PENDING and tracked. `/api/state` is not the monitor's private channel — but
# "something else reads it" / "a draw is coming" must be STATED, not assumed. An entry here without a
# real follow-up is exactly the stale suppression this file warns against, so the tracker is load-bearing.
ALLOW_RENDERED: dict = {}

# Handlers defined in monitor.html that nothing calls. Same rule, same reason.
ALLOW_JS: dict = {}

# SCAN 6's allowlist: modules nothing imports. Keyed by MODULE, not by function — the whole point is
# that the module is unreachable, so exempting it function-by-function would restate the bug.
ALLOW_MODULES = {
    "status_union": (
        "the §3.6 merge layer of PER-DEVICE-ADAPTER-PINNING-2026-08-26-BRIEF. PENDING, and the "
        "consumer it waits on is NAMED: nothing yet writes the per-instance status.<instance>.json "
        "that read_instance() expects, because the systemd-instance half of that brief is unbuilt. "
        "Retires when the writer lands; if that brief is abandoned, DELETE this module with the entry"),
    "adapter_ab": (
        "an offline A/B analysis tool, not daemon code — it answers 'which radio receives better' "
        "from real per-advertisement scans and is invoked by hand, which is why it has no importer "
        "and why tools/mutate.py SKIPs it. LIVE, not dead: it produced the three-adapter table in "
        "PER-DEVICE-ADAPTER-PINNING-2026-08-26-BRIEF §1. Its individual functions already carry the "
        "same reason in ALLOW_FUNCS; this entry says it at the module level, which is the level at "
        "which it is unreachable"),
    "ble_visibility": (
        "the adapter-visibility log's record format + reader. HALF LIVE, HALF PENDING, both named. "
        "LIVE: main() is a hand-invoked reporter like adapter_ab — `ble_visibility.py "
        "<records.jsonl> <MAC>` answers 'which radio can see this device, out of how many scans' in "
        "one command, which is the entire reason it exists (that question cost an hour and three "
        "wrong hypotheses on 2026-09-04, because the journal logs discovery FAILURES and is silent "
        "on successes, so it carries no denominator). PENDING: nothing WRITES the log yet — the "
        "periodic per-adapter scan belongs in the daemon, and that touches production capture, "
        "which is an owner call rather than a drafting one. RETIRE this entry when that scan lands "
        "and imports make_record/append_record; if the daemon never collects, DELETE the module "
        "with the entry, because a reader with nothing to read is dead code"),
    "adapter_pool": (
        "swappability's per-device reassignment core. ASPIRATIONAL for the same architecture reason "
        "its individual functions already carry: the daemon repoints ONE global ADAPTER pin, so a "
        "{device: adapter} map has no consumer and cannot have one without per-device pinning. Kept "
        "for the design it encodes; DELETE with this entry if per-device pinning is not taken up"),
}

ALLOW_FUNCS = {
    # ── Swappability pure core (2026-08-30). ⚠️ THE ORIGINAL REASON HERE WAS WRONG AND IS CORRECTED.
    # It said the bluez hotplug watch "that calls them is unit 1's second half", implying these would
    # be discharged by wiring that watch. Tracing to the CONSUMER showed otherwise, twice over:
    #
    #   1. The headline requirement is ALREADY MET. `failover_target(pin, await list_adapters())`
    #      enumerates controllers at failover time, so a newly plugged radio already joins the pool.
    #      A watch would have been machinery for a capability that exists.
    #   2. These three return a PER-DEVICE `{device: adapter}` mapping, and the daemon is SINGLE-PIN:
    #      `ADAPTER` is a process global and `_set_active_adapter` repoints it once for every device.
    #      There is no per-device adapter anywhere to consume the mapping. Nothing short of converting
    #      every connect path to per-device pinning can wire these, which is a large change nobody has
    #      asked for.
    #
    # So they are ASPIRATIONAL, not pending: correct, tested, and describing an architecture this
    # daemon does not have. They are kept rather than deleted because the reasoning they encode (sticky
    # assignment; the idle-vs-loaded `movable` tie-break; never stranding a device on a departed radio)
    # is the expensive part and would have to be rediscovered. If per-device pinning is still not on
    # the roadmap when someone next reads this, DELETE them and these entries together — dead code
    # behind an allowlist is worse than no code, and an aspiration that never arrives is dead code.
    "apply_added": "adapter_pool — per-device reassignment on plug-in. ASPIRATIONAL: needs per-device adapter pinning, which the single-pin daemon does not have and nobody has asked for. Delete with its siblings if that never arrives",
    "apply_removed": "adapter_pool — per-device reassignment on unplug. ASPIRATIONAL, same reason as apply_added: the daemon repoints ONE global pin, so a {device: adapter} map has no consumer",
    "rebalance_reason": "adapter_pool — the human-readable WHY behind a per-device reassignment. ASPIRATIONAL: it describes moves that only a per-device architecture can make",
    "night_profile": "adapter_ab is an offline analysis tool, not daemon code",
    # ── SA2 writer + dictionary comparator (2026-09-04). PENDING, and the consumer is NAMED.
    # cpap_edf_writer.EdfSink writes BRP from the live BLE stream; the O2Ring produces 1 Hz SpO2
    # and pulse on the same nights, and SA2 is the ResMed container for exactly that. Nothing
    # wires the ring into the CPAP EDF tree YET, which is why these have no caller. They are not
    # speculative: the declarations they write were derived from 294 real SA2 files and are
    # checked against the card by tests/test_cpap_edf_sa2.py. RETIRE when an SA2 sink lands; if
    # the ring is never written into the CPAP tree, DELETE both with these entries.
    # ── Adapter-visibility log, WRITE half (2026-09-04). PENDING, and the consumer is NAMED.
    # The gate is exactly right about which two: read_records/visibility/format_visibility are
    # reachable through main(), the hand-invoked reporter, and these two are not — because nothing
    # WRITES the log yet. The periodic per-adapter scan that would call them belongs in the daemon,
    # and that touches production capture, which is an owner call. RETIRE when that scan lands; if
    # the daemon never collects, DELETE these with ble_visibility itself.
    "make_record": "ble_visibility — one scan round -> one record, carrying `devices_seen` so a rate is computable later. PENDING the daemon's periodic per-adapter scan; the reader half (main()) is live and hand-invoked today",
    "append_record": "ble_visibility — appends a record to the JSONL log. PENDING the same daemon scan as make_record; deliberately separate from it so the record format is testable without touching a file",
    "build_sa2": "cpap_edf — writes the ResMed SA2 oximetry container the AS11 leaves empty when no wired sensor is attached. PENDING an SA2 sink that feeds it from the O2Ring; delete with declaration_matches if that never lands",
    "device_start_from_host": "cpap_edf — the ONE boundary where an SA2 crosses from the host-stamped ring onto the AS11's device axis, so it lands beside its device-stamped BRP (Clock Contract §7/§12). Unwired for the SAME reason as build_sa2 above: no SA2 sink exists yet. It is deliberately NOT inlined into build_sa2 — the builder stays a pure encoder under declare-never-correct, and this refuses on an unmeasured offset rather than writing a well-formed file wrong by an unknown amount. RETIRE with build_sa2; if the ring is never written into the CPAP tree, delete all three together.",
    "declaration_matches": "cpap_edf — diffs a real file's signal block against the derived cpap_edf_dict. Used by the card test today; PENDING a runtime check that verifies a written EDF against the dictionary before it reaches the harvest tree",

    "compare": "adapter_ab analysis tool",
    "unattributable": "adapter_ab analysis tool",
    # ── investigated 2026-08-14 (brief §5). Each is CAPABILITY THAT EXISTS ELSEWHERE, not a gap. The
    # reason is recorded here so the next reader spends a line rather than an investigation — which is
    # the allowlist's whole job, and why every entry prints with its justification.
    # ── OxyII acquisition charter G2 (2026-08-23). The inventory ledger ships as a STANDALONE module
    # by design: charter §4 sequences G2 (the vocabulary) before G1 (the `_pull_once` wiring that
    # consumes it), the same shape the CPAP arm used. So these are not unwired-by-oversight, they are
    # unwired-by-schedule, and the entries come OUT when G1 lands rather than staying forever.
    # ⚠️ Deliberately NOT a module-wide exemption. `classify`, `reconcile`, `identity` and `current`
    # are the logic G1 must call, so if THOSE ever appear here it means the wiring regressed and the
    # gate should say so. Only the plumbing is listed.
    # G3's restart planner, same posture: standalone until G1 consumes the plan. `plan()` itself is
    # NOT listed — it is the entry point G1 must call, so if IT ever appears here the wiring regressed
    # and the gate should say so. Only the one-line trust accessor was fenced.
    # ── G1 HAS LANDED (2026-08-24). pull_session._pull_once now drives the ledger + restart plan, so the
    # G2/G3 plumbing that was "standalone until G1" — is_trusted · append_row · load_rows · make_row ·
    # sha256_bytes — is genuinely wired and its entries came OUT, exactly as the schedule above promised.
    # The cpap_spool P4 pair: `sync_spool`'s entry CAME OUT when the announced daemon wiring landed
    # (`capture._cpap_spool_loop`, CPAP-SPOOL-ACQUISITION Do-3). ⚠️ This tool does NOT report an
    # allowlist entry that has stopped matching — a wired function simply drops off the list, and its
    # suppression sits here inert. That is precisely the "suppression you cannot see" this file's
    # header warns about, so removing it is a MANUAL step at wiring time, not something the scan
    # reminds you to do. If you wire something, delete its line in the same commit.
    #
    # `last_committed_cursor` STAYS, and the reason it stays has changed — the old note predicted "the
    # wiring consume[s]" it, and the wiring does not: `sync_spool` derives its own cursor from the
    # ledger (`rows[-1]["committed_cursor"] if rows else epoch_start`), so a caller never asks. It is
    # the restart authority G4/P5 reads, and remains standalone until P5.
    "last_committed_cursor": "cpap_spool P4 — the restart authority P5 reads; NOT consumed by the Do-3 daemon wiring, which lets sync_spool derive the cursor from the ledger itself",
    # ── SURFACED BY THE TOKENIZE FIX (2026-08-27), not newly written ───────────────────────────────
    # Each was ALREADY uncalled; the usage scan simply could not see it, because a mention of the name
    # in a comment or docstring counted as a call. They are suppressed here rather than wired or
    # deleted, and each reason states what would REMOVE the suppression — an entry that cannot say what
    # would retire it is debt wearing a justification.
    # ── cpap_inventory (the spool-as-inventory oracle) ────────────────────────────────────────────
    # `qc_field` and `journal_lines` were suppressed here while the pure half waited for its adapter.
    # Both suppressions are now SPENT — cpap_inventory_adapter consumes them — and the tool said so
    # ("the suppression is spent") before a human did, which is the entry-retirement rule working.
    #
    # `on_harvest_complete` was suppressed here too, on the narrower ground that the CALL SITE was
    # another session's to change. That condition named its own retirement — "the moment `on_complete=`
    # is passed at capture.py's cpap_poller" — and that moment has arrived, so the entry is gone rather
    # than left behind as a spent suppression describing a handover that has completed.
    "assemble_spool": "acq_evidence_cpap Phase B — the spool evidence assembler, honestly recorded as "
                      "tested-not-witnessed; its consumer is the FIRST WITNESSED PULL (CPAP-SPOOL-"
                      "ACQUISITION Do-1/Do-2), which needs the device. Retire this when that pull lands",
    "hdev": "allan.py — overlapping HADAMARD deviation (Baugh 1971 / Riley SP 1065). Its sibling `adev` "
            "IS wired (nightqc); hdev is the drift-tolerant variant, available for an analysis that has "
            "not yet needed it. Retire this when a caller quotes H-sigma, or delete if none ever does",
    "read_edf": "cpap_edf — the round-trip partner of `write_edf` (which IS wired, cpap_edf_writer). It "
                "exists so `write_edf(read_edf(x)) == x` is provable byte-for-byte; the tests are its "
                "legitimate consumer. Retire only if that property stops being asserted",
    "list_sessions": "oxy_transfer §2 — read-only 'what the ring says it has', committing to nothing. "
                     "Fourth of the unit-2 family with pull_deadline/flush_gate/resume_target, all "
                     "landed ahead of the async shell that drives them. Retires with that shell",
    "close_harvest_decision": "oxy_transfer §14 — composes pull_deadline + flush_gate into the "
                              "close-triggered sequence; standalone until the async shell drives it. "
                              "Deliberately landed ahead of that shell: the ORDERING is the design, and "
                              "an ordering bug inside an await loop is nearly untestable — all four "
                              "orderings are pinned here by mutation instead",
    "resume_target": "oxy_transfer §8b — which link state a finished held-link pull hands back to "
                     "(contact at exit: worn → LIVE, unworn → IDLE_UNWORN); standalone until unit 2's "
                     "orchestration calls it. Third of the trio with pull_deadline and flush_gate — the "
                     "link table PERMITS both targets and deliberately does not choose, so the choosing "
                     "lives here and is testable before a caller exists",
    # ⚠️ THE NAMED MODULE WAS WRONG. This read "pull_session.py already gates re-pulls … via
    # parse_trailer"; `pull_session.py` exists and contains NO `parse_trailer` at all. The gate is
    # `oxy_inventory.classify` (`if parse_trailer(data) is None: return PARTIAL, "not finalised: no
    # Format-A trailer sub-magic"`), with `oxy_transfer` reading the same trailer. The SUBSTANCE holds
    # — something does gate on finalisation, so this helper is genuinely redundant — but the reason
    # pointed a reader at a file that could not confirm it, which is the same named-thing error as the
    # SRP entries above. Measured 2026-08-30.
    # ── Encrypted-session guard (2026-09-02). PENDING, and the consumer is NAMED: the OxyII connect
    # path in capture.py, which is a different unit in a different lane and is reviewed separately.
    # Landed ahead of that caller deliberately, because the CLASSIFICATION is the design and it is
    # the part that was got wrong first: refusing on any reply to OP_AUTH — the obvious rule — would
    # have refused the connects that a real branch-2D010001 ring served four files over. That
    # distinction is derived from hardware behaviour and is pinned by tests here; a caller cannot
    # make it, it can only obey it.
    #
    # Retires the moment capture.py's OxyII connect calls classify_auth_reply() and its live poll
    # feeds sustained_ciphertext(). If that wiring is not taken up, DELETE the functions and these
    # entries together — the whole point of the guard is that something acts on the refusal, and a
    # refusal nothing reads is worse than no guard, because it reads like protection.
    "classify_auth_reply": "PENDING capture.py's OxyII connect path (separate unit, separate lane) — "
                           "decides plaintext / encrypted / refuse from an OP_AUTH reply; the "
                           "three-way outcome is the design and is measured against a real ring",
    "sustained_ciphertext": "PENDING capture.py's OxyII live poll (same unit as classify_auth_reply) — "
                            "the probabilistic secondary tell, deliberately separate from the primary "
                            "classification so a caller can act on them differently",
    "oxy_is_finalized": "redundant — `oxy_inventory.classify` already gates on finalisation via "
                        "`parse_trailer` (and `oxy_transfer` reads the same trailer), which those "
                        "callers need anyway for the device summary",
    "busy_with": "redundant — offline_lock.slot() raises OfflineBusy(_busy), so the label already "
                 "reaches callers as e.holder",
    "predict_step_split": "research helper from O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS §2, driven by its "
                          "brief rather than by the daemon — same shape as blind_spots.analyze",
    "is_offline_cmd": "the READ half of a write/read pair whose write half IS used — `as_offline` sets "
                      "the bit in probe_verity_offline and probe_verity_survey; nothing needs to ask "
                      "the question back. Same shape as busy_with",
    # ⚠️ THE PREVIOUS REASON WAS FALSE, in the same way `pull_spool`'s below it was: both claimed "used
    # by the pairing probe". THERE IS NO PAIRING PROBE, and there never was one — no file matching
    # *pair* appears anywhere in this repo's history, and `SrpClient`, the class these two feed, is
    # referenced by nothing but its own tests. Measured 2026-08-30 while the pairing endpoint was being
    # investigated; the `pull_spool` correction below had been made WITHOUT sweeping its siblings,
    # which is how a second false reason survived two lines away. A fix that does not sweep its own
    # class leaves the rest.
    #
    # 🔴 BUT THIS IS NOT `pull_spool`'S STATE, AND THE DISTINCTION DECIDES WHETHER THEY GET DELETED.
    # `pull_spool` is retired because nothing will ever call it — its consumer exists and chose another
    # path. These are called only by tests because their CONSUMER WAS NEVER WRITTEN: the webmon pairing
    # endpoint and its contract test exist (`test_webmon_cpap_pair_contract.py`, which pins today's 501
    # as INTENDED), the SRP primitives exist, and the orchestration between them — connect →
    # StartKeyExchange → prove → ConfirmKeyExchange → verify M2 → write as11_creds.json — exists
    # nowhere. Producer-half foundation of an unbuilt feature, not residue.
    # Deleting them would mean "AS11 pairing is permanently abandoned", which is the owner's call and
    # not a gate-hygiene decision. The owner said pairing is not needed NOW (the AS11 is decoded and
    # creds already exist on the box) — a different statement.
    "start_key_exchange": "as11_link — SRP-6a producer-half primitive for AS11 pairing. Its orchestration "
                          "is UNBUILT, so it is currently reached only by tests. KEEP: the foundation of "
                          "an unwritten feature, not dead code. Retire only on an explicit decision that "
                          "AS11 pairing is abandoned",
    "confirm_key_exchange": "as11_link — SRP-6a producer-half primitive for AS11 pairing. Same state and "
                            "same reasoning as start_key_exchange above: orchestration unbuilt, reached "
                            "only by tests, KEEP until pairing is explicitly abandoned",
    "pull_spool": "as11_pull — SUPERSEDED, and retained as the protocol-level reference its tests pin. "
                  "⚠️ THE PREVIOUS REASON WAS FALSE: it claimed the operator probe calls this, and "
                  "code-uses measured ZERO. Production drives the spool through cpap_spool.sync_spool "
                  "-> as11_pull.pull_spool_round, which adds the ledger/promote/cursor transaction this "
                  "bare multi-round loop has no notion of; cpap_spool.py's own header records that it "
                  "was built because this function was wired into nothing. Retire by deleting it (with "
                  "its tests) once nobody wants a transaction-free reference driver — a decision, not a "
                  "cleanup.",
    "build_pld": "CPAP EDF writer — constructs a bit-accurate PLD.edf (derived 2 s channels) from captured data",
    "build_eve": "CPAP EDF writer — constructs a bit-accurate EVE.edf (EDF+ event annotations) from captured data",
    # cpap_ingest.py is the CPAP acquisition gap-accounting layer (audit G4/G7): classify_frame makes a
    # foreign-streamId or malformed frame COUNTABLE instead of silently dropped. It is the public
    # classifier consumed by the tests today and by the P1+P3 ingestion wiring next — the single
    # capture.py/cpap_stream.py touch that lands after the feature-arm controller-race fix (audit §7/§8).
    # Same shape as the AS11 protocol builders and CPAP EDF constructors above: real, tested, wired next.
    "classify_frame": "CPAP gap-accounting — counts foreign/malformed frames; consumed by tests today, wired by the P1+P3 ingestion touch next (after the controller-race fix)",
}


def _pyfiles(root: str) -> list[str]:
    """The modules to scan, from `root` — NOT from the module-level HERE.

    ⚠️ It read HERE at first, which made `scan(root)`'s parameter DECORATIVE: passing a different tree
    listed the live checkout's filenames and then tried to open them under the new root, so every
    synthetic-tree test died on FileNotFoundError. A parameter that is accepted and ignored is worse
    than one that does not exist — the caller believes it took effect."""
    out = []
    for name in sorted(os.listdir(root)):
        if name.endswith(".py") and not name.startswith("probe_"):
            out.append(name)
    return out


def _code_only(path: str) -> str:
    """A file's EXECUTABLE text — comments and string literals removed. PURE-ish (reads one file).

    🔴 WHY THIS EXISTS. The usage scan matches `\\bname\\b` over file text, so a function name written
    in a COMMENT counted as a call. That is not a corner case in this repo, which documents itself
    constantly and by name: measured 2026-08-27, **12 public functions were masked from the orphan
    scan by prose alone**, and the masking is SILENT — the function simply stops being reported.

    The demonstration that settled it: a tombstone comment added to `oxy_presence.py` earlier that day,
    written to explain why a duplicate had been deleted, named four `oxy_transfer` functions in passing.
    `resume_target`'s only mention outside its own module WAS that comment — so a comment written to be
    helpful switched the detector off for it. **A gate whose precision degrades as the repo documents
    itself better is mis-specified for this repo.**

    The worst case is not a missed orphan, it is a missed orphan whose ALLOWLIST ENTRY then reads as
    spent — because the stale-suppression scan asks "did this entry excuse anything?" and prose makes
    the answer no. Delete on that basis and the suppression for a genuinely unwired function is gone.

    ⚠️ Falls back to the RAW text on a tokenize failure, deliberately. A syntactically-broken file must
    not silently contribute NOTHING to the usage corpus — that would invent orphans across the whole
    repo from one bad parse. Over-counting uses (the old behaviour) is the safe direction here."""
    try:
        src = open(path, encoding="utf-8", errors="replace").read()
    except OSError:      # pragma: no cover - unreadable file; contributes nothing either way
        return ""
    if not path.endswith(".py"):
        return re.sub(r"#.*", "", src)          # shell: strip comments; it has no string-literal AST
    try:
        return " ".join(t.string for t in tokenize.generate_tokens(io.StringIO(src).readline)
                        if t.type not in (tokenize.COMMENT, tokenize.STRING))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        return src                               # see the docstring: fail toward OVER-counting uses


def _comments_only(path: str) -> str:
    """A file's text with COMMENTS removed and STRING LITERALS KEPT. For the CONSUMER corpus.

    🔴 WHY THIS IS NOT `_code_only`. The sibling above strips comments *and* string literals, which is
    right for the FUNCTION scan (a call is an identifier) and catastrophic for the KEY scan: a status
    key reaches its consumer AS A STRING — `status.get("radio_distress")` — so stripping literals makes
    every such key read as unwired. Measured 2026-09-02 before writing this: running `_code_only` over
    `webmon.py` removes `"radio_distress"` and `"host_clock"`, both live consumers. Using it here would
    have converted a gate that was blind to one defect into a gate that fabricates dozens.

    What the consumer corpus actually needs removed is PROSE. The defect this fixes: the corpus was raw
    text, so `\bautopull\b` matched a COMMENT in `monitor.html` — a comment whose content is the
    observation that `STATUS["autopull"]` reaches nobody. The gate's own evidence of the defect was
    what suppressed the finding.

    ⚠️ `//` is stripped only at the START of a line (after optional whitespace). Mid-line it is far more
    often a URL than a comment, and this file's doctrine is to fail toward OVER-counting uses: a missed
    strip costs a missed orphan, a wrong strip invents one."""
    try:
        src = open(path, encoding="utf-8", errors="replace").read()
    except OSError:      # pragma: no cover - unreadable file; contributes nothing either way
        return ""
    if path.endswith(".py"):
        try:
            return " ".join(t.string for t in tokenize.generate_tokens(io.StringIO(src).readline)
                            if t.type != tokenize.COMMENT)
        except (tokenize.TokenError, IndentationError, SyntaxError):
            return src                           # fail toward over-counting uses, as `_code_only` does
    src = re.sub(r"<!--.*?-->", " ", src, flags=re.S)      # HTML
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)       # JS/CSS block
    src = re.sub(r"(?m)^[ \t]*//.*$", " ", src)            # JS line comment, line-initial only
    return src


def status_keys(src: str) -> set[str]:
    """Every key published through `_set(name, key=…)`, taken from the AST.

    Only the `_set` call's OWN keywords — a regex over source text also collects the kwargs of nested
    calls, which is how `timespec` (an argument to `isoformat`) was once reported as a status key."""
    keys: set[str] = set()
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if not (isinstance(fn, ast.Name) and fn.id == "_set"):
            continue
        for kw in node.keywords:
            if kw.arg:                       # `**{...}` has arg=None; those are handled below
                keys.add(kw.arg)
        # `_set(name, **{f"rows_{meas}": …, "last_sample": …})` — literal keys inside a splat still count
        for kw in node.keywords:
            if kw.arg is None and isinstance(kw.value, ast.Dict):
                for k in kw.value.keys:
                    if isinstance(k, ast.Constant) and isinstance(k.value, str):
                        keys.add(k.value)
    return keys


def top_status_keys(src: str) -> set[str]:
    """Every key published TOP-LEVEL — `STATUS["k"] = …` and `STATUS.setdefault("k", …)` — from the AST.

    THE BLIND SPOT THIS CLOSES (2026-09-01): `status_keys` covers `_set(name, key=…)`, the per-DEVICE
    shape, and NOTHING covered the top-level shape — so `STATUS["radio_distress"]` was computed
    nightly and read by nobody while the gate reported 0 unexplained, and `STATUS["radio_switches"]`
    repeated the pattern the same week. A count is only evidence over the population it enumerated;
    the report now names both shapes WITH their counts so "0 unexplained" carries its filter.

    Two shapes, deliberately narrow: a Subscript ASSIGN with a constant key, and a `setdefault` call's
    first constant argument (which creates the key whether or not the value is later mutated in
    place). Reads (`STATUS.get`, `STATUS["k"]` on the right-hand side) are not publications and are
    not collected."""
    keys: set[str] = set()
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if (isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name)
                        and t.value.id == "STATUS" and isinstance(t.slice, ast.Constant)
                        and isinstance(t.slice.value, str)):
                    keys.add(t.slice.value)
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "setdefault" and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "STATUS" and node.args
                and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
            keys.add(node.args[0].value)
    return keys


def projected_keys(src: str) -> set[str]:
    """The device-projection keys `webmon` publishes to `/api/state`, from the AST.

    Anchored on the dict literal carrying both `connected` and `battery` — the device projection — rather
    than on a line number or a function name, so it survives the file moving around it."""
    for node in ast.walk(ast.parse(src)):
        if not isinstance(node, ast.Dict):
            continue
        ks = {k.value for k in node.keys if isinstance(k, ast.Constant) and isinstance(k.value, str)}
        if {"connected", "battery"} <= ks:
            return ks
    return set()


def public_functions(src: str) -> set[str]:
    """Module-level `def`s that are part of the module's surface (not `_private`)."""
    out: set[str] = set()
    for node in ast.parse(src).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and not node.name.startswith("_"):
            out.add(node.name)
    return out



# ── SCAN 6's population helper ────────────────────────────────────────────────────────────────────
def importers(root: str, module: str) -> set:
    """Files under `root` that IMPORT `module`, excluding tests and the module itself. PURE-ish.

    Matches `import m`, `import m as x`, `from m import ...` — anchored so `import status_union_x`
    cannot satisfy `status_union`, and so the word appearing in prose or a call cannot either. Only
    an IMPORT counts, because that is the only thing that makes a module reachable."""
    # ⚠️ A STATIC `import` IS NOT THE ONLY WAY IN, and assuming it was produced a FALSE POSITIVE on
    # the first run: `tools/mutate_diff.py` loads `mmeta` with
    # `importlib.util.spec_from_file_location("mmeta", HERE / "mmeta.py")` + `exec_module`, which no
    # import-line regex can see. A reachability gate that cries wolf gets switched off, so the
    # dynamic form counts too — matched ONLY on the module name as the first argument of
    # `spec_from_file_location`, which is how a file-location load necessarily spells it.
    #
    # ⚠️ AND NOT ON A BARE "<module>.py" LITERAL, which was my first attempt and was WORSE than the
    # bug it fixed. `tools/mutate.py:121` holds `SKIP = {..., "adapter_ab.py"}` — a SKIP LIST, the
    # exact opposite of reachability — and matching the literal counted it as an import, silencing a
    # genuine orphan. A pattern loose enough to be satisfied by a file being EXCLUDED is not evidence
    # of anything.
    esc = re.escape(module)
    pat = re.compile(
        r"^\s*(?:import\s+%s(?:\s+as\s+\w+)?\s*$|from\s+%s\s+import\b)" % (esc, esc)
        + r"|spec_from_file_location\(\s*[\'\"]%s[\'\"]" % esc, re.M)
    found = set()
    for dirpath, _dirs, names in os.walk(root):
        if os.sep + "tests" in dirpath or "node_modules" in dirpath or os.sep + ".venv" in dirpath:
            continue
        for n in names:
            if not n.endswith(".py") or n == module + ".py":
                continue
            try:
                # COMMENTS STRIPPED: `timeline.py` names `adapter_ab.night_profile` in a comment, and
                # counting prose as reachability is the masking this whole tool exists to refuse —
                # the same lesson `_code_only` records for the function scan.
                raw = open(os.path.join(dirpath, n), encoding="utf-8").read()
                decommented = re.sub(r"(?m)#.*$", "", raw)
                if pat.search(decommented):
                    found.add(os.path.relpath(os.path.join(dirpath, n), root))
            except OSError:
                continue   # a file we cannot read cannot be shown to import anything, so this scan
                           # FAILS TOWARD "unwired" — toward reporting, never toward hiding
    return found


def is_entry_point(text: str) -> bool:
    """True when a module is runnable on its own — `if __name__ == "__main__"`.

    An entry point is reachable BY BEING RUN, so nothing needs to import it and its absence from
    every import line says nothing. Omitting this test would flag every script in the tree."""
    return bool(re.search(r'if\s+__name__\s*==\s*[\'"]__main__[\'"]', text))


def scan(root: "str | None" = None) -> dict:
    # `root=None` then `root or HERE`, NOT `root=HERE` as a default. A default argument binds at DEF
    # time, so `HERE` was frozen at import and `main()` could not be redirected at all — patching the
    # module constant changed nothing. Same shape as the decorative parameter above: the caller believes
    # it took effect. Reading it at CALL time is what makes both the tests and the tool honest.
    root = root or HERE
    files = _pyfiles(root)
    src = {f: open(os.path.join(root, f), encoding="utf-8").read() for f in files}
    consumers = ""
    for name in CONSUMERS:
        p = os.path.join(root, name)
        if os.path.exists(p):
            # COMMENTS OUT, STRINGS IN — see `_comments_only`. Raw text here meant a key named in prose
            # counted as a key that reached a consumer, and the prose that did it was a comment saying
            # the field reached nobody.
            consumers += _comments_only(p)

    pop_keys = set()
    pop_top_keys = set()
    pop_rendered = set()
    pop_js = set()
    orphan_keys = []
    if "capture.py" in src:
        pop_keys = status_keys(src["capture.py"])
        pop_top_keys = top_status_keys(src["capture.py"])
        # BOTH publication shapes, each row saying WHICH it came through. One rule (a key named in no
        # consumer reaches nobody), two populations — and the report prints both counts, because a
        # "0 unexplained" that does not name what it enumerated is the examined-nothing shape one
        # level up (the top-level shape was invisible here while STATUS["radio_distress"] and then
        # STATUS["radio_switches"] sat unread).
        for shape, population in (("_set(name, key=…)", pop_keys),
                                  ("STATUS[key]= / STATUS.setdefault(key,…)", pop_top_keys - pop_keys)):
            for key in sorted(population):
                if re.search(r"\b%s\b" % re.escape(key), consumers):
                    continue
                orphan_keys.append({"key": key, "shape": shape, "allowed": ALLOW_KEYS.get(key)})

    # every .py including probes, plus the shell helpers and tools — a function called only by a probe
    # or a helper script is wired, just not from the daemon.
    everything = ""
    for dirpath, _dirs, names in os.walk(root):
        if os.sep + "tests" in dirpath or "node_modules" in dirpath or os.sep + ".venv" in dirpath:
            continue
        for n in names:
            # ⚠️ SKIP THIS FILE. The allowlist NAMES the functions it excuses, so scanning our own source
            # counts each entry as a usage — and the entry then vanishes from the report entirely rather
            # than printing as "(allowed)", which is the exact opposite of the stated design ("a
            # suppression you cannot see is how the next real finding hides behind a stale entry").
            # Measured 2026-08-14: adding three allowlist entries silently removed all three rows.
            # A scanner must not count its own suppression file as evidence the code is wired.
            if os.path.abspath(os.path.join(dirpath, n)) == os.path.abspath(__file__):
                continue
            if n.endswith((".py", ".sh")):
                everything += _code_only(os.path.join(dirpath, n))

    # ── SCAN 3 · FORWARDED BUT NEVER DRAWN ──────────────────────────────────────────────────────────
    # The next link in the same chain. Scan 1 asks whether a published key reaches a consumer, and
    # `webmon.py` counts as one — so forwarding a field satisfies it while the field still reaches
    # nobody's eyes. `worn_why`'s own comment in that projection makes the argument for this scan: *"The
    # daemon logs the conflict; a log line does not reach the person looking at the monitor."* Correct,
    # and it applies one layer further on: a field published to a JSON endpoint nobody reads is not
    # published to an operator either.
    orphan_rendered = []
    wm = os.path.join(root, "webmon.py")
    mon = os.path.join(root, "monitor.html")
    if os.path.exists(wm) and os.path.exists(mon):
        html = open(mon, encoding="utf-8", errors="replace").read()
        keys = projected_keys(open(wm, encoding="utf-8").read())
        pop_rendered = set(keys)
        if not keys:
            # FAIL LOUD, NOT OPEN. An anchor that stops matching returns an empty set, and an empty set
            # reports "0 unexplained" forever — a scan that examines nothing and calls it clean, which is
            # the failure this whole tool exists to name. Losing the anchor must red, not go quiet.
            orphan_rendered.append({"key": "<projection not found — the AST anchor in projected_keys() "
                                           "no longer matches webmon.py>", "allowed": None})
        for key in sorted(keys):
            if re.search(r"\b%s\b" % re.escape(key), html):
                continue
            orphan_rendered.append({"key": key, "allowed": ALLOW_RENDERED.get(key)})

    # ── SCAN 4 · A HANDLER WITH NO CONTROL ──────────────────────────────────────────────────────────
    # Scan 3 asks whether a published field is REFERENCED in monitor.html — and a reference inside a
    # function nothing calls is not a rendering. Removing `${lastSampleText(d)}` from the device row left
    # scan 3 perfectly green, because the key still appeared inside the helper's own body. Same shape as
    # scan 2's `uses - defs`: the definition is not a use. It found `syncAllTime` on its first run — a
    # complete host+all-devices clock sync, POSTing a registered endpoint, with no button in the page.
    orphan_js = []
    if os.path.exists(mon):
        html_js = open(mon, encoding="utf-8", errors="replace").read()
        pop_js = set(re.findall(r"function\s+([A-Za-z_$][\w$]*)\s*\(", html_js))
        for fn in sorted(pop_js):
            uses = len(re.findall(r"\b%s\b" % re.escape(fn), html_js))
            defs = len(re.findall(r"function\s+%s\b" % re.escape(fn), html_js))
            if uses - defs <= 0:
                orphan_js.append({"func": fn, "allowed": ALLOW_JS.get(fn)})

    orphan_funcs = []
    for f in files:
        for fn in sorted(public_functions(src[f])):
            # BARE NAME, not `fn(` — a callback reference like `to_thread(prune_old_nights, …)` has no
            # parenthesis, and matching one made retention and archiving read as dead.
            uses = len(re.findall(r"\b%s\b" % re.escape(fn), everything))
            defs = len(re.findall(r"def\s+%s\b" % re.escape(fn), everything))
            if uses - defs <= 0:
                orphan_funcs.append({"module": f, "func": fn, "allowed": ALLOW_FUNCS.get(fn)})
    # ── SCAN 6 · A MODULE NOTHING IMPORTS ───────────────────────────────────────────────────────────
    # 🔴 THE DIRECTION THIS TOOL COULD NOT LOOK, found 2026-08-31 while triaging the adapter-pinning
    # brief. Every scan above asks "is this FUNCTION wired". None asks "is this MODULE reachable at
    # all" — and a whole module built, tested, and imported by nothing slips through, green.
    #
    # `status_union.py` was the proof: the entire §3.6 merge layer, complete with tests, imported by
    # nothing but its own test file, and it appeared NOWHERE in this report. TWO masks operated at
    # once, which is why neither the function scan nor a reader caught it:
    #
    #   1. INTERNAL CALLS COVER THE LEAVES. `merge()` calls expected_instances / read_instance /
    #      instance_health, so each has uses=2, defs=1 and passes `uses - defs > 0`. A module's own
    #      cohesion made it look wired.
    #   2. A GENERIC NAME COVERS THE ROOT. `merge` also occurs in nightqc.py, cpap_inventory.py and
    #      capture.py, all unrelated. The word-boundary scan cannot tell those from a call.
    #
    # `adapter_pool` has the same shape: its three leaf entry points were flagged and allowlisted,
    # while `usable_pool` and `assign` were masked by internal calls the entire time — so the report
    # showed three explained orphans in a module that is wholly unreachable.
    #
    # ⚠️ IMPORT IS THE ONLY EVIDENCE ACCEPTED, and an ENTRY POINT is exempt. A module with
    # `if __name__ == "__main__"` is reachable by being RUN, so its absence from every import line
    # says nothing about it. Without that exemption every script in the tree would flag.
    orphan_modules = []
    for f in files:
        mod = f[:-3]
        text = src[f]
        if is_entry_point(text) or not public_functions(text):
            continue
        if importers(root, mod):
            continue
        orphan_modules.append({"module": mod, "funcs": sorted(public_functions(text)),
                               "allowed": ALLOW_MODULES.get(mod)})

    # ── SCAN 5 · A SUPPRESSION THAT EXCUSES NOTHING ─────────────────────────────────────────────────
    # THE BLIND SPOT IN THIS TOOL'S OWN DESIGN, found 2026-08-26 while wiring `cpap_spool.sync_spool`.
    # Every scan above answers "is this wired?"; none answers "is this EXCUSE still needed?" When a
    # function finally gets wired it simply DROPS OFF the report — and its allowlist entry, with its
    # carefully-argued reason, sits here inert and invisible. That is the exact failure this file's
    # header names ("a suppression you cannot see is how the next real finding gets hidden behind a
    # stale entry"), reached from the one direction the header did not look: not a suppression that is
    # too broad, but one whose subject no longer exists.
    #
    # It is not hypothetical bookkeeping. `sync_spool`'s entry had to be deleted BY HAND at wiring
    # time, and nothing anywhere would have said so — the report was green with the dead entry in it.
    # Worse, the entry NAMES a function, so if a future refactor reintroduces that name in a genuinely
    # unwired state, the stale excuse silences the finding on sight.
    #
    # An entry is stale when it matched nothing THIS RUN. That is the whole test, and it cannot false-
    # positive: the scans above report every unwired name, so a name absent from them is wired,
    # deleted, or renamed — and all three mean the excuse is spent.
    # Every public function DEFINED in the scanned tree, so an allowlist entry can be judged only
    # against a population that actually contains its subject.
    defined = set()
    for f in files:
        defined |= public_functions(src[f])
    stale = []
    for label, allow, reported in (
        ("ALLOW_KEYS", ALLOW_KEYS, {r["key"] for r in orphan_keys}),
        ("ALLOW_FUNCS", ALLOW_FUNCS, {r["func"] for r in orphan_funcs}),
        ("ALLOW_RENDERED", ALLOW_RENDERED, {r["key"] for r in orphan_rendered}),
        ("ALLOW_JS", ALLOW_JS, {r["func"] for r in orphan_js}),
    ):
        # ⚠️ AN ENTRY IS STALE ONLY IF ITS SUBJECT WAS IN THE POPULATION THIS SCAN ENUMERATED and is
        # no longer reported. If the
        # named function is not defined in the scanned tree at all, this scan cannot say anything
        # about it — the allowlist is a constant describing the WHOLE repo, so pointing `scan()` at a
        # subtree (or a test fixture) would otherwise mark every entry spent and make the count a
        # property of the ROOT rather than of the allowlist. `applies` is what keeps the verdict about
        # the entry. (A first attempt gated on "is this the full tree", which was the wrong axis: a
        # fixture that sets HERE to itself IS the full tree by that test, and still knows nothing
        # about `close_harvest_decision`.)
        applies = {"ALLOW_FUNCS": defined, "ALLOW_KEYS": pop_keys | pop_top_keys,
                   "ALLOW_RENDERED": pop_rendered, "ALLOW_JS": pop_js}[label]
        for name in sorted((set(allow) & applies) - reported):
            stale.append({"list": label, "name": name, "allowed": None,
                          "reason": allow[name]})

    return {"orphan_status_keys": orphan_keys, "orphan_functions": orphan_funcs,
            # The FILTER, beside the count it qualifies: which publication shapes scan 1 enumerated,
            # and how many keys each contributed. "0 unexplained" without this is a claim about an
            # unnamed population — the exact hole the top-level shape hid in.
            "examined_status_shapes": {"_set(name, key=…)": len(pop_keys),
                                       "STATUS[key]= / STATUS.setdefault(key,…)": len(pop_top_keys - pop_keys)},
            "orphan_modules": orphan_modules,
            "orphan_rendered": orphan_rendered, "orphan_js": orphan_js,
            "stale_allowlist": stale,
            # ⚠️ STALENESS IS ONLY MEANINGFUL AGAINST THE TREE THE ALLOWLIST DESCRIBES. `ALLOW_FUNCS`
            # is a module constant about THIS repo; point `scan()` at a fixture tree or a subtree and
            # every entry matches nothing and reads as spent. The count would be a property of the
            # ROOT, not of the allowlist. So the scan reports staleness always (visibility costs
            # nothing) and `--check` only ENFORCES it on a full-repo scan.
            "full_tree": os.path.abspath(root) == os.path.abspath(HERE)}


def main(argv: list[str]) -> int:
    res = scan()
    if "--json" in argv:
        print(json.dumps(res, indent=2))
        return 0
    for label, rows, fmt in (
            ("status keys published by capture.py and read by nothing",
             res["orphan_status_keys"], lambda r: "%-24s via %s" % (r["key"], r.get("shape", "?"))),
            ("public functions referenced only by tests",
             res["orphan_functions"], lambda r: "%s  %s" % (r["module"], r["func"])),
            ("fields webmon forwards that monitor.html never draws",
             res["orphan_rendered"], lambda r: r["key"]),
            ("monitor.html handlers with no control that calls them",
             res["orphan_js"], lambda r: r["func"]),
            ("modules NOTHING imports — every public function in them is unreachable",
             res.get("orphan_modules", []),
             lambda r: "%s  (%d public fn%s)" % (r["module"], len(r["funcs"]),
                                                 "" if len(r["funcs"]) == 1 else "s"))):
        live = [r for r in rows if not r["allowed"]]
        print("\n== %s ==" % label)
        for r in live:
            print("   %s" % fmt(r))
        for r in rows:
            if r["allowed"]:
                print("   (allowed) %-34s %s" % (fmt(r), r["allowed"]))
        print("   %d unexplained, %d allowed" % (len(live), len(rows) - len(live)))
        if rows is res["orphan_status_keys"]:
            # The count's FILTER, printed beside it: which shapes were enumerated, and how many keys
            # each held. A "0 unexplained" over an unnamed population is the examined-nothing shape.
            print("   shapes examined: " + " · ".join(
                "%s ×%d" % (s, n) for s, n in res["examined_status_shapes"].items()))
    print("\n== allowlist entries that excuse nothing (the suppression is spent) ==")
    for r in res["stale_allowlist"]:
        print("   %s[%r] — %s" % (r["list"], r["name"], r["reason"][:90]))
    print("   %d stale" % len(res["stale_allowlist"]))
    # ── ADVISORY BY DEFAULT, ENFORCEABLE ON REQUEST ────────────────────────────────────────────────
    #
    # A bare run always exits 0. `--check` exits 1 on anything unexplained, and that mode only became
    # honest once the allowlist was curated: on 2026-08-14 this reported 13 unexplained functions, every
    # one of which needed a human to decide whether it was a gap or a declarative constant. Failing CI
    # on that list would have trained people to silence it — the same defect one level up.
    #
    # After FOLLOWUPS §1 the count is 0 on both scans, so 0 is a floor worth defending: a NEW unexplained
    # orphan means something was just added and wired to nothing, which is precisely the class this
    # exists to catch and the moment it is cheapest to fix. The allowlist remains the escape hatch, and
    # every entry must state WHY — so silencing a finding costs a sentence of justification, not a flag.
    if "--check" in argv:
        # ⚠️ `orphan_modules` IS IN THIS SUM, and leaving it out was the first version of scan 6.
        # It printed its findings and `--check` still exited 0 — a scan that reports without gating,
        # which is the decorative half of the failure this tool exists to name. A finding nobody is
        # forced to answer is a finding that gets scrolled past.
        # ⚠️ NO `full_tree` GUARD HERE, AND I TRIED ONE FIRST. Scoping module orphans to a full-tree
        # scan looked like the right mirror of the staleness rule — but `main()` always calls `scan()`
        # with no root, so `full_tree` is unconditionally True at this point and the guard was DEAD:
        # a branch coverage cannot reach because nothing can make it false. Defensive code that cannot
        # execute is the same class of thing this tool reports; a fixture tree that should not be
        # judged says so through `ALLOW_MODULES`, which is visible, rather than through a condition
        # that silently never fires.
        n = sum(1 for r in res["orphan_status_keys"] + res["orphan_functions"]
                + res["orphan_rendered"] + res["orphan_js"] + res["orphan_modules"]
                if not r["allowed"])
        if n:
            print("\n✖ %d unexplained — wire it, or allowlist it WITH A REASON in ALLOW_KEYS/ALLOW_FUNCS/ALLOW_MODULES" % n)
            return 1
        # A spent suppression REDS, at the same severity as an unwired function, and deliberately so:
        # its cost is not cosmetic. The entry names a symbol, so it pre-silences any FUTURE finding
        # that reuses that name — a landmine armed by tidiness. Deleting it is a one-line change the
        # wiring commit should have carried, which makes this the cheapest possible red to clear.
        # ⚠️ NO SECOND GATE HERE. An abandoned first fix also required `res["full_tree"]`, and it
        # survived the rewrite as dead belt-and-braces — a condition that can only ever SUPPRESS the
        # red, on a tool whose entire subject is suppressions nobody re-checks. The scoping lives in
        # scan(), where `applies` judges an entry only against the population its own scan enumerated.
        if res["stale_allowlist"]:
            print("\n✖ %d allowlist entr%s excuse nothing — DELETE them; a spent suppression silences the "
                  "next real finding that reuses the name"
                  % (len(res["stale_allowlist"]), "y" if len(res["stale_allowlist"]) == 1 else "ies"))
            return 1
        print("\n✓ 0 unexplained — every published key and public function is wired or explained,"
              " and every allowlist entry still excuses something")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

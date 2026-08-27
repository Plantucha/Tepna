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
    "tool": "read by webmon.py and monitor.html under a quoting form scan 1 does not model",
    "oxy_lifecycle": "published to STATUS by the G4 lifecycle wiring (run_oxyii emits the acquisition "
                     "state) for /api/state inspection — the charter's STATUS half; the webmon-forward "
                     "+ monitor lifecycle indicator is a tracked follow-up, same pattern the "
                     "ring_rtc_reset_suspect draw followed, alongside the IDLE_UNWORN/PULLING hooks",
    "oxy_recording": "the RECORDING axis's STATUS half (OxyRecEngine via _rec_emit) for /api/state "
                     "inspection — the same charter pattern as oxy_lifecycle directly above, with the "
                     "same tracked monitor-draw follow-up; the close-triggered pull (DAT-AUTO-HARVEST "
                     "unit 2) is its first in-daemon consumer and lands next",
}
# Fields the API publishes that the monitor does not draw — either for a consumer OTHER than the monitor,
# or a monitor draw that is PENDING and tracked. `/api/state` is not the monitor's private channel — but
# "something else reads it" / "a draw is coming" must be STATED, not assumed. An entry here without a
# real follow-up is exactly the stale suppression this file warns against, so the tracker is load-bearing.
ALLOW_RENDERED: dict = {}

# Handlers defined in monitor.html that nothing calls. Same rule, same reason.
ALLOW_JS: dict = {}

ALLOW_FUNCS = {
    "main": "CLI entry point",
    "night_profile": "adapter_ab is an offline analysis tool, not daemon code",
    "compare": "adapter_ab analysis tool",
    "unattributable": "adapter_ab analysis tool",
    "render": "adapter_ab analysis tool",
    "analyze": "blind_spots, driven by tools/find_blindspots.py",
    "rank": "blind_spots, driven by tools/find_blindspots.py",
    "concentration": "mutation_triage, driven by the mutation programme",
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
    "assemble_spool": "acq_evidence_cpap Phase B — the spool evidence assembler, honestly recorded as "
                      "tested-not-witnessed; its consumer is the FIRST WITNESSED PULL (CPAP-SPOOL-"
                      "ACQUISITION Do-1/Do-2), which needs the device. Retire this when that pull lands",
    "hdev": "allan.py — overlapping HADAMARD deviation (Baugh 1971 / Riley SP 1065). Its sibling `adev` "
            "IS wired (nightqc); hdev is the drift-tolerant variant, available for an analysis that has "
            "not yet needed it. Retire this when a caller quotes H-sigma, or delete if none ever does",
    "read_edf": "cpap_edf — the round-trip partner of `write_edf` (which IS wired, cpap_edf_writer). It "
                "exists so `write_edf(read_edf(x)) == x` is provable byte-for-byte; the tests are its "
                "legitimate consumer. Retire only if that property stops being asserted",
    "message_call_lines": "mutation_triage — ⚠️ MY OWN EARLIER REASON HERE OVERSTATED IT as 'consumed "
                          "through the documented contract'. It is NOT consumed: `classify`'s docstring says "
                          "callers that have the source pass `lineno in message_call_lines(src)`, and "
                          "tools/mutate_triage.py calls `classify(a, b)` at both sites without it — so every "
                          "mutant on a CONTINUATION line of a multi-line log call is still judged REACHABLE. "
                          "The blocker is concrete: that caller has the module PATH but not the mutant's LINE "
                          "NUMBER (mutmut_diff yields only the +/- lines), so wiring needs the lineno "
                          "extracted first. Retire by doing that.",
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
    "flush_gate": "oxy_transfer §14a — the wait-for-run_status-3→1 decision for the close-triggered "
                  "pull; standalone until unit 2's orchestration calls it. Sibling of pull_deadline and "
                  "landed for the same reason: it is the rule that keeps the harvest from firing "
                  "systematically pre-trailer, and it is a pure decision that is far easier to pin "
                  "before a caller exists than after",
    "pull_deadline": "oxy_transfer §8a — the abort deadline for the close-triggered held-link pull; "
                     "standalone until unit 2 wires it (DAT-AUTO-HARVEST §14: wait for run_status "
                     "3→1, which=latest). Deliberately landed AHEAD of its caller: it is the safety "
                     "predicate that makes 'a pull must never delay the power drop' impossible by "
                     "construction, and the 50 s window it guards leaves no room to add it later",
    "oxy_is_finalized": "redundant — pull_session.py already gates re-pulls on finalisation via "
                        "parse_trailer, which that caller needs anyway for the device summary",
    "busy_with": "redundant — offline_lock.slot() raises OfflineBusy(_busy), so the label already "
                 "reaches callers as e.holder",
    "predict_step_split": "research helper from O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS §2, driven by its "
                          "brief rather than by the daemon — same shape as blind_spots.analyze",
    # ── investigated 2026-08-15 (FOLLOWUPS §1). The three O2Ring request/response pairs split three
    # ways, and the docstrings answered it: `info` was WIRED (firmware provenance the code said mattered
    # and nothing recorded), these two were not.
    "battery_frame": "superseded — parse_battery's own docstring says byte[1] matches the live header's "
                     "battery percent, which the live path already reads every frame",
    "parse_battery": "superseded by the live header — see battery_frame",
    "config_frame": "a diagnostic, not provenance: 'verifying the ring's config on the box without the "
                    "vendor app'. Read-only; no SET_CONFIG writer ships. Wire it if a config audit is "
                    "ever wanted, not before",
    "parse_config": "diagnostic — see config_frame",
    "is_offline_cmd": "the READ half of a write/read pair whose write half IS used — `as_offline` sets "
                      "the bit in probe_verity_offline and probe_verity_survey; nothing needs to ask "
                      "the question back. Same shape as busy_with",
    # ── CPAP-over-BLE pull core (CPAP-BLE-CAPTURE-2026-08-21-BRIEF). as11_link.py + as11_pull.py are the
    # pure, clean-room AS11 protocol layer; their only consumer is the UN-COMMITTED operator probe
    # `cpap_ble_pull.py` (which wires bleak + the real AES cipher against the device). Same shape as the
    # config_frame / is_offline_cmd probe-only entries: a protocol builder used solely by a probe reads
    # as "unwired" by this scan's daemon-centric definition, which the header calls legitimate. Only the
    # 5 whose bare name has no internal cross-reference surface; the rest (fig_frame, session_key,
    # establish, …) is wired module-internally.
    "fig_unframe": "CPAP-BLE pull core — reassembles device notifications in the operator probe (see note)",
    "start_key_exchange": "CPAP-BLE pull core — SRP pairing builder, used by the pairing probe (see note)",
    "confirm_key_exchange": "CPAP-BLE pull core — SRP pairing builder, used by the pairing probe (see note)",
    "get_items": "CPAP-BLE pull core — the Get RPC builder; the probe's live encrypted-Get validator (see note)",
    "pull_spool": "as11_pull — SUPERSEDED, and retained as the protocol-level reference its tests pin. "
                  "⚠️ THE PREVIOUS REASON WAS FALSE: it claimed the operator probe calls this, and "
                  "code-uses measured ZERO. Production drives the spool through cpap_spool.sync_spool "
                  "-> as11_pull.pull_spool_round, which adds the ledger/promote/cursor transaction this "
                  "bare multi-round loop has no notion of; cpap_spool.py's own header records that it "
                  "was built because this function was wired into nothing. Retire by deleting it (with "
                  "its tests) once nobody wants a transaction-free reference driver — a decision, not a "
                  "cleanup.",
    "start_stream": "CPAP-BLE pull core — the StartStream (live waveform) RPC builder, used by the stream probe (see note)",
    "stream": "CPAP-BLE pull core — the live StreamData waveform consumer the operator stream probe drives (see note)",
    "make_cipher": "CPAP-BLE pull core — the AES-256-CBC seal/unseal the daemon/probe inject into the stdlib-only protocol layer (see note)",
    # cpap_edf.py is the bit-accurate ResMed EDF/EDF+ WRITER (STR/BRP/PLD/EVE from captured data). Its
    # read/write core is exercised module-internally and by the byte-identity gate; these per-type
    # CONSTRUCTORS are the public creation API, consumed by the tests today and the BLE→EDF capture
    # wiring next (the same shape as the AS11 protocol builders above).
    "build_brp": "CPAP EDF writer — constructs a bit-accurate BRP.edf (flow+pressure) from captured data",
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
            consumers += open(p, encoding="utf-8").read()

    orphan_keys = []
    if "capture.py" in src:
        for key in sorted(status_keys(src["capture.py"])):
            if re.search(r"\b%s\b" % re.escape(key), consumers):
                continue
            orphan_keys.append({"key": key, "allowed": ALLOW_KEYS.get(key)})

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
        for fn in sorted(set(re.findall(r"function\s+([A-Za-z_$][\w$]*)\s*\(", html_js))):
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
    return {"orphan_status_keys": orphan_keys, "orphan_functions": orphan_funcs,
            "orphan_rendered": orphan_rendered, "orphan_js": orphan_js}


def main(argv: list[str]) -> int:
    res = scan()
    if "--json" in argv:
        print(json.dumps(res, indent=2))
        return 0
    for label, rows, fmt in (
            ("status keys published by capture.py and read by nothing",
             res["orphan_status_keys"], lambda r: r["key"]),
            ("public functions referenced only by tests",
             res["orphan_functions"], lambda r: "%s  %s" % (r["module"], r["func"])),
            ("fields webmon forwards that monitor.html never draws",
             res["orphan_rendered"], lambda r: r["key"]),
            ("monitor.html handlers with no control that calls them",
             res["orphan_js"], lambda r: r["func"])):
        live = [r for r in rows if not r["allowed"]]
        print("\n== %s ==" % label)
        for r in live:
            print("   %s" % fmt(r))
        for r in rows:
            if r["allowed"]:
                print("   (allowed) %-34s %s" % (fmt(r), r["allowed"]))
        print("   %d unexplained, %d allowed" % (len(live), len(rows) - len(live)))
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
        n = sum(1 for r in res["orphan_status_keys"] + res["orphan_functions"]
                + res["orphan_rendered"] + res["orphan_js"] if not r["allowed"])
        if n:
            print("\n✖ %d unexplained — wire it, or allowlist it WITH A REASON in ALLOW_KEYS/ALLOW_FUNCS" % n)
            return 1
        print("\n✓ 0 unexplained — every published key and public function is wired or explained")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

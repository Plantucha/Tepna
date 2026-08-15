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
    python3 tools/find_unwired.py            # report
    python3 tools/find_unwired.py --json     # machine-readable
"""
from __future__ import annotations

import ast
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Modules that CONSUME device status. A key published by capture.py and named in none of these reaches
# no operator, no alert and no report — which is the whole finding.
CONSUMERS = ("webmon.py", "alerts.py", "nightqc.py", "timeline.py", "telemetry.py",
             "diskguard.py", "cpap_harvest.py", "monitor.html")

# Known-intentional, with the reason. Anything here is reported as ALLOWED rather than silently dropped:
# a suppression you cannot see is how the next real finding gets hidden behind a stale entry.
ALLOW_KEYS = {
    "tool": "read by webmon.py and monitor.html under a quoting form scan 1 does not model",
}
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
                everything += open(os.path.join(dirpath, n), encoding="utf-8", errors="replace").read()

    orphan_funcs = []
    for f in files:
        for fn in sorted(public_functions(src[f])):
            # BARE NAME, not `fn(` — a callback reference like `to_thread(prune_old_nights, …)` has no
            # parenthesis, and matching one made retention and archiving read as dead.
            uses = len(re.findall(r"\b%s\b" % re.escape(fn), everything))
            defs = len(re.findall(r"def\s+%s\b" % re.escape(fn), everything))
            if uses - defs <= 0:
                orphan_funcs.append({"module": f, "func": fn, "allowed": ALLOW_FUNCS.get(fn)})
    return {"orphan_status_keys": orphan_keys, "orphan_functions": orphan_funcs}


def main(argv: list[str]) -> int:
    res = scan()
    if "--json" in argv:
        print(json.dumps(res, indent=2))
        return 0
    for label, rows, fmt in (
            ("status keys published by capture.py and read by nothing",
             res["orphan_status_keys"], lambda r: r["key"]),
            ("public functions referenced only by tests",
             res["orphan_functions"], lambda r: "%s  %s" % (r["module"], r["func"]))):
        live = [r for r in rows if not r["allowed"]]
        print("\n== %s ==" % label)
        for r in live:
            print("   %s" % fmt(r))
        for r in rows:
            if r["allowed"]:
                print("   (allowed) %-34s %s" % (fmt(r), r["allowed"]))
        print("   %d unexplained, %d allowed" % (len(live), len(rows) - len(live)))
    # ADVISORY. Always 0 — see the module docstring. A hard gate here fails on every declarative
    # constant and CLI entry point, and a gate people silence is worse than no gate.
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

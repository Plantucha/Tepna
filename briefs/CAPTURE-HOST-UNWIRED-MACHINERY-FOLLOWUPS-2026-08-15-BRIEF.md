<!--
  CAPTURE-HOST-UNWIRED-MACHINERY-FOLLOWUPS-2026-08-15-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-15

# What executing the unwired-machinery brief surfaced that auditing it did not

> Spawned by closing `CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14-BRIEF.md` (DONE 2026-08-15, eight PRs).
> Everything here came from *running* the work, not from the audit that planned it.

## 1 · The 7 remaining orphans are three protocol PAIRS, not scattered dead code

`tools/find_unwired.py` on `origin/main` reports **7 unexplained, 5 allowed**, and the 7 are coherent:

| | |
|---|---|
| `oxyii.info_frame` + `parse_get_info` | request builder **and** response parser |
| `oxyii.config_frame` + `parse_config` | request builder **and** response parser |
| `oxyii.battery_frame` + `parse_battery` | request builder **and** response parser |
| `polar_pmd.is_offline_cmd` | *"True when a control-point command targets onboard recording rather than the live stream"* |

Three **complete, symmetric O2Ring capabilities** — implemented, tested, and never issued. That is a
different claim from "seven dead functions", and it changes the question from *delete or keep* to *why
was the command never sent*. The probes do not use them either: the scan reads `probe_*.py`.

- [ ] Establish for each pair whether the command was superseded (the live `0xA5` frame path already
      carries what it would return), or simply never wired. §5's pattern applies — investigate, then
      either wire or allowlist **with the reason**, so the next reader spends a line rather than a
      re-investigation.
- [ ] `is_offline_cmd` sits next to the offline-recording work (`POLAR-OFFLINE-DOWNLOAD`,
      `POLAR-ONBOARD-BACKUP`). Decide whether it is a leftover of a path that was abandoned or a piece
      of one still open.

## 2 · The detector committed its own defect class three times

This is the most useful thing the brief produced, and it is evidence rather than an anecdote: the class
recurs **inside the tool built to catch it**, and every instance was invisible until the tool was
pointed at an input other than the convenient one.

| bug | why it is the same class |
|---|---|
| `_pyfiles()` read module-level `HERE`, ignoring `scan(root)` | a **decorative parameter** — accepted, ignored, and the caller believes it took effect |
| `def scan(root=HERE)` binds at **def time** | `main()` could not be redirected at all; patching the constant changed nothing |
| the allowlist **named** the functions it excused | `os.walk` read `tools/` into the corpus, so each entry counted as a usage and the row **vanished** instead of printing as `(allowed)` — the exact inversion of its stated design |

The first two surfaced only against a synthetic tree; the third only by *using* the allowlist. All three
would have passed any review of the source.

- [ ] Consider whether the detector earns a CI job. It is deliberately advisory and exits 0 (a gate that
      fails on declarative constants trains people to silence it) — but "advisory" currently also means
      "seen only by whoever runs it", which is the same visibility problem as the `mutation
      (diff-scoped)` red that merges unnoticed.

## 3 · `land-pr.mjs` stalls on a pending check that cannot block the merge

Measured twice on 2026-08-14, costing **~90 minutes** across #1259 and #1269: both timed out at 45 min
with `still UNSTABLE` / `EXIT=1` while `mutation (diff-scoped)` was **pending**. That context is not in
the required set, so both PRs were mergeable throughout — #1259 merged *instantly* the moment auto-merge
was armed, with 22 passing and that one still pending.

The tool's decision core distinguishes four states — `BEHIND` · `BLOCKED` with runs in flight ·
`UNKNOWN` mergeability · a never-reported required context — but not **"pending check outside the
required set"**.

- [ ] Teach it the required-context set (`gh api repos/…/rulesets`) and treat a pending non-required
      check as ignorable rather than as a reason to wait.
- [ ] Until then, prefer arming auto-merge and keeping the branch current; `BEHIND` is the only state
      that actually stalls a green PR under `strict = true`.

## 4 · A green local gate is evidence about this machine

Two of the three second-run failures were **environment-dependent**, and both read 100 % locally:

- §3's missing branch existed because `/usr/local/lib/tepna` is present on the dev box and absent on CI,
  so the real scan walked the safe-helper path incidentally here and never there;
- the same directory being present-but-empty earlier the same day made a deploy check behave differently
  than it will on any other machine.

- [ ] Worth stating in `CONTRIBUTING.md` next to the coverage floor: a 100 % local run on a machine that
      has been used as a capture host is a weaker claim than the same number from CI.

## 5 · Done when

- [ ] §1's three pairs are wired or allowlisted with reasons, and the detector's unexplained count
      reaches 0 or a stated floor.
- [ ] §2's CI question is answered either way, in writing.
- [ ] §3 is fixed in `land-pr.mjs` or its limitation is documented where the tool is invoked.

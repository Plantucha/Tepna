<!--
  CAPTURE-FILESET-RESUME-2026-08-19-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-19 · **Follows:** `VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md` (§P2.2 — the one P2 item its 2026-08-19 verification left open)

# Resume the file-set on reconnect — the last open P2 item, remeasured before proposing

> **Scope:** `capture-host/` only — no Dex bundle, `manifestHash`, or provenance impact.
> **Gate:** `capture-host/check.sh` (ruff · shellcheck · pytest `--cov --cov-branch --cov-fail-under=100`).

## 1 · The problem, measured 2026-08-19 (not inherited from the July night)

P2.2 was written off one bad night (189 O2Ring sets under a wedged adapter). The full corpus says it is
the **steady state**, not the bad night:

| device | nights | sets/night median | p90 | max | total sets |
|---|---|---|---|---|---|
| Polar H10 | 25 | 6 | 34 | 45 | 291 |
| Polar Verity Sense | 25 | **15** | **238** | 347 | 1,487 |
| Wellue O2Ring-S | 26 | 10 | 28 | 64 | 376 |

**2,154 file-sets where 76 (one per device-night) would be ideal — 28.3× fragmentation**, ~10,000 excess
files at ~5 streams/set.

⚠ **The dominant driver is no longer the flapping link P2.2 named — it is the `drop_not_worn` duty
cycle.** A doffed Verity is dropped after 180 s, rechecked every 90 s, and every recheck-reconnect mints a
full new file-set. That machinery is *correct* (it ended the streaming-into-a-desk defect) and its cadence
sits **inside** the resume window below, so resume collapses exactly the churn it generates. Any design
that only handles link flaps misses the majority case.

## 2 · Design (P2.2's sketch, confirmed against today's code)

- **Resume, same device + same night, when the gap < `resume_window_sec` (default 300).** The PPG grid
  writer already inserts honest gap rows — a reconnect is just a larger gap. Reopen the *existing*
  file-set in append mode and write a gap row spanning the outage.
- **A true outage (≥ window) starts a fresh set — that boundary is correct and stays.** The 37/75-minute
  wedges of 2026-07-23 should still fragment; that fragmentation is *information*.
- **`link_epoch` still increments per reconnect** (E5) — resume must not hide relinks from the LINK
  sidecar; it changes only where the *samples* land.
- **The session stamp in the filename stays the set's FIRST connect** — a resumed set keeps its name, so
  every name-keyed consumer (trio-batch, the regen tools, QC) sees one set where it saw many.

## 3 · What must NOT regress (each is a test, not a hope)

1. **Gap accounting** — nightqc coverage on a resumed set must equal coverage over the fragments it
   replaces (same denominator, same holes). Plant a synthetic reconnect; assert equality.
2. **Clock Contract** — the resumed writer must not re-anchor `t0Ms`; stamps continue on the same axis.
   §2.6: the gap row is *visible absence*, never interpolation.
3. **Sidecars** — PMDARRIVAL/LINK rows keep flowing per connection; only the payload files merge.
4. **The duty-cycle interaction** — a doff→recheck→reconnect cycle (90 s cadence) must resume, and the
   doff-pull trigger (`notworn_pull_due`, #1473) must still fire on the *drop*, unaffected by where
   samples land afterwards.
5. **Mid-set crash** — a resume onto a file whose last write was torn must not corrupt the set; append
   after validating the tail or start fresh with the outage recorded.

## 4 · Explicitly out of scope

- Retroactive merging of the existing 2,154 sets (the analysis tools already walk multi-set nights).
- Any change to `drop_not_worn` itself — its 91-events/7-days behaviour is measured and wanted.

## Done when

- [ ] A planted reconnect inside the window lands in the SAME file-set with a gap row; outside the window
      starts a fresh set. Both directions tested.
- [ ] nightqc coverage is byte-equal between a resumed night and its fragmented twin (planted).
- [ ] A real Verity duty-cycle night (median 15 sets today) captures as ~1 set, measured on the box.
- [ ] `check.sh` green at 100 % branch coverage; every §3 invariant has its own test.

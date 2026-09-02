<!--
  CAPTURE-FILESET-RESUME-2026-08-19-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS (core shipped #1532; **field-verified 2026-09-02 — Verity median 2 sets/night, range 1–3, over 14 nights on vigil, against this brief's own pre-feature baseline of 15**: the feature works in the field. The 2026-08-26 DONE stamp was PREMATURE rather than wrong — the code had shipped and does what it claims, but two acceptance items had no evidence and one still does not. Remaining: §3.1's coverage-equality test, which closes boxes 2 and 4 together, plus box 1's gap-row case. **Owner:** Heron) · **Created:** 2026-08-19 · **Follows:** `VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md` (§P2.2 — the one P2 item its 2026-08-19 verification left open)

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
      starts a fresh set. Both directions tested. **PARTLY VERIFIED 2026-09-02:** both window directions are
      tested (`test_resumable_stamp_finds_the_set_inside_the_window` + the outside-window `is None` case), and
      `test_stream_writer_resumes_without_a_second_header` pins the append; **the gap-row half has no test.**
- [ ] nightqc coverage is byte-equal between a resumed night and its fragmented twin (planted).
      **OPEN — verified absent 2026-09-02:** no test in `tests/test_nightqc.py` compares coverage between a
      resumed night and a fragmented twin (searched the concept, not a name). This is §3.1's invariant and it
      is this brief's ONE real remaining work item.
- [x] A real Verity duty-cycle night captures as **2 sets (median; range 1–3, n = 14 nights)**, measured on
      vigil 2026-09-02 by counting distinct 14-digit set stamps per device per night, against the pre-feature
      baseline of median 15. ⚠️ The item as written asked for “~1 set” and the measured answer is **2** —
      recorded as measured rather than rounded to the target, because a night with a genuine long gap SHOULD
      mint a fresh set: that is §2's window rule working, not a shortfall. 2 is the honest number and the
      better target.
- [ ] `check.sh` green at 100 % branch coverage; every §3 invariant has its own test. **PARTLY VERIFIED
      2026-09-02:** the 100 % floor is real and CI-enforced, and §3.2's no-re-anchor invariant is tested
      (`test_resumed_ecg_keeps_its_relative_ms_anchor`); this box fails ONLY on §3.1, i.e. it closes with the
      box-2 test above and needs nothing else.

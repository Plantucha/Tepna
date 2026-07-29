<!--
  MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS-2026-07-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-29 · **Follows:** `MULTINIGHT-CORPUS-FINDINGS-2026-07-29-BRIEF.md` (DONE 2026-07-29, all four sections merged as PRs #527–#530)

# What executing MULTINIGHT-CORPUS-FINDINGS surfaced

The parent is closed: four defects found by folding 37 trio nights + 197 CPAP nights, all four fixed
and merged. This brief is the residue — the questions the fixes **unblocked** rather than answered,
the capture-side causes nobody has chased, and the process facts that would otherwise live only in a
chat transcript.

---

## 1 · Now measurable, because §1 landed

### 1.1 · OxyDex's periodic-breathing detector and the device's CSR do not agree

Before §1, `periodicBreathingPct` was `0.00` on all 197 nights, so there was nothing to compare
against. Now there is, and the two disagree — possibly badly:

| | mean OxyDex `periodic_breathing` events |
|---|---|
| the 4 trio nights the device scored CSR > 0 | **5.0** |
| the 33 it scored CSR = 0 | **12.7** |

`r(device CSR minutes, OxyDex PB episodes) = −0.21` over 37 paired nights. The correlation is **the
wrong sign**: OxyDex flags fewer PB episodes on exactly the nights the machine scored Cheyne-Stokes.

This may be correct behaviour by both — an SpO₂-derived oscillation and a flow-derived CSR span are
different constructs, and the device scores CSR from flow it can see directly while OxyDex infers it
from desaturation rhythm. But it is currently **unexamined**, it is a 4-night sample, and OxyDex's
impression string says "CS pattern likely — review CPAP pressure" on 28 of 37 nights while the device
says CSR on 4. **Do:** with §1 merged, re-fold the corpus and compare episode-by-episode against the
CSL spans — do OxyDex's episodes fall *inside* the device's CSR windows on the nights both fire? If
they do not overlap in time at all, one of the two detectors is measuring something else, and the
"review CPAP pressure" advice is resting on it.

### 1.2 · Device AHI does not predict oximetric burden on this corpus

`r(AHI, ODI3) = 0.06`, `r(AHI, hypoxic burden) = −0.05`, `r(AHI, nadir) = −0.02` over 37 paired
nights. Concretely: 2026-06-14 scored AHI **1.11** (excellent) with ODI3 8.4 / burden 16.8 / nadir
85 %; 2026-07-23 scored AHI **8.00** (the corpus worst) with ODI3 2.9 / burden 0.9 / nadir 87 %. Two
devices, same nights, opposite verdicts.

This is a **fusion** question (`briefs/INTEGRATOR-BUILD-BRIEF.md`) and the literature is on its side
(hypoxic burden and AHI are not interchangeable predictors), but it is one subject and must not be
graded above its tier. **Do:** route to `PAPERS-ROADMAP` as a real-validation candidate; do **not**
surface a claim about it in any node until it has more than n=1 subject.

---

## 2 · Capture-side causes nobody has chased (out of suite, `capture-host/`)

### 2.1 · What broke the O2Ring motion column on 2026-07-16..18, and what fixed it?

§3 shipped a detector for a **stuck** motion column, which is a guard, not a cure. The underlying
fault is unexplained: the live BLE stream wrote a motion field that never returned to zero for three
nights (07-16 and 07-17 totally, 07-18 partially), while the device's **own onboard `.dat` for the
same nights is 94–98 % zero**. Then it healed by itself from 07-19 and has been clean since.

An intermittent capture-side corruption that fixes itself is the worst kind to leave: it will come
back, and the next occurrence will be silently guarded rather than noticed. **Do:** diff `capture.py`
across 07-15 → 07-19, and check whether the motion byte is being read from a different offset, scaled,
or carried over from a stale frame on reconnect. The `.dat` path being simultaneously correct is the
strongest available clue — the same device, the same night, one decode right and one wrong.

### 2.2 · The reconnect storm

capture.py opens a new file per BLE reconnect: 2026-07-16/17/23 produced **42 / 73 / 99** separate
O2Ring `_SPO2.csv` fragments. Downstream that pushed 07-17 and 07-23 past OxyDex's `durationInflated`
guard (23,228 samples across an 11.5 h span; 7,350 across 6.9 h) and dragged ECG analyzable to
57 % / 72 %. `VIGIL-RECONNECT-BACKOFF-AND-LINK-COUNT-2026-07-20-BRIEF.md` is the existing owner —
this corpus hands it three dated, quantified cases it did not have.

---

## 3 · Unclaimed data on hardware we already own

- **CPAPDex parses past `Arousal`.** The AirSense EVE vocabulary is exactly `Central Apnea ·
  Hypopnea · Obstructive Apnea · Arousal · Recording starts`. The first three are indexed; `Arousal`
  is dropped on the floor. An arousal index is a standard PAP-report metric and the data is already
  on the card, parsed and discarded.
- **`reraIndex` reports a measured-looking `0`** on all 197 nights because this device emits no RERA
  label at all. Unlike §1's PB, there is no better source — but `0` still asserts a measurement that
  was never made. It should be `null`. Small, isolated, deliberately not bundled into §1.
- **`SA2.edf` carries `SpO2.1s` + `Pulse.1s`** — a second, wired, drop-free oximetry source over the
  identical interval, every night. Already logged as `CPAP-AUTOHARVEST-FOLLOWUPS` §2; cross-referenced
  here because this corpus is what makes it worth doing (the ring spends 17 % of nights below −85 dBm,
  and 07-16/17/23's fragmentation is exactly the failure a wired source would not have).

---

## 4 · Process facts worth keeping

- **A brief's fix sketch is a lead, not an instruction — again.** §3 prescribed flagging
  `motionPct == 100`. The fault turned out to be per-*source*, not per-night: a folded night merges
  the broken live stream with the healthy `.dat`, so its zero-fraction is a healthy-looking 50–63 %
  and any fraction test is blind. The first implementation, built faithfully to the brief, **shipped
  green and missed 2026-07-17** — one of the two nights it existed for. Only measuring the longest
  unbroken run (110/366/302 min faulted vs 3–13 s healthy, ~500× apart) found a threshold that could
  be *read off a gap* rather than chosen. This is the third time in this repo's history that a brief's
  own prescription was the wrong shape; it is now reliable enough to expect.
- **`--ours` on `provenance/*.json` during a rebase is a GATE-B trap.** Resolving a bundle conflict by
  taking upstream is right for bytes and **wrong for the ledger**: it left `provenance/OxyDex.json`
  carrying the previous PR's `outputHash` while the committed export held this PR's bytes. GATE B
  caught it (`1513466c0031193c ≠ recorded a290a0461e828ad6`) and `regen-oxydex-goldens.mjs`
  re-recorded it. Worth a line in `CONTRIBUTING.md`: after any rebase that touches a provenance
  fragment, re-run the node's regen tool before trusting the gate.
- **`npm run check` includes `typecheck`, and the suite does not.** Nulling three fields in §3 passed
  4231 assertions, both build gates and the provenance gate locally, then **failed CI on `tsc`**.
  Running the suite is not running the gate. (`.filter(Boolean)` also does not narrow in TS's JS mode
  — cast the whole chain, not the source array.)
- **Same-app work units serialize even in separate worktrees.** §3 and §4 both re-bundle `OxyDex.html`
  and re-stamp `provenance/OxyDex.json`; the second needed a rebase plus `build.mjs --app OxyDex`
  before its gates meant anything. CLAUDE.md §👥.3 says this; it is cheap to forget when the *source*
  edits are in different functions and do not conflict textually.
- **A mutation check on a new test group is worth the five minutes.** §C1's group (a sibling brief,
  same session) asserted an invariant that would have passed against the *old* code, because the
  synthetic disturbance was broadband noise and a peak-picker does not move on noise. The mutation
  assertion caught it. Every new invariant group should carry one.

---

## 5 · Done when

- [ ] §1.1 answered: OxyDex PB episodes compared episode-by-episode against the device's CSL spans on
      the nights both fire, with a verdict on whether they overlap in time at all.
- [ ] §2.1 answered: the `capture.py` change that broke and unbroke the motion byte is identified, or
      the search is recorded as exhausted so the next occurrence is not re-investigated from scratch.
- [x] `reraIndex` returns `null` where the source emits no RERA label (§3), in its own change. **DONE 2026-07-29** — scoped, not blanket: the synthetic golden that genuinely carries a RERA keeps its number, the multi-night sibling pools before deciding, and the self-test pins both directions. Three fixtures regenerated.
- [ ] §4's two operational lessons (`--ours` on provenance, `npm run check` ≠ the suite) are in
      `CONTRIBUTING.md`, not only here.
- [ ] §1.2 routed to `PAPERS-ROADMAP` rather than surfaced in a node.

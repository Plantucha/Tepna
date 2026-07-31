<!--
  MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS-2026-07-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-07-31 (**§1.2, §2.1, §3-reraIndex and §4 all closed**; see §6 for §2.1's answer. The ONLY open item is **§1.1, which is BLOCKED and owned elsewhere** — the PB-vs-CSR comparison is void until the ~39 min CPAP clock offset is handled, and `CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md` owns that. This brief flips to DONE when that lands and the re-run happens; it is not waiting on any work of its own.) · **Created:** 2026-07-29 · **Follows:** `MULTINIGHT-CORPUS-FINDINGS-2026-07-29-BRIEF.md` (DONE 2026-07-29, all four sections merged as PRs #527–#530)

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

- [ ] §1.1 answered — **BLOCKED, and the attempt found something bigger.** The episode-by-episode
      comparison was run: 0 of 20 PB episodes overlap a device CSR span. That result is **void as
      measured** — cross-correlating CPAP events against two independently host-captured nodes shows
      the CPAP clock is **~39 min slow** (6.21x over floor at +39.5 min vs OxyDex, 4.28x at +38.0 min
      vs ECGDex, 27 of 32 nights agreeing individually). The 0/20 was measuring the clock, not the
      detectors. Re-run once the offset is handled — see `CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md`,
      which now owns it.
- [x] **§2.1 ANSWERED 2026-07-31 — see §6. Not intermittent, not self-healing: a byte-offset swap.**
      `oxyii.py` read live-header byte **[7] (perfusion index) as motion**; motion is **[11]**. Introduced
      2026-07-16 with the first live BLE motion capture, corrected 2026-07-18 17:32 by `94d186e`. The
      window matches exactly, including why 07-18 was *partial*.
- [x] `reraIndex` returns `null` where the source emits no RERA label (§3), in its own change. **DONE 2026-07-29** — scoped, not blanket: the synthetic golden that genuinely carries a RERA keeps its number, the multi-night sibling pools before deciding, and the self-test pins both directions. Three fixtures regenerated.
- [x] **§4 DONE 2026-07-31.** Both lessons, plus the worktree-serialization and mutation-check ones,
      are now `CONTRIBUTING.md` §4.1.
- [x] **§1.2 ROUTED 2026-07-31** — `PAPERS-ROADMAP-2026-06-24-BRIEF.md` **§2.7**, as a REAL n-of-1 real-validation candidate, with the "no node surfaces it until n > 1 subject" condition carried across.

---

## 6 · §2.1 ANSWERED (2026-07-31) — a byte-offset swap, not an intermittent fault

§2.1 called this *"an intermittent capture-side corruption that fixes itself"* and predicted the worst:
it will come back. **It will not.** It was never intermittent and it never healed — it was a fixed
decode error with a definite beginning and a definite end.

**`oxyii.py` read O2Ring live-header byte `[7]` as motion. `[7]` is the PERFUSION INDEX; motion is
`[11]`.** The two were swapped.

| | |
|---|---|
| introduced | **2026-07-16** — `1284897` / `483c56f`, the commits that first wrote live BLE motion at all |
| corrected | **2026-07-18 17:32** — `94d186e`, after `ededb60` recorded byte `[11]` so it could be identified |

That bracket matches the observed fault exactly, including the detail §2.1 flagged as odd: **07-16 and
07-17 totally faulted, 07-18 *partially*** — because the fix landed at 17:32 on the 18th, part-way
through that day's capture. Clean from 07-19 onward.

### 6.1 It also explains both clues §2.1 could not place

**Why the column "never returned to zero."** A perfusion index is a continuously non-zero physiological
quantity. Measured on a real 5288-row night, `[7]` is non-zero in **99.9 %** of frames (mean 13.6 ⇒
PI 1.36 %); `[11]` is zero in 249/271. A sleeping subject's motion is mostly zero, a perfusion index
never is — so reading PI as motion produces exactly the stuck-high column observed.

**Why the `.dat` was simultaneously correct.** §2.1 called this *"the strongest available clue — the
same device, the same night, one decode right and one wrong."* It was: the fault was in the **live BLE
header decode only**. The onboard `.dat` has its own layout and never went through the swapped offsets.
The clue pointed straight at the answer.

### 6.2 The blast radius, and why nothing more is owed

`OxyDex` excludes artifact samples with `r.motion === 0`, so on Vigil-captured files from that window
the filter was keeping ~0.1 % of samples. **Files written before 2026-07-18 17:32 carry PI in the
Motion column** — already documented at the decode site in `oxyii.py`, and already guarded downstream
by the stuck-column detector §3 shipped. That detector remains worth having: it is source-agnostic and
would catch a *different* cause of the same symptom.

**No follow-up.** The cause is identified, fixed, documented at the decode site, and guarded. The one
thing §2.1 asked for that is now moot is the diff of `capture.py` across 07-15 → 07-19: there are **no
`capture.py` commits at all** on 07-16, 07-17 or 07-18, which is itself why that search would have come
back empty — the bug was one file over, in `oxyii.py`.

### 6.3 A note on how this was found, since §4 collects those

The first promising lead was a `wear-gate` added and then reverted (`77358b8` → `e3f5a7a`) — an
add-then-revert pair is exactly the shape of a fault that appears and disappears. **Both are dated
2026-07-20**, after the window closed, so the lead was eliminated on dates alone before any diff was
read. Checking timestamps first cost nothing and skipped a plausible wrong answer.

<!--
  PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-03 (**§6: 2 of 4 closed** — the jitter bound is re-based on a re-derivation, and CVHR is adjudicated at 7/7 sleep nights inside the band but n=7 < the ≥10 bar. Open: the shipped sdnnNote string and the RMSSD-surfacing decision, both owner calls.) · **Created:** 2026-08-03 · **Follows:** `O2RING-FINGER-HRV-VALIDATION-2026-07-21-BRIEF.md` §8/§8.6 · **Verdict doc:** `docs/PPGDEX-FINGER-HRV-VALIDATION-2026-08-03.md` · **Apparatus:** `tools/ppi-jitter-vs-ecg.mjs`

# Two published PPG reference figures do not reproduce, and the jitter budget says why nothing can promote

Executing `O2RING-FINGER-HRV-VALIDATION` §3 settled its own question — **no metric promotes** — and left
three things that outlive it.

## 1 · Two reference figures do not reproduce under the committed apparatus

| claim | where it lives | measured 2026-08-03 |
|---|---|---|
| Verity PPI-jitter **5.92 ms** | `PPGDEX-ALGORITHM-DEEP-DIVE` §2.1 table, `[CORPUS]` | **8.36 ms** (+41 %) |
| `sdnnRobust` **~+3.5 % vs ECG truth** | **shipped string**, `ppgdex-dsp.js` `hrv.time.sdnnNote` | **+18.7 %** on the Verity |

**Neither gap can be attributed today**, and that is the actual problem. The deep-dive's §2.2 apparatus
was never committed — §2.2 names the method and no tool — so corpus, method, or the original figure could
each explain it and nothing can distinguish them.

The second figure is the urgent one: it **ships to users** as guidance (*"use `sdnnRobust` for cross-node
SDNN comparison"*), and `PPGDEX-ALGORITHM-DEEP-DIVE` §5 additionally uses 5.92 ms as a **regression bound**
(*"no change may raise median jitter above 5.92 ms"*) — a gate whose threshold this corpus does not
reproduce.

**Do:** re-derive both on the current corpus with `tools/ppi-jitter-vs-ecg.mjs`, or explain the gap. If
they cannot be re-derived, the shipped string owes a correction (compute-path edit, user-facing accuracy
claim — the `OXYDEX-PB-OVERCALL` §4.3 precedent applies: state an observation, not an unearned number) and
§5's bound owes a re-basing. **Do NOT** simply overwrite either with 8.36 / +18.7 %: this apparatus has
been wrong three times (§3 below), and a second unverified number is not an improvement on the first.

## 2 · CVHR agreement — the one §4 criterion never measured

§4 promotes CVHR only if finger `cvhrFromNN` events/h agree with ECGDex `detectCVHR` within the
corroboration band **on sleep nights** (n=2 waking is not evidence: one exact match, one false positive).
`tools/ppi-jitter-vs-ecg.mjs` does not compute it. Both sides already exist as shipped functions, so this
is an extension of the existing apparatus, not a new one.

## 3 · The jitter budget bounds what is achievable, and should gate proposals

`PPGDEX-ALGORITHM-DEEP-DIVE` §2.1's closed form: σ ≤ 3.51 ms ⇒ 1 % RMSSD bias; ≤ **4.98 ms ⇒ 2 %**;
≤ 6.11 ⇒ 3 %; ≤ 7.93 ⇒ 5 %. Measured now: **finger 8.16 ms, wrist 8.36 ms** — both ~1.6× over the 2 % bar
and outside even the 5 % one.

**Consequence:** whole-record RMSSD cannot promote on either device until jitter drops, and no amount of
extra nights changes that. Any accuracy proposal should be scored in **milliseconds of jitter removed** —
`PPGDEX-ALGORITHM-DEEP-DIVE` §6's open experiments (E-1 foot-domain consensus, E-3 waveform fusion
re-scored on jitter) are the candidates, and the apparatus to score them now exists.

## 4 · A method note worth keeping

Three numbers in the parent unit were wrong before they were right, and **all three came from the
apparatus, not the data**: 26 ms (coarse 1 s lag binning against a ±75 ms tolerance), 3.14 ms (integer
R-peak indices — §3.2's refinement missing), −29 % (the wrong ECG field, misread as a missing capability).

**Two of the three were caught only by pointing the same instrument at a second device.** An artifact of
construction appears as a *constant across devices*; a real device property does not. Any future
single-device validation here should run a second device for that reason alone.

## 5 · Done when

- [x] **§5's regression bound RE-BASED 2026-08-03 (§6.1)** — and re-based to a *procedure*, not a number.
      Both figures were re-derived (Verity 8.36 ms · `sdnnRobust` +18.7 %); the **gap remains
      unattributable** and is recorded as such. The shipped `sdnnNote` string is **still open** — a
      compute-path edit to a user-facing accuracy claim, owner's call.
- [x] **CVHR measured on sleep nights and adjudicated (§6.2): 7/7 finger nights inside the Integrator
      band, median |Δ| 1.80 /h, IQR 1.50–2.65 entirely inside ±5.** The criterion's substance is met
      decisively. **n = 7 < §3.1's ≥10-night bar**, so this is a recommendation to ratify, not a pass.
- [ ] A decision recorded on whether whole-record RMSSD should be surfaced at all for these devices, given
      it cannot promote until jitter halves.
- [ ] If any tier string moves: `Dex-Test-Suite.html?full` green, `verify-provenance` clean, changeset
      dropped — and the parent's open `computeHash` question (does a tier-only string edit move it?)
      answered by measurement rather than inherited as answered.


---

## §6 · EXECUTED 2026-08-03

### 6.1 · §5's regression bound is now a re-derivation, not a constant

`PPGDEX-ALGORITHM-DEEP-DIVE` §5 read *"no change may raise median jitter above **5.92 ms**"*. That number
came from the §2.2 apparatus, and §2.2 **names the method and no tool** — so it was never committed and the
threshold could not be re-derived by anyone, including its author. **A gate whose number cannot be
reproduced cannot be enforced against a change.** That, not the value, was the defect.

Re-measured with the committed instrument, the **Verity** — the device 5.92 ms describes — reads
**8.36 ms**. The gap is **not attributable**: with no committed original, corpus, method and figure are
indistinguishable. So 5.92 ms is **not declared wrong and not overwritten with 8.36** — swapping one
unverifiable constant for another repeats the defect in fresher paint.

**What changed is the form.** The bound is now: run the committed tool before and after a `ppgdex-dsp.js`
change on the same corpus; the after-median may not exceed the before-median; both numbers go in the PR.
Enforceable by anyone at any time, which the constant never was. 5.92 ms is retained as history and
8.36/8.16 recorded as a dated reference point, explicitly not as a threshold.

### 6.2 · CVHR — the one metric with a genuine case

§4's third criterion, never previously measured. Both nodes run the **same** detector (PpgDex's
`cvhrFromNN` is a deliberate port of `ECGDSP.detectCVHR`), so this compares **devices**, not methods. Band
is the Integrator's own `CVHR_AGREE_PER_H = 5.0`, read from the code.

| corpus | finger median \|Δ\| | IQR | in band |
|---|---|---|---|
| all nights (16) | 2.65 /h | 1.50–6.38 | 11/16 |
| **sleep only (7)** | **1.80 /h** | **1.50–2.65** | **7/7** |

Sleep-filtered, the whole IQR sits inside the band and every night agrees. Verity: 0.80 /h, 6/7.

**Two honest qualifications.** (a) **n = 7**, below §3.1's ≥10-night bar for a median+IQR claim — the
substance is met, the corpus size is not, so this is a **recommendation to ratify**, not a pass, and §4
reserves ratification for a person regardless. (b) The sleep filter is **crude by design** — start hour
20:00–04:00 and ≥4 h from the filename stamp and duration, not a stage call; it over-includes rather than
silently drops.

### 6.3 · The waking segments were carrying the noise

Filtering to sleep did not just move CVHR. The finger's **jitter IQR collapsed from 6.52–21.46 to
6.61–10.36** and its median improved 8.16 → **7.03 ms**; RMSSD bias fell +37.7 % → **+27.5 %**. The wide
upper quartile in every earlier table was daytime segments, which is the expected finger-pleth failure
mode (motion, perfusion) and matches §5b's own note that its 15 HR failures concentrated in two
high-HR/motion daytime segments.

**This does not rescue any other metric.** At 7.03 ms the finger is still ~1.4× over the ≤ 4.98 ms budget
for 2 % RMSSD bias, and `sdnnRobust` reads +10.8 % against a ±3.5 % bar with an IQR that still crosses
zero. The verdict in `docs/PPGDEX-FINGER-HRV-VALIDATION-2026-08-03.md` stands: **CVHR is the only metric
with a case, and it needs three more sleep nights to clear its own corpus bar.**

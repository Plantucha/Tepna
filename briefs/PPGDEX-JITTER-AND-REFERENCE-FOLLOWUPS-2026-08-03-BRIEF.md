<!--
  PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-03 · **Follows:** `O2RING-FINGER-HRV-VALIDATION-2026-07-21-BRIEF.md` §8/§8.6 · **Verdict doc:** `docs/PPGDEX-FINGER-HRV-VALIDATION-2026-08-03.md` · **Apparatus:** `tools/ppi-jitter-vs-ecg.mjs`

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

- [ ] 5.92 ms and ~+3.5 % either re-derived on the current corpus, or the gap explained; the shipped
      `sdnnNote` string corrected if it cannot be, and `PPGDEX-ALGORITHM-DEEP-DIVE` §5's regression bound
      re-based on whatever survives.
- [ ] CVHR agreement measured on sleep nights and the §4 criterion adjudicated.
- [ ] A decision recorded on whether whole-record RMSSD should be surfaced at all for these devices, given
      it cannot promote until jitter halves.
- [ ] If any tier string moves: `Dex-Test-Suite.html?full` green, `verify-provenance` clean, changeset
      dropped — and the parent's open `computeHash` question (does a tier-only string edit move it?)
      answered by measurement rather than inherited as answered.

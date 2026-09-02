<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [oxydex]
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
All 35 unregistered OxyDex metrics are registered and graded from the code — and the cards they grade
were verified first, which is where the real defects were (FOLLOWUPS §2.5).

**The registration.** 35 metrics the reference guide GRADED with no registry entry to grade them
against: `cohesion-badges` could not compare a tier it had no authority for, so each card carried a
badge nothing backed. Each now has an entry, graded by one rule stated once in the registry block:
`measured` = a direct readout of sensed values (no tuned threshold, no model) · `heuristic` = a tuned
or rule-of-thumb threshold decides the number · `experimental` = a bespoke composite, or an
established method transferred to a signal it was not validated on (the `dfaAlpha1` precedent — name
the transfer rather than inherit the method's standing).

23 grades agree with the guide. **4 the guide overstated** and are corrected: `SpO₂ Ceiling` and
`Stable SpO₂ Windows` claimed `measured` for threshold counts, `SpO₂–HR Decoupling %` and `SpO₂–HR
Lag` claimed it for a constructed statistic and an estimate — `measured` means DIRECTLY SENSED.
**8 where the rule would RAISE the badge are left at the guide's more conservative grade** (MODL, HR
Nadir Timing, Circadian HR Amplitude, LF/HF Power, O₂-HR Efficiency, RMSSD Arc, SPI, Vagal Index): a
grade that understates trust is not a false claim, while upgrading one on a rule written the same
afternoon is the fabricated authority the badge mandate exists to prevent. They are listed in the
brief so a later pass decides them deliberately.

**The registration was the small half.** A registry-backed badge vouches for the card, so every
checkable claim on those cards was verified against the code first: **13 checkable / 13 verified /
5 wrong.**

| card | claimed | the code does |
|---|---|---|
| Longest Clean Run | "motion = 0, SpO₂ 70–100 %, no HR artifact flags" | `spo2[i] > 95` alone — none of the three exist |
| IEI | `IEI_i = nadirTime_i − nadirTime_{i−1}` | `start_i − (start_{i−1} + duration_{i−1})` — the quiet gap between events |
| SpO₂–HR Lag | `argmax` over `lag ∈ [0..90 s]` | searches `lag <= 120`, reports the MEDIAN of per-window argmaxes |
| Motion Bursts | runs "separated by ≥30 s of quiet" | run ends at the first quiet sample; counted if `burstLen >= 3` |
| SpO₂ Ceiling | "exactly 100 % for ≥30 consecutive" | `spo2 >= 99`, `run >= 5` |

All five corrected DOC→CODE: the code shipped, is fixture-backed, and produced every number a user has
seen. Where the card described a richer design that was never built, the honest description of what
ships replaces it and the design goes to the brief as a lead. Eight cards were correct as written,
including the two most intricate (CS Score and UARS Score, whose four-criterion lists match exactly),
so this is specific drift rather than uniform decay.

**The four registry-side leads, each verified against its call site before editing:** `dfaAlpha1`
(cite said PULSE rate; `computeDFA` maps `r.spo2`), `ahiEst` (label AND cite said CVHR; the value is
`odi4Rate × 1.1`), `ssiIdx` (cite said sleep-stability; `computeSympSurge` and the DSP's own findings
row say 'Symp Surge'), and the `nadirBin*` family (labels and cites said DEPTH; `oxydex-dsp.js:4524`
bins on absolute LEVEL — a half-finished fix, since the code comment records being corrected to level
while the labels never followed). Two `goodDirection` inversions are corrected with them: `ssiIdx` was
`'up'` while the DSP scores `<0.3` as severity 0, and `nadirBinLt4` was `'up'` while fewer is better.

The nadir labels are corrected at the render and CSV sites too, with **both spellings aliased** so no
surface loses its badge, and **registry ids are unchanged**, so no export identity moves.

<!--
  OXYDEX-PB-OVERCALL-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-04 (**All five §4 Done-when items met; the two remaining moves are owner surface decisions, carried to `OXYDEX-PB-OVERCALL-FOLLOWUPS-2026-08-04-BRIEF.md` rather than held open here.** **§4 items 1-4 ANSWERED; item 3 and the gating item EXECUTED — see §7.** The qualifier now OBSERVES rather than prescribes: *"CS pattern indicators N/3 — screening signal, no periodicity test"*, and the UARS sibling with it. **The rate this brief quoted was wrong** — the string fires on **68 %** of nights (25/37), not 97 %; 97 % is the PB-flag rate, a different and looser gate (§7.1). Gated + mutation-verified: the exact revert reds 7 assertions including a rewording-proof source scan. `computeHash a58e4ba0a687 → a6a4245eb9e9`, both real fixtures regenerated (one field each) and `verifiedUnder`-stamped after a green corpus run. **Carried to the follow-up: §6.4's fusion remedy, and the sibling `csLabels` likelihood vocabulary at :2137/:2242** — same overclaim, no prescription, wider blast radius (findings card + reference guide + `cohesion-badges` parity), so it is its own decision.) · **Created:** 2026-07-31 · **Found while executing:** `CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md` §3.4 · **Relates:** `ECGDEX-CARDIOPULMONARY-COUPLING-2026-07-30-BRIEF.md` §10 (same family)

# OxyDex emits periodic breathing on 92 % of nights; the machine scores it on 13 %

Measured over **39 paired nights**, OxyDex emits a `periodic_breathing` ganglior event on **36**, while
the ResMed's own device-scored PB fires on **5**. Chance-corrected agreement is **κ = −0.039** — not
weak agreement, *none*.

| | OxyDex PB | OxyDex none |
|---|---|---|
| **device PB** | 4 | 1 |
| **device none** | 32 | 2 |

Reproduce: `node tools/pb-agreement.mjs --cpap <cpap-corpus.json>`.

---

## 1 · Why this is worth a brief rather than a shrug

**It is the `estimatedAHI` shape again.** That field was retired (`ECGDEX-CARDIOPULMONARY-COUPLING`
§10) because it published a clinically-labelled number resting on a correlation nobody had measured.
This is the same failure one node over: a **detector that fires on nearly every night** is not
carrying information, whatever its threshold was tuned to. A flag that is almost always on cannot
distinguish the nights it is meant to distinguish.

**It reaches a user with an instruction attached.** The pattern surface reads *"CS pattern likely —
review CPAP pressure"*. Telling someone to review their therapy pressure on 9 nights in 10 is not a
conservative default; it is noise with an imperative mood.

**It reaches the fusion layer as a currency.** `periodic_breathing` is a `ganglior_events` impulse, so
the Integrator's corroboration logic consumes it. An always-on channel degrades every rule that
counts observers.

## 2 · What is NOT established, and must not be assumed

- **The device is not ground truth.** It scores from flow with its own thresholds; OxyDex scores SpO₂
  oscillation. Disagreement means they do not measure the same thing — *not* that OxyDex is wrong.
  A conclusion of "OxyDex over-calls" needs a reference the corpus does not contain.
- **n = 1 subject.** Same bar as everywhere else in this suite: nothing here supports a population
  claim, and no badge moves on it.
- **The threshold's origin has not been read yet.** Before anything is re-tuned, the detector's own
  derivation and cited basis must be checked — it may be correctly implementing a published rule whose
  base rate simply does not fit a treated-CPAP subject.

## 3 · What to do

### 3.1 Read the detector's basis before touching a number
Find where the emission threshold comes from (`oxydex-dsp.js` oscillation / cycle-length path) and
what it cites. **If it implements a published rule faithfully, the finding is about the POPULATION,
not the code** — the honest fix is then a tier/wording change, not a threshold change.

### 3.2 Measure the operating point, do not guess it
The §9.3 discipline from `DEEP-STAGE-DESAT-CONFOUND` applies exactly: sweep the emission threshold and
report what each operating point *does* — how many nights it flags, and what agreement it buys against
the only independent label available. **A threshold chosen to make κ look better on 39 nights of one
subject would be overfitting**, so the deliverable may well be "no threshold is defensible here".

### 3.3 Temper the user-facing imperative regardless
Independent of any threshold work: *"review CPAP pressure"* is an instruction, and it is being issued
on 92 % of nights. Even if the detector is judged correct, the wording should state what was observed
(SpO₂ oscillation consistent with periodic breathing) rather than prescribe an action.

### 3.4 Check the fusion blast radius
Determine whether an always-on `periodic_breathing` channel inflates any Integrator corroboration
count, the same way a second oximeter must not double the apnea index (`integrator-dsp` §3.1).

## 4 · Done when

- [x] The emission threshold's derivation and citation are read and recorded — **there is none** (§5.1),
      which settles it as a code problem rather than a base-rate one.
- [x] The operating-point sweep is run and published (`tools/pb-operating-point.mjs`) — and it lands on
      the honest possibility the item allowed: no threshold on this corpus is defensible (§5.2).
- [x] The user-facing string states an observation rather than prescribing a therapy review. — **§7**;
      and the rate it fires at was **68 %, not 97 %** (§7.1 — the brief had quoted the PB-flag rate).
- [x] The fusion path is checked for an always-on-channel effect, and either fixed or shown inert —
      **it is NOT inert** (§6). Measured, not reasoned: 0 of 3 corroborated nights survive removing
      the OxyDex leg. Pinned by a characterization gate; the remedy is the same owner surface
      decision as item 3, so it is escalated with it rather than guessed at here.
- [x] Whatever lands is gated, and mutation-verified against a revert. — §7.3: reverting to the exact
      original string reds **7** assertions, including a source scan that survives any rewording.


---

## 5 · Answered 2026-08-01 — items 1 and 2

### 5.1 · The threshold's derivation: **there is no citation**

The emission gate is `detectOscillations`, and a 5-minute window is flagged when all three hold:

```
lowMotion    motion fraction < 0.08
sustained    >= 40 samples below SPO2_OSC_THRESHOLD
cross >= OSC_FLAG_CROSSINGS      crossings of the ABSOLUTE 95 % level
```

The three constants describe themselves, and what they say is the answer:

| constant | value | its own comment |
|---|---|---|
| `SPO2_OSC_THRESHOLD` | 95 | *"node-local: SpO2 oscillation crossing level"* |
| `OSC_WINDOW_SEC` | 300 | *"node-local: 5-min oscillation-analysis window (**algorithmic**)"* |
| `OSC_FLAG_CROSSINGS` | 6 | *"node-local: min 95%-crossings to flag a periodic-breathing window (**detector tuning**)"* |

No paper, no clinical criterion, no derivation — self-declared tuning. Under the Literature-Use Policy
that is the suite's own tier, never `validated`, which is consistent with how it is graded; the problem is
what the surface *says*, not the tier.

**And the gate contains no periodicity test at all.** AASM scores Cheyne-Stokes on a **40–90 s cycle
length**, **≥ 3 consecutive cycles**, and a **crescendo-decrescendo** envelope, measured against the
patient's **own baseline**. This gate checks none of those. `cycleLen` *is* computed — but only into
`meta`, after the decision; it never gates anything.

> ⚠️ **CORRECTION 2026-08-16 — the "40–90 s" above is a misreading of AASM, and it propagated.** AASM
> states *"a cycle length of at least 40 seconds (typically 45 to 90 seconds)"* — a one-sided **floor**
> plus a typicality note, not a two-sided scoring window (Berry RB et al. 2012, *J Clin Sleep Med*
> 8(5):597–619, [10.5664/jcsm.2172](https://doi.org/10.5664/jcsm.2172)). The rest of the paragraph is
> right: "≥ 3 consecutive cycles", the crescendo-decrescendo envelope and the patient's own baseline are
> AASM verbatim, and the gate checks none of them.
>
> The wording is **left in place rather than rewritten** — this brief is DONE and records what was
> believed at the time. The settled window (**40–130 s**, and why a 90 s ceiling discards roughly half of
> the worst-LVEF group) is in `OXYDEX-PB-DETECTOR-2026-08-09-BRIEF.md` §2.1.

### 5.2 · The sweep: it is not measuring periodicity

`tools/pb-operating-point.mjs` (committed here; drives the SHIPPED `processNight`, no reimplementation)
over the 37-night reference corpus:

| | |
|---|---|
| nights flagged | **36 / 37 (97 %)** |
| median time within ±1 % of the 95 % crossing level | **64 %** |
| PB episodes vs **% of night below 95 %** | **r = 0.893** |
| PB episodes vs **mean SpO₂** | **r = −0.821** |

Overnight mean SpO₂ across the corpus is **94.6–96.6 %** — the baseline *straddles the crossing level on
every night*. And 1 Hz oximetry reports **integers**, so a trace dithering 94/95/96 crosses `>= 95`
continually with no breathing periodicity whatever. Six crossings in 300 s is not a discriminating bar
when the signal sits on the line for two thirds of the night.

**So the detector is, to a very good approximation, measuring mild hypoxemia burden.** That is a real
quantity — it is simply not the one the label names.

### 5.3 · The consequence for §3: this cannot be fixed by moving the threshold

Raising `OSC_FLAG_CROSSINGS` does not recover periodicity; it makes the detector a **stricter hypoxemia
threshold**, still labelled "periodic breathing". The brief's §4 allowed "no defensible threshold on this
corpus" as an outcome, and the sweep says that is the outcome: **the shape is wrong, not the number.**

This is the third instance of one pattern in a fortnight, and the resemblance is the useful part:

| | the feature | the wrong shape |
|---|---|---|
| `estimatedAHI` | CVHR index | relabelled with AHI's units and cut-points |
| apnea typing | chest-ACC effort | an **absolute** floor where AASM is baseline-relative |
| **PB** | SpO₂ crossings | an **absolute** 95 % level, no cycle-length criterion |

Twice already the answer was to withdraw the claim rather than retune it.

### 5.4 · What remains, and what it needs

- **§4 item 3** (the user-facing string). *"CS pattern likely — review CPAP pressure"* on **68 %** of nights
  is an imperative resting on a hypoxemia proxy. Changing it is a small, defensible edit — but it is a
  **surface** decision (withdraw the instruction? withdraw the label? keep an unlabelled oscillation
  count?) and it belongs with the owner, not with a sweep.
- ~~**§4 item 4** (the fusion always-on channel) — unmeasured here.~~ **MEASURED 2026-08-01 → §6.** Not
  inert: 0 of 3 corroborated nights survive removing the OxyDex leg. Its remedy turned out to be *this
  same* surface decision, not a separate one — see §6.4.
- A redesign that would earn the name needs baseline-relative crossings + a 40–90 s cycle-length
  criterion + ≥ 3 consecutive cycles. That is a new detector, and it should be its own brief with its own
  validation, not a patch to this one.

**Guardrail restated, because the sweep makes it tempting:** do not tune any of these three constants to
improve agreement with the CPAP's PB scoring on 39 nights of one subject. The device is not ground truth,
n = 1, and the earlier night-level agreement was κ = −0.039.

---

## 6 · Answered 2026-08-01 — item 4, the fusion blast radius (§3.4)

**It is not inert.** `tools/pb-fusion-blast.mjs --cpap <cpap-exports.json>` (committed here; drives the
SHIPPED `adaptEnvelopeNode` + `fusePeriodicBreathing` in a co-loaded realm — no reimplementation of the
fusion rule) over the **24 nights** where a trio OxyDex export pairs with a CPAPDex export:

| | |
|---|---|
| OxyDex emits `periodic_breathing` | **23 / 24 (96 %)** — §5.2's 36/37, reproduced on the paired subset |
| `fusePeriodicBreathing` corroborates | 3 / 24 |
| …still corroborates with the **OxyDex leg removed** | **0 / 24** |
| block `conf` on the corroborated nights | 0.86 · 0.86 · 0.858 |

### 6.1 · The measurement had to be a counterfactual, not a head-count

"PB corroborated on 3 of 24 nights" answers nothing — 3/24 looks *conservative*. The informative quantity
is how many of those 3 survive **removing the always-on observer and changing nothing else**, and the
answer is none. Each night is therefore fused twice: as recorded, and with OxyDex's `periodic_breathing`
events stripped. The gap between the two runs is the leg's entire contribution to the decision.

`corroborated` is `nObservers >= 2`. With one leg on 96 % of nights, that is arithmetically a **one-observer
rule wearing a two-observer label**: the verdict is decided by whichever *other* node fires, and here that is
the CPAP's own device-scored PB — the very rater §1 measured κ = −0.039 against. The KPI
(`integrator-render.js:480`) publishes `nObservers` as its headline value with *"signals corroborate"*
underneath, and the fused note says *"corroborated across 2 independent signals"*. Both are literally true
and both overstate the independent evidence by one.

The leg is also not free on confidence. It joins the noisy-OR at `median(conf) × PB_TIER_WEIGHT.experimental`
= 0.5 × 0.6 = 0.30, lifting a device-only 0.80 to **0.86** — an uplift that is unconditional in practice,
because the leg is essentially always present.

### 6.2 · What is bounded, and what was NOT measured

- **The blast radius stops at the PB path.** `fuseApneaEvents` pools by IMPULSE over
  `['spo2_desaturation','desat_event']` only, so `periodic_breathing` reaches neither the confirmed-apnea
  rule nor `confirmedAHI`. The §3.4 analogy to §3.1's double-counted apnea index does **not** extend: this
  is an evidence-count and confidence effect inside `fusePeriodicBreathing` and the finding it emits, not
  an index inflation.
- **The ECGDex cardiac-CVHR leg was UNEXERCISED, which is not the same as inert.** It reads
  `apnea.cvhrIndex`, and 0 of the 24 committed trio ECGDex exports carry an `apnea` block at all — but
  that block landed **2026-07-23** (`11091ef`), *after* this corpus was generated (2026-07-12). The corpus
  is stale; the leg is not dead. Re-running `tools/trio-batch.mjs` would bring the third observer into
  scope. Directionally it can only *amplify* what §6.1 measured — a third way for the second observer to
  appear, with the same always-on leg underneath — but that is a prediction, not a measurement, and it is
  written here as one.
- **n = 1 subject**, 24 nights. Same bar as §2: nothing here is a population claim.

### 6.3 · Gated, and mutation-verified in both directions

`tests/dex-tests.js`, group *Integrator periodic-breathing corroboration (§2)*: a metamorphic pair holding
the OxyDex leg byte-identical and firing while toggling only CPAPDex, plus the 0.80 → 0.86 conf uplift as a
number. Reverting the production code reds it:

```
drop 'OxyDex' from _pbObserver's direct-node test  → ✕ corroborated/nObservers 2 · ✕ conf uplift
PB_TIER_WEIGHT.experimental 0.6 → 0.3              → ✕ conf uplift (0.86 → 0.83)
```

It is a **characterization** gate and is labelled as one in the source. It does not assert the behaviour is
right; it pins the shape of a defect that is currently shipping so it cannot drift unnoticed while the
remedy waits on §6.4.

### 6.4 · Why no fix landed with the measurement

Every available remedy is the **same surface decision as §5.4**, not a separate one:

1. **Withdraw the OxyDex leg from PB corroboration.** Defensible — the leg supplies no discrimination. But
   measured against this corpus it silences the fused finding entirely (0/24 would corroborate: the only
   other live observer is the CPAP, and one observer never surfaces). That is a real loss of a surfaced
   finding with no measured compensating gain.
2. **Keep the leg, stop calling it corroboration** — report the CPAP's device-scored PB and note the
   oximetry channel as concurrent-but-uninformative. This is wording, and wording is §5.4's question.
3. **Fix the detector** so the leg earns its place — baseline-relative crossings, a 40–90 s cycle-length
   criterion, ≥ 3 consecutive cycles. §5.4 already routes that to its own brief with its own validation.

Choosing among these is the owner's call for the same reason §5.4 is: it changes what a user is told about
their therapy. Item 4 asked for the effect to be *measured*, and it is — with the counterfactual, the
bound, and the caveat all recorded rather than a number produced.

---

## 7 · EXECUTED 2026-08-02 — §4 item 3, and a number this brief had wrong

### 7.1 · The rate was 68 %, not 97 % — this brief quoted the wrong gate

§4 item 3 and the `DOCS-INDEX` row both said the string fires "on 97 % of nights". **97 % is the
PB-FLAG rate** — `oscEpisodes > 0`, §5.2's 36/37 — which is a different and much looser gate than the
string's. The string additionally requires `csScore >= 2`, and twelve nights do not clear it.

Re-measured by driving the shipped `processNight` over all 37 corpus nights:

| gate | rate |
|---|---|
| PB flagged (`oscEpisodes > 0`) | 36 / 37 = **97 %** |
| `csScore >= 2` → the CS string | 25 / 37 = **68 %** |
| `uarsScore >= 2` → the UARS string | 1 / 37 = **3 %** |

`csScore` distribution across the corpus: `{0: 3, 1: 9, 2: 10, 3: 15}`.

68 % does not change the conclusion — a therapy instruction on two thirds of nights is the same class of
problem — but the brief was quoting a number it had not measured for the thing it was describing, which
is the failure this whole brief exists to object to. Corrected here and in `DOCS-INDEX`.

### 7.2 · What changed: the qualifier observes, it does not instruct

```
-  '; CS pattern likely — review CPAP pressure'
+  '; CS pattern indicators ' + csScore + '/3 — screening signal, no periodicity test'

-  '; UARS pattern — consider UARS protocol'
+  '; UARS pattern indicators ' + uarsScore + '/3 — screening signal'
```

The UARS branch was not named by item 3, but it is the same defect one line below — a therapy
prescription off a 0-3 heuristic — and fixing one while leaving the other would be arbitrary.

Two things were wrong with the old text and both are addressed: it **prescribed** an action the evidence
cannot carry (and this suite is explicitly not a medical device), and *"likely"* **overclaimed** a
determination §5.1 showed the detector cannot make — no cycle-length criterion, no
crescendo-decrescendo, crossings of an ABSOLUTE 95 % level on a corpus whose mean straddles that line all
night.

**The score, its 0-3 ladder and the `>= 2` gate are UNCHANGED.** This is a wording fix, not a retune —
§5.2 found no defensible threshold on this corpus, so retuning would be guessing. Naming the thing
honestly does not require a number nobody can derive.

### 7.3 · Gated, and verified against the exact revert

A new group (`oxydex-dsp · pb-overcall · known-answer`) with two kinds of leg:

- **Known-answers** pin today's wording, the unchanged `>= 2` gate (2 and 3 fire, 1 does not), and that
  the score is surfaced rather than hidden behind an adjective.
- **A source scan** pins the *contract* rather than the wording: no context qualifier may carry an
  imperative therapy instruction, whatever the text becomes. This is the leg that survives a future
  rewording, so it carries the anti-vacuity assertion (if the qualifier lines cannot be found, it FAILS
  rather than passing by silence).

Mutation-verified: restoring the exact original string reds **7** assertions, including the source scan
(`got 1 · want 0`). Restoring the UARS instruction, loosening the gate to `>= 1`, and dropping the score
from the string each red it too.

### 7.4 · The compute-path consequences, computed rather than claimed

This is a DSP change on the export path, so:

```
manifestHash  45311647db60 → bb209a307463   (MOVED)
computeHash   a58e4ba0a687 → a6a4245eb9e9   (MOVED ⇒ re-verification owed)
```

Both moved, as a compute-path edit must. `tools/regen-oxydex-goldens.mjs` regenerated the two real
fixtures — **exactly one field moved in each**, `0.summary.impression`, which is the blast radius this
change should have and no more:

```
OxyDex_2026-06-13_1056  outputHash d3646f817ef4d5ea → 8d12f1b04428eb15
OxyDex_2026-06-25_0439  outputHash 4884763b2dac10a6 → 7d2b39cfc6c926a3
```

The **synthetic** golden did not move — that night never reaches `csScore >= 2`, so the committed-input
fixture CI re-runs on every push is blind to this change. That is worth noting rather than glossing: the
only fixtures that could see it are the two real, gitignored ones, which is precisely the asymmetry
`FIXTURE-VERIFICATION-GATE` was written about. `DEX_UPLOADS=… node tools/verify-fixtures.mjs` stamped
both `verifiedUnder → a6a4245eb9e9` after a green run.

### 7.5 · Still open, and deliberately NOT folded in

Two sibling surfaces carry the same *likelihood* overclaim, though neither prescribes:

- `oxydex-dsp.js:2242` — the leads entry `'CS pattern probable (' + csLabel + ')'`
- `oxydex-dsp.js:2137` — the findings card, pushed with `csLabel`

Both read from `csLabels = ['Unlikely', 'Possible', 'Probable', 'Likely']` — a likelihood ladder over a
score with no periodicity test behind it. Changing that vocabulary touches the findings card, the
reference guide, and the `cohesion-badges` doc-parity gate, so it is a wider unit than item 3's "the
user-facing string" and is left as its own decision rather than smuggled in here. The regenerated
`_0439` fixture shows the two surfaces side by side, which is the clearest statement of what remains:

> *"Mild disruption: hypoxic load 5.813, **CS pattern probable (Likely)**; CS pattern indicators 3/3 —
> screening signal, no periodicity test."*

The qualifier is now honest; the lead beside it is not yet. **§6.4's fusion remedy also remains** — it
was escalated with item 3 and is unchanged by this wording fix.

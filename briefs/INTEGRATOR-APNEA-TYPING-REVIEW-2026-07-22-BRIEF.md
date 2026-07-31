<!--
  INTEGRATOR-APNEA-TYPING-REVIEW-2026-07-22-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-07-31 · **Created:** 2026-07-22 · **Decision:** **option 1 — abstain** (executed 2026-07-31; see §7 for what shipped and the one premise in §5 that was wrong)

# The Integrator types apneas from an effort feature that does not separate them

> **Supersedes nothing; scoped deliberately narrow.** This brief exists because
> `MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md` measured the feature that
> `integrator-dsp.js typeApneaByEffort()` depends on, and it does not carry the information the
> rule assumes. The estimator work deliberately **did not touch** the typing rule — swapping one
> unjustified rule for another is not an improvement. This is that work-unit.

---

## 1 · The rule, and the assumption under it

`integrator-dsp.js` (`typeApneaByEffort`, APNEA-TYPING-FUSION-2026-07-18 §1.1):

```
effort PRESENT through the event ⇒ drive persists against a blocked airway ⇒ OBSTRUCTIVE
effort ABSENT                    ⇒ no respiratory drive                    ⇒ CENTRAL
no effort COVERAGE / ambiguous   ⇒ UNTYPED — never guessed
```

with `APNEA_TYPE_OBSTRUCTIVE_FRAC = 0.5` over `effortSeries` epochs, where `present` is
`MotionDex`'s `amp >= EFFORT_FLOOR_G` (0.004 g), an **absolute** amplitude gate.

The rule is well-built — it abstains on missing coverage, it is tiered EXPERIMENTAL, it rides
beside the headline AHI rather than replacing it, and it no-ops gracefully when MotionDex is
absent. **The problem is not the plumbing. It is the feature.**

## 2 · What was measured

26 nights / 172 h of Polar H10 chest ACC against device-scored AASM events (392 apneas usable;
370 central, 31 obstructive after context filtering).

| Finding | Value |
|---|---|
| Effort during **central** apnea, vs that night's own baseline | **0.99×** — not absent, *normal* |
| Effort during **obstructive** apnea | 1.72× |
| Best achievable discrimination (relative measure, early-70% window) | **AUC 0.691**, p = 0.0002 |
| Central apneas below **half** baseline | **16.5%** (a single RIP belt achieves **84%** recall — Nassi 2022, IEEE TBME, n = 9,656 + 8,455) |
| Central apneas below 0.3× baseline | 4.6% |

**Consequence for the shipped rule.** An absolute `EFFORT_FLOOR_G` test marks effort *present*
during 83.5–95.4% of central apneas, so they type **OBSTRUCTIVE**. In a corpus whose residual
events are overwhelmingly central (370 vs 31), the rule is wrong for the dominant class.

Three further facts constrain any fix:

- **The 0.004 g constant is triple-miscalibrated for the way it is used.** It is Ryser 2022's
  *peak* threshold on a three-axis *vector magnitude* at 50 Hz; MotionDex applies it to the *RMS*
  of one differently-filtered axis. Peak-vs-RMS ≈1.4×, magnitude-vs-single-axis ≈1.4–1.7×, filter
  passband gain 0.3–1.1× — net 0.2×–3×, and rate-dependent. Ryser's own noise-gate value is
  unpublished, so the source constant is not fully specified either.
- **An absolute gate is the wrong shape regardless of its value.** AASM defines apnea as a ≥90%
  drop *from the patient's own recent baseline*; tilt-derived amplitude is additionally posture-
  and coupling-dependent. A fixed milli-g threshold conflates physiology with sensor geometry and
  produces block-structured, posture-correlated errors that look like a real finding.
- **The confidence gate is not an apnea filter.** Pinned as a test assertion
  (`motiondex-dsp · resp-rate · adversarial-twin`): a pause *shorter* than the 60 s analysis
  window does not trigger abstention, because the remaining clean breathing still supports a
  strong spectral peak. Measured — 30 s-pause epochs carried *higher* mean confidence (0.488)
  than clean ones (0.390).

## 3 · What is NOT known, and must not be asserted

- **The mechanism is unexplained.** The obvious candidate — that positive airway pressure
  mechanically drives chest motion when effort is absent — was tested against `MaskPress.2s` and
  **fails**: effort is *negatively* associated with pressure (Spearman ρ = −0.174, p = 0.0008,
  n = 367), the opposite of its prediction. Remaining candidates are the transducer difference (a
  belt measures circumference, an accelerometer measures tilt) and label quality.
- **The labels are the CPAP manufacturer's algorithm, not PSG.** ResMed infers central events by
  forced-oscillation airway patency. That is a different construct from effort, and its accuracy
  is not independently established here.
- **n = 31 obstructive.** Every obstructive statistic above has a wide interval.
- **One subject, one posture** (gravity-roll IQR 13.1–17.9°).
- An adversarial literature review surfaced a prior report whose direction may run *opposite* to
  the mechanism assumed here; that contradiction is unresolved.

So: enough to stop trusting the current rule, **not** enough to assert that chest ACC can never
type apneas. The literature is genuinely asymmetric on this — a single effort channel recovers
**84% of central** but only **51% of obstructive** events (Nassi 2022), because thoracoabdominal
paradox is unobservable with one sensor. Systems that do type successfully add a second sensor
(Chang 2020: thorax + abdomen; Wesper: chest + abdomen patches) or a second modality (WatchPAT:
chest ACC + PAT). The most recent chest-accelerometer AHI system states in its own limitations
that it *"is not capable of distinguishing obstructive from central apnea events"*
(Schipper 2026, Front Sleep, verified verbatim).

## 4 · Options, in order of honesty

1. **Abstain (recommended).** Keep emitting the effort series — it is a real signal — but stop
   emitting a *type* from amplitude alone. Surface "effort-based typing unavailable" rather than a
   guess. Cheapest, immediately correct, and loses nothing that was trustworthy.
2. **Re-base the feature as relative, and re-tier.** Replace the absolute floor with an
   event-vs-own-baseline ratio on the early portion of the event (excluding the terminating
   arousal, which is what destroyed the effect when included: AUC 0.573 → 0.691). Even done well
   this is **AUC ≈ 0.69** — below clinical utility — so it may only ever be a low-confidence
   corroborator, never a type. Would need its own tier and explicit uncertainty in the surface.
3. **Type only the direction the evidence supports.** Emit CENTRAL when effort is confidently
   absent and UNTYPED otherwise — never OBSTRUCTIVE from effort presence. This matches the
   published asymmetry. On this corpus it would fire rarely (16.5% of centrals reach the
   half-baseline mark), but it would be right when it fires.
4. Do nothing. Rejected: the rule is currently wrong for the dominant event class, silently.

## 5 · Done when

- [x] A decision is recorded here between options 1–3 — **option 1, abstain** (§7).
- [x] `typeApneaByEffort` reflects it, with the reasoning in a source comment, not just here
      (`integrator-dsp.js`, the header above the function carries the measurements and the three
      reasons re-tuning cannot work).
- [x] ~~`integrator-render.js` surfaces the change honestly~~ — **this item rested on a false premise;
      see §7.2. There is no render surface to change.**
- [x] A test pins the chosen behaviour, including the **negative** (`integrator-dsp · motiondex ·
      apnea-typing`, now *"Integrator WITHDRAWS effort-based apnea typing"*).
- [x] Evidence tier re-checked — **there was no badge to re-tier**; see §7.3.
- [x] Gates green; changeset dropped.

## 6 · Sources

- Nassi TE, et al. Automated scoring of respiratory events in sleep with a single effort belt and
  deep neural networks. *IEEE Trans Biomed Eng*, 2022. doi:10.1109/TBME.2021.3136753
- Schipper F, et al. Apnea-hypopnea index estimation using overnight chest-wall accelerometry.
  *Front Sleep*, 2026. doi:10.3389/frsle.2026.1858267 *(limitation quoted verbatim, author-verified)*
- Chang HC, et al. *Sensors* 20(21):6067, 2020. doi:10.3390/s20216067
- Ryser F, et al. *Biomed Signal Process Control* 78:104014, 2022. doi:10.1016/j.bspc.2022.104014
  *(source of the 0.004 g constant)*
- Measurements: `papers/effort-typing-null.html` (PARKED) and
  `briefs/MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md` §3, §6.

---

## 7 · Execution — 2026-07-31

### 7.1 · The decision, and why not option 3

**Option 1 (abstain).** `typeApneaByEffort` keeps walking MotionDex's effort series but no longer names
a type. `obstructive` and `central` are **`null`, not `0`** — a zero reads as *"measured none"*, which is
precisely the false claim being withdrawn (the Clock Contract §2.6 honesty rule, applied to a count).
Every desat is `untyped`; `typingWithdrawn:true` carries a machine-readable `withdrawnReason`;
`usable:false` + `underpowered:true` are held so **every pre-existing consumer gate closes** rather than
newly opening on a changed shape. No `apnea_obstructive`/`apnea_central` impulse is emitted under any
branch. The two constants that parameterised the rule (`APNEA_TYPE_OBSTRUCTIVE_FRAC`,
`APNEA_TYPE_MIN_TYPED`) are **deleted**, and their absence is gated by a source scan — a live knob for a
withdrawn decision is an invitation to re-enable it by tuning, and §2 is that the floor is the wrong
*shape*, not the wrong number.

**Option 3 was considered and rejected on this corpus's own numbers.** It would emit CENTRAL when effort
is confidently absent and never OBSTRUCTIVE. But the shipped rule already only called central at
`frac === 0` — i.e. *no epoch above the absolute 0.004 g floor* — and §2 establishes that this floor is
mis-scaled by 0.2×–3× in a rate-dependent way. A `frac === 0` night could therefore be posture or filter
gain rather than absent drive. Emitting CENTRAL from it still asserts a type from a feature demonstrated
not to separate; it merely asserts it less often. Only **4.6%** of real centrals fall below 0.3× baseline,
so the branch would also be near-silent. Option 3 remains available and is a strictly smaller change than
re-deriving the feature, should a relative baseline ever land.

**What survived.** `effortCovered` — how many desats the chest ACC actually witnessed. That is a
measurement, not an inference, and it preserves the distinction the old no-coverage branch protected
(*"the sensor was there and we decline to type"* vs *"the sensor was not recording"*) as a count instead
of as a type.

### 7.2 · §5's third item rested on a false premise — there is no render surface

The Done-when list asked that `integrator-render.js` *"say so rather than silently showing fewer events."*
It cannot: **the typing was never rendered.** A repo-wide search for `apneaTyping` finds it in
`integrator-dsp.js`, the two bundles that inline it, `tests/dex-tests.js`, and docs — and nowhere in
`integrator-render.js`, `integrator-app.js`, or `Integrator.src.html`. The typed events were built into
`out.events` and then **dropped**: the export block serialises the counts only, never the array. The
parent brief said as much and it was missed here — `APNEA-TYPING-FUSION-2026-07-18` §Status records that
it shipped *"as an export field + gate with no render surface"*, with a UI surface and bus-emission of the
impulses listed as follow-ups that were never taken.

So no user ever saw an obstructive/central call. **This does not soften the finding** — the wrong split
was published in every Integrator export carrying a MotionDex bus, which is a machine-readable claim to
any downstream consumer — but it does mean the blast radius is the export, not the UI, and it is why this
work-unit touches no renderer.

### 7.3 · There was no evidence badge to re-tier

§5's fifth item expected an `experimental` badge to reconsider. There is none: no `<node>-registry.js`
carries an `apneaTyping` metric (the only `obstructive`/`central` registry entries belong to CPAPDex's
**device-scored** indices, which are unaffected and remain correct). The `experimental` tier existed only
as prose — in a source comment and in the `DOCS-INDEX.md` row. Both have been corrected in place. This is
a small instance of a general gap: an export-only field escapes the COVERAGE MANDATE by construction,
because the mandate is scoped to *surfaced* measurements. Nothing here needs a badge now that no claim is
made, but the asymmetry is worth naming.

### 7.4 · What was verified, and how

- **Both mutations bite.** Reverting `null` → `0` reds 3 assertions; re-inserting a bare
  `APNEA_TYPE_OBSTRUCTIVE_FRAC = 0.5` reds the source scan. The group is not vacuous.
- **Full suite against the real corpus:** `DEX_UPLOADS=… node tests/run-tests.mjs` → **4552/4552, zero
  skips** (the 12 skips of a corpus-free run are the GATE-C equivalence legs; they ran).
- **`Integrator.html` + `OverDex.html` re-bundled** (`manifestHash f4bf8f1ce443 → 6a043cd6a8a8`);
  `build.mjs --check` clean across all 11 owned bundles; `verify-manifest.mjs` GATE A 9/9 + GATE B pass.
- **`computeHash` MOVED** `6c454a04fa7e → cddaff5d738d`, as a DSP edit must — so export-inertness was
  **not** claimed. `DEX_UPLOADS=… node tools/verify-fixtures.mjs` re-ran the app and reproduced
  `integrator_tch_golden.node-export.json` byte-for-byte, stamping `verifiedUnder: cddaff5d738d`. The
  golden's output did **not** move, because that fixture's bus carries no MotionDex and
  `typeApneaByEffort` has always returned `null` there.

### 7.5 · Follow-up

Per the house pattern a follow-up brief is owed, but nothing surfaced that needs one: the two open
questions (a relative effort baseline; a second effort sensor) are already the standing content of
`MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS-2026-07-22-BRIEF.md`, and duplicating them here would fork the
agenda rather than extend it. The §7.3 observation — that an export-only field is outside the COVERAGE
MANDATE's scope by construction — is recorded here rather than spawned, since it is an observation about
the mandate, not a defect in any node.

<!--
  INTEGRATOR-APNEA-TYPING-REVIEW-2026-07-22-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-22

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

- [ ] A decision is recorded here between options 1–3 (owner call — this brief does not presume it).
- [ ] `typeApneaByEffort` reflects it, with the reasoning in a source comment, not just here.
- [ ] `integrator-render.js` surfaces the change honestly — if typing is withdrawn, the UI says so
      rather than silently showing fewer events.
- [ ] A test pins the chosen behaviour, including the **negative**: an effort track that is present
      throughout must NOT produce an obstructive type under option 1 or 3.
- [ ] Evidence tier re-checked against the Literature-Use Policy; `experimental` may now be
      generous for an amplitude-derived type.
- [ ] Gates green; changeset dropped.

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

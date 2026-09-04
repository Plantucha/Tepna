<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (⚠ **read §0 before planning anything — this is NOT a new agenda.** `PAPERS-ROADMAP` §3.2 already scoped this work and the owner CANCELLED it 2026-08-28 with an explicit revisit condition, *"revisit only if records ever arrive"*; the records arrived 2026-09-03, so the trigger has fired. A second owner condition — that **NSRR stays closed until the brief drain completes** — is recorded on `REM-STAGING-FOLLOWUPS-2026-08-02` and is **NOT met**: 73 open briefs against a ≤20 target, measured 2026-09-04. That condition is the live gate and only the owner can lift it. `tools/nsrr-stage-validate.mjs` is already BUILT+proven, so what remains is execution, not design.) · **Created:** 2026-09-04 · **Follows:** `PAPERS-ROADMAP-2026-06-24-BRIEF.md` §3.2, `REM-STAGING-FOLLOWUPS-2026-08-02-BRIEF.md` §2b · **Affects:** `nsrr-adapter.js`, `tools/nsrr-stage-validate.mjs`

# SHHS is on disk. What it can validate, what it cannot, and what was already built for it

**Corpus, measured 2026-09-04.** Root printed with every figure, because a count against the wrong
root is this repo's most repeatable error — the path in the assignment omitted `polysomnography/` and
a count against it returned **0 XML**, which reads exactly like "the annotations are missing".

    root: /srv/data/shhs/polysomnography/{edfs,annotations-events-nsrr}/shhs1/
    EDF        99      3.5 G
    XML      5136      744 M
    distinct EDF ids   99
    distinct XML ids 5136
    ids in BOTH        99      <- every signal file has its annotation

**Annotations for the cohort, signals for a 99-subject sample.** Not a truncated download; every EDF
we hold is scoreable. SHHS1 is ~5800 subjects, so the XML side is the full cohort.

## 0 · This work was scoped, cancelled, and its revisit condition has fired

**Do not re-derive the agenda.** `PAPERS-ROADMAP` §3.2 already carries it, including the sequencing
argument and the caveats. Three facts from that brief that a fresh plan would waste days rediscovering:

- `nsrr-adapter.js` **already emits per-epoch expert stage labels** (`stages[]`, a 30 s `epochs[]` grid
  indexed from recording start, `remFrac`). They were always in the annotation files; the parser used
  to discard the stage identity on the same line it read it.
- **`tools/nsrr-stage-validate.mjs` EXISTS — 21 153 bytes, "BUILT+proven"**, and its own header reads
  *"SCORE THE SHIPPED SLEEP STAGER AGAINST EXPERT PSG LABELS."* The experiment is written.
- The standing constraint from the two failed staging efforts: **no staging detector may be validated
  on `genSynthetic`** — the oracle plants the exact signature the rule looks for (92.6 % recall against
  planted truth while under-calling REM ~4× on real nights).

🔴 **Two owner conditions, and one is unmet.** The DUA question is settled — NSRR access was
**approved 2026-09-02**. But `REM-STAGING-FOLLOWUPS`'s banner states the blocker *changed* rather than
lifted: it is **"gated on the owner's condition that NSRR stays closed until the brief drain
completes."** Measured 2026-09-04: **73 open briefs** against the owner's ≤20 target. **Only the owner
can say whether assigning this work supersedes that condition.** Both banners need re-stamping either
way — one says records may never arrive, the other says the gate is the drain.

## 1 · What SHHS validates that our corpus structurally cannot

One thing, and it is the thing two dead efforts needed: **expert per-epoch scoring on a clinical
population.** Our corpus has no sleep-stage label of any kind and cannot acquire one — a consumer
strap on a healthy sleeper at home produces no scored epochs, and the synthetic oracle is explicitly
barred from standing in for them.

⚠️ **It does NOT make our goldens "more golden", and that distinction is worth stating plainly because
it is the natural assumption.** A larger external corpus does not upgrade any fixture's evidence tier.
Tiers are node facts recorded in `<node>-registry.js`, and a paper- or corpus-sourced number reaches
`validated` only through a real, checkable citation — never by weight of data. What SHHS buys is
**cases our committed fixtures cannot express**, which is narrower and checkable:

| our goldens cannot express | does SHHS express it? |
|---|---|
| an expert-scored 30 s stage grid | **yes** — 5136 annotation files, all 99 paired |
| a clinical apnea/hypopnea population (comorbid, older, wide AHI) | **yes** |
| desaturation events scored by a human rather than by our own detector | **yes** |
| PAT / pulse-arrival behaviour | **no — PPG 0/99** |
| PPG morphology, perfusion index, multi-wavelength | **no — PLETH 0/99** |
| CGM excursions | **no — no glucose channel** |
| CPAP therapy pressure/flow | **effectively no — `CPAP` present in 1/99** |

**So the honest scope is one class of question, not a general upgrade.** For everything PPG-derived —
which is where this project's newest work lives — SHHS is silent, and that is a negative worth landing
rather than discovering three weeks in.

## 2 · Channel inventory — which metrics have a counterpart

Measured across all 99 EDFs at the root above.

    present in ALL 99:  SaO2 1Hz · H.R. 1Hz · ECG 125Hz · EEG 125Hz · EEG(sec) 125Hz
                        EMG 125Hz · EOG(L) 50Hz · EOG(R) 50Hz · THOR RES 10Hz
                        ABDO RES 10Hz · POSITION 1Hz · LIGHT 1Hz
    conditional:        NEW AIR 73/99 · AIRFLOW 33/99 · OX stat 96/99 · AUX 15/99
                        SOUND 16/99 · CPAP 1/99 · EPMS 1/99
    absent entirely:    PPG 0/99 · PLETH 0/99
    10 distinct channel sets · duration 3.0–9.1 h, median 8.5 h

| our node / metric | SHHS counterpart | verdict |
|---|---|---|
| OxyDex — SpO₂, ODI, T90 | `SaO2` 1 Hz, 99/99 + scored desat events | ✅ strong; rate matches the O2Ring's 1 Hz |
| ECGDex / HRVDex / PulseDex — RR, HRV | `ECG` 125 Hz, 99/99 | ⚠️ usable, **see the rate caveat below** |
| staging (REM-STAGING, DEEP-STAGE-DESAT-CONFOUND) | expert `stages[]`, 99/99 | ✅ the unique offering |
| EEGDex (planned) | `EEG`×2, `EOG`×2, `EMG` | ✅ lab PSG, strictly stronger than a Muse anchor |
| MotionDex | `POSITION` 1 Hz | ⚠️ body position only — not IMU; different quantity |
| PAT / PPG work | none | ❌ impossible |
| GlucoDex | none | ❌ |
| CPAPDex | `CPAP` 1/99 | ❌ n=1 |

⚠️ **THE RATE CAVEAT, and it is not cosmetic. SHHS ECG is 125 Hz; our Pan–Tompkins is calibrated at
the H10's 130 Hz**, which is the only rate that device offers — `RATE_WHY.ecg` says so. 125 vs 130 is
a 4 % difference in sample spacing, which lands directly on fiducial placement and therefore on every
RR-derived statistic. **Any HRV arm must first establish that the detector transfers**, and that is
its own measurement with its own pre-stated band, not an assumption to be carried into a result.

⚠️ **THE DENOMINATOR TRAP, stated because the obvious query gets it wrong.** Airflow lives under two
different channel names. `NEW AIR` alone matches **73/99**; the union of `NEW AIR` and `AIRFLOW`
matches **98/99** — and one file has neither. Any respiratory analysis must union the names and state
n=98, or it silently discards a quarter of the cohort while looking complete. The same shape applies
to the **10 distinct channel sets**: "99 nights" is not one population, and a per-experiment
eligibility count belongs beside every figure.

## 3 · The ingest path IS wired — and its newest output is not consumed

Traced rather than assumed, because a half-wired mechanism is this repo's most reliable defect.

**`nsrr-adapter.js` is wired.** `odi-bias-analysis.js` consumes it; both test runners exercise it;
every export has callers.

🔴 **But `stagesToEpochs` and `stageOf` — the per-epoch stage labels added by #807 — are consumed by
no analysis code.**

    nsrr-adapter.js          3   defined
    odi-bias-analysis.html   3   the INLINED adapter, identical count — not a second consumer
    tests/dex-tests.js           asserted
    odi-bias-analysis.js     0   calls only analyzeRecord() and severityOf()

The `.html` hit is the adapter inlined into the bundle (one `data-inline-src="nsrr-adapter.js"`
block), not consumption. So the expert stage labels — **the single thing SHHS uniquely offers** — are
extracted, gate-asserted, and spent by nothing. #807's own message says it emitted *"the per-epoch
expert stage labels the adapter was already discarding"*; that work stopped one consumer short.

`tools/nsrr-stage-validate.mjs` is presumably the intended consumer. **Confirming that it actually
calls them, on real records, is step 1** — and it is a source trace plus one run, not a build.

## 4 · Experiments, with pre-stated bands

**Bands are stated here, before any run.** ⚠️ And per `bands-cannot-detect-blindness`: a rate band
cannot distinguish a clean corpus from a blind instrument, so **each experiment carries a plant** — a
record with a known-wrong answer that the pipeline must flag. A pass with no plant is not evidence.

**E1 · Does the shipped stager agree with expert PSG?** Run `nsrr-stage-validate.mjs` over the 99
paired records. Pre-stated: **≥0.60 Cohen's κ overall** counts as transfer; **0.40–0.60** partial;
**<0.40** the detector does not transfer to clinical PSG. Report per-stage recall separately — the
prior failure was **under-calling REM ~4×**, which an overall κ hides. *Plant:* one record with its
stage grid circularly shifted by 10 epochs; κ must collapse toward chance. If it does not, the scorer
is not reading the labels it claims to.

**E2 · Does our ODI agree with expert-scored desaturations?** `SaO2` 1 Hz against the scored
desaturation events. Pre-stated: **±1.0 events/h** on the paired difference counts as agreement;
report Bland–Altman bias and limits, never a correlation. *Plant:* one record with `SaO2` shifted
+3 %; the ODI must move in the predicted direction and magnitude.

**E3 · Does Pan–Tompkins transfer from 130 Hz to 125 Hz?** The prerequisite for any HRV arm, and it
must run first. Take our own 130 Hz H10 records, resample to 125 Hz, re-detect, and compare beat
times against the 130 Hz detection. Pre-stated: **median |Δ| ≤ 4 ms and ≥99 % beat correspondence**
means it transfers. This uses OUR corpus, not SHHS, and needs no data-use decision at all.

**E4 · Deliberately NOT proposed.** No PAT, PPG, CGM or CPAP arm — §1 shows the data cannot express
them. Recording that as a decision so it is not re-proposed.

## 5 · Constraints and the parked half

🔴 **`uploads/trio/**` IS EXEMPT FROM THE GITIGNORE** (`.gitignore:140-141` un-ignores that subtree
wholesale), so anything folded there is **tracked by default in a public repo** — the `uploads/*`
deny-by-default that protects everything else does not apply, and `trio-batch` writes into exactly
that directory. **Decide the output location before the processing, not after.** No SHHS-derived
artifact may be written under `uploads/trio/` at any point, including as a temporary.

🔴 **SHHS carries data-use terms our own recordings do not.** The 11 tracked EDFs are the owner's own
device output, deliberately allowlisted; that mechanism is **not** a precedent. **Whether any
SHHS-derived artifact may be committed, and in what form, is an owner decision** and is deliberately
not taken here. Until it is ruled: analysis and briefs (which read only) proceed; committing derived
artifacts does not.

**Done when**

- [ ] the owner rules on the drain-completion condition (§0) — the live gate
- [ ] `nsrr-stage-validate.mjs` traced to confirm it consumes `stagesToEpochs`/`stageOf`
- [ ] E3 run (needs no SHHS data or policy decision — do this first)
- [ ] E1, E2 run with their plants, results recorded either way
- [ ] the owner rules on the derived-artifact commit policy
- [ ] `PAPERS-ROADMAP` §3.2 and `REM-STAGING-FOLLOWUPS` §2b banners re-stamped — both now state
      conditions that events have overtaken

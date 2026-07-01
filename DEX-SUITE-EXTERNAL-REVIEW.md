# Dex Suite ("Tepna") — Independent External Review

*Reviewer stance: skeptical senior biomedical software engineer / sleep researcher /
DSP scientist / OSS maintainer / medical-device SW auditor. No prior contact with the
author. Goal is accuracy, not encouragement.*

> **Evidence basis & honesty note.** This review is grounded in the repository's
> governing doc (`CLAUDE.md`), the six node metric registries (`*-registry.js`), the
> evidence-ladder design (`metric-registry.js`, `dex-badges.css`), the test harness
> (`Dex-Test-Suite.html`, `tests/dex-tests.js`, `tests/run-tests.mjs`), the provenance
> system (`ganglior-provenance.js`, `verify-provenance.html`), and the Clock Contract.
> Where I have **not** opened a file (e.g. the FFT inner loop, PPG peak detector,
> per-node render hero maps), I say so and mark the verdict *provisional*. Treat any
> unqualified DSP claim below as "needs a confirming read before publication."

---

## 0. What this project actually is

A fleet of **single-signal, 100%-local, no-build HTML analyzers** — OxyDex (oximetry),
HRVDex (daily HRV summaries), PulseDex (raw RR→HRV), ECGDex (raw ECG), GlucoDex (CGM),
PpgDex (PPG), plus CPAPDex — unified by a shared event bus ("Ganglior"), a fusion layer
("Integrator"), a shared evidence-badge engine, and a single time model ("Clock
Contract"). Each app is authored as external `*.js` + a `.src.html` skeleton, then
inlined to a standalone bundle. No network, no CDN, system-font stacks only.

This is an unusually **coherent personal/research codebase**. The governance doc alone
is more disciplined than most funded academic software. That coherence is the headline
finding — and so is the gap between the *engineering rigor* and the *scientific
defensibility of some surfaced metrics*.

---

## A. Scientific Validity — **6 / 10**

**Genuinely strong:**
- The repo ships an explicit **5-level evidence ladder** (`measured · validated ·
  emerging · experimental · heuristic`) with a single source of truth and a test that
  asserts the engine, the static CSS mirror, and every reference guide agree
  (`cohesion-badges` group). *Self-grading epistemic honesty is rare and genuinely
  impressive* — most hobby health tools present a custom composite and a Task-Force
  metric with identical visual weight. This one refuses to.
- The validated tiers cite real anchors: Azarbarzin 2019 (hypoxic burden), AASM ODI,
  Task Force 1996 (RMSSD/SDNN/LF:HF), Toichi 1997 (CVI/CSI), Baevsky SI, Hayano CVHR.
  These are the correct references for those metrics.

**Weak / questionable (state explicitly):**
- **"Body-part Age" metrics** — *ANS Age* appears in **5 of 6 nodes**; *Metabolic Age*
  in GlucoDex. A population regression presented as "your nervous system is 43." The
  registry honestly tiers these `heuristic` and the cite says "directional only," but a
  single personal age number invites over-interpretation no disclaimer undoes. **This
  is the weakest science in the repo.**
- **Blood pressure from HRV / oximetry** (SBP/DBP Est, BP Risk, BP projection across
  OxyDex/HRVDex/PulseDex). Cuffless BP from HRV is not established; the ±10–12 mmHg
  "NOT a cuff" disclaimer is itself the tell. If a metric needs that sentence, it
  should not be a surfaced metric.
- **VO₂max from HR-ratio** (Uth–Sørensen, ×5 nodes): the method is real but is a
  population proxy, not CPET — acceptable in a research drawer, not as a KPI.
- **Sleep staging from heart rate** (ECGDex Deep/REM/Total): explicitly *not
  EEG-validated*. Cardiorespiratory staging has published precedent but error bars wide
  enough that per-night minute counts oversell it.

*(All of the above are itemized with replacements in the companion
`DEX-METRIC-REMOVAL-AUDIT-BRIEF.md`.)*

**Limitations documentation:** above average — disclaimers are embedded per-metric and
an intended-use health disclaimer is mandated suite-wide. The problem is not missing
disclaimers; it's metrics that shouldn't survive their own disclaimer.

---

## B. Signal Processing — **6 / 10 (provisional — DSP internals not fully read)**

What I can verify from architecture and contracts:
- **Multi-format ingest** with a hardened timestamp parser is a first-class concern
  (O2Ring, Welltory, Polar Sensor Logger, CGM, 14-digit vendor stamps), with a
  deterministic DMY/MDY rule and a "never fabricate a timestamp → return null" policy.
  This is *better artifact-of-ingestion hygiene than most reference tools* — OSCAR and
  EDFBrowser both have long bug tails here.
- **HRV provenance is correctly separated by signal quality:** OxyDex explicitly labels
  its RMSSD as a *1 Hz pulse-rate proxy, not RR-interval HRV* (`bpm*` unit), while
  PulseDex/ECGDex compute true RR HRV. Distinguishing these is a real methodological
  win — conflating them is the single most common HRV error in consumer tools.

**Unverified — flag before any scientific claim:**
- FFT implementation, windowing, detrending, and resampling for frequency-domain HRV
  (LF/HF, HF n.u.) — **not read.** Frequency-domain HRV from irregularly-sampled RR is
  where most implementations are quietly wrong (interpolation rate, window, VLF
  leakage). Must be audited.
- PPG/PulseDex peak detection, ectopy/artifact rejection, and RR correction — **not
  read.** HRV is dominated by beat-detection and artifact correction; without seeing
  these I cannot certify any HRV number.
- DFA α1, sample/spectral entropy: correctly tiered `emerging`, but length/stationarity
  sensitivity needs documenting.

**Verdict:** the *framing* of the DSP is unusually honest; the *correctness* of the
core estimators is unproven to me and is the #1 thing a reviewer must check before
trusting output.

---

## C. Software Engineering — **8 / 10**

This is the project's strongest dimension.
- **Provenance tracking** (`ganglior-provenance.js` + `verify-provenance.html`): each
  bundle computes a `buildHash` (SHA-256[0:12] over the immutable template) and audits
  committed JSON exports against it. *A self-hosted no-build HTML project that
  fingerprints its own bundles and verifies that exports trace to a reproducible build
  is genuinely beyond what most academic repos do.*
- **Regression gate** (`Dex-Test-Suite.html` + `tests/dex-tests.js` shared with a Node
  runner `run-tests.mjs`): the *same assertions* run in-browser and in CI, and the
  shared assertions are explicitly declared "the public contract." Back-compat
  discipline (add params last + optional; new return data via new fields) is written
  into the governance doc. This is professional.
- **Architecture:** clean separation of `-dsp / -render / -app / -registry / -cross`
  per node, one shared event-bus schema (`ganglior.node-export`), a frozen codename
  with a back-compat alias. The modularization refactor is marked done and archived.
- **The Clock Contract** is the best single artifact in the repo: a rigorously reasoned
  "floating wall-clock ms + getUTC* read-back" model that makes output
  viewer-timezone-independent and cross-node-syncable, with a documented parser
  resolution order and round-trip verification steps. I have rarely seen timezone
  handling this deliberate in *any* codebase, commercial included.

**Deductions:** no-build inlining means the `buildHash` fingerprints the *skeleton, not
the executed code* — the doc admits it "will NOT detect external-`*.js` drift." That's
a real provenance hole. Duplicated `parseTimestamp` in every node (intentional, but a
divergence risk). Single-author bus factor.

---

## D. User Experience — **6 / 10**

- **Metric overload is real and acknowledged in-code:** OxyDex's registry notes the
  cards/table render *~75 metrics*. Seventy-five metrics for one oximetry night is past
  the point of clinical usefulness and into dashboard-as-flex. The depth tiering
  (`basic / advanced / research`) is the right mechanism; it needs to default
  aggressively to `basic`.
- **The evidence badges are the UX redeemer** — a user can see at a glance that ODI-4 is
  validated and ANS Age is heuristic. Few consumer tools admit this.
- **Hero cards currently promote heuristic metrics** (ANS Age, BP proxies) — exactly
  inverted from what the evidence ladder implies. Fixing that (see the removal brief) is
  the highest-leverage UX change.

---

## E. Open-Source Quality — **7 / 10**

- Licensing is *fully buttoned up*: Apache-2.0, SPDX headers mandated per file,
  `LICENSE`/`NOTICE`/`CITATION.cff`/`THIRD-PARTY.md` authoritative, a dedicated
  licensing brief. Above the OSS median by a wide margin.
- Documentation volume is enormous (dozens of briefs/READMEs). **Risk: doc sprawl** — a
  newcomer faces 60+ markdown files with no obvious single entry path; `docs-archive/`
  helps but the root is crowded.
- **Installation experience is excellent by construction:** open the HTML, no build, no
  network. This is a real adoption advantage over OSCAR/Kubios/EDFBrowser.
- Transparency: high. Reproducibility of *builds*: high. Reproducibility of *science*
  (validation datasets, ground-truth comparisons): largely absent — there are cohort/
  synthetic-corpus harnesses, but I see no published agreement-vs-PSG/-cuff/-CPET
  numbers. **That gap is what blocks researcher trust.**

---

## F. Innovation — **7 / 10**

**Actually novel:**
- A **self-grading evidence ladder enforced by tests** across a multi-app suite. I am
  not aware of an OSS health-analytics project that mechanically asserts its docs and
  engine agree on each metric's epistemic tier. This is the standout idea.
- **Runtime build-provenance for a no-build standalone HTML** family of apps.
- The **floating-wall-clock time model** as an explicit cross-device sync primitive.

**Common practice (reinvented):** the HRV metrics themselves (Kubios/pyHRV/NeuroKit2
territory), ODI/oximetry summaries (OSCAR/Wellue), FFT-based frequency HRV. The novelty
is in *governance and honesty layering*, not in the estimators.

---

## Head-to-head

| Tool | Better than Dex | Worse than Dex | Similar |
|---|---|---|---|
| **OSCAR** | mature CPAP/PSG validation, huge user base | install friction, timezone bugs, no evidence-tiering | oximetry summaries |
| **Kubios HRV** | validated FFT/artifact correction, clinical citing | closed, paid, no provenance, no local-first ethos | HRV metric set |
| **NeuroKit2 / pyHRV / HeartPy** | peer-reviewed estimators, test-validated DSP | no honesty-tier UX, no unified report | HRV/PPG algorithms |
| **SleepHQ / Wellue** | polished, supported | proprietary, no transparency, no provenance | report dashboards |
| **PhysioNet / EDFBrowser** | gold-standard formats & validation | dated UX, no interpretation layer | signal ingest |
| **SleepPy / OpenSignals** | published methods | narrower scope, less governance | actigraphy/staging |

**One-line:** *Worse than the specialist tools at any single estimator's validated
correctness; better than nearly all of them at honesty, provenance, governance, and
zero-friction local install.*

---

## Category scorecard

| Category | Score |
|---|---|
| A. Scientific validity | 6 |
| B. Signal processing | 6 *(provisional)* |
| C. Software engineering | 8 |
| D. User experience | 6 |
| E. Open-source quality | 7 |
| F. Innovation | 7 |

---

## Final rankings

1. **GitHub hobby-project ranking:** top ~3–5%. Most hobby health repos are a notebook
   and a README; this is a governed, tested, provenance-tracked suite.
2. **Open-source health-analytics ranking:** mid-pack on *validated DSP correctness*
   (behind Kubios/NeuroKit2/pyHRV), **top-tier on transparency/governance/local-first.**
   Net: a credible niche entrant, not yet a reference implementation.
3. **Scientific-credibility ranking:** **moderate, and currently capped by two things** —
   (a) the heuristic "age"/BP proxies surfaced as heroes, and (b) the absence of
   published agreement-vs-ground-truth numbers. Both are fixable.
4. **Probability I'd personally use it:** ~55% — as an honest exploratory dashboard for
   my own data, yes; as a source of truth, not until the DSP core is audited.
5. **Probability I'd recommend it:** ~40% today → **~75%** if items 1–5 below land.
6. **Top 10 improvements before publication:**
   1. **Remove the BP-from-HRV and ANS/Metabolic-Age metrics** (or bury them behind an
      explicit research opt-in). They are the credibility ceiling.
   2. **Publish validation numbers:** Bland–Altman / agreement vs PSG (ODI, staging),
      vs cuff (don't — just drop BP), vs Kubios (HRV), vs CPET (VO₂). Even one cohort
      moves trust more than any feature.
   3. **Audit the frequency-domain HRV pipeline** (resampling rate, window, detrend,
      VLF handling) and document it; add a known-answer test against PhysioNet RR data.
   4. **Audit PPG/RR beat detection + artifact correction**; report rejected-beat rates
      in the UI.
   5. **Default reports to `basic` depth** — surface ~8–12 validated metrics, push the
      other ~60 to an expandable research view. Kill metric overload.
   6. **Invert hero cards to validated metrics** (per the removal brief).
   7. **Close the provenance hole:** hash the executed `*.js`, not just the template, so
      `buildHash` actually fingerprints code.
   8. **Add a single canonical entry doc / site map** over the 60+ markdown files.
   9. **Cross-validate `parseTimestamp`** with one shared conformance test fixture set
      (keep the per-node copies, but test them against one truth table).
   10. **State the no-diagnostic-claim prominently and consistently**, and make sure no
       surfaced metric (BP, AHI-est, staging) reads as diagnostic.

---

### Bottom line
An **engineering-led project with unusually honest scientific framing**, dragged down by
a handful of **gimmick metrics** and an **unproven DSP core**. The governance, provenance,
evidence-tiering, and time model are the work of someone who thinks like a medical-device
engineer. The ANS-Age/BP/VO₂ metrics are the work of a consumer-wearable marketing team.
Delete the latter, publish even minimal validation, and audit the FFT/peak-detection —
and this moves from "impressive hobby suite" to "tool researchers would actually cite."

*Scores B and the DSP verdicts are provisional pending a direct read of the estimator
internals; everything in C/E/F is grounded in files reviewed.*

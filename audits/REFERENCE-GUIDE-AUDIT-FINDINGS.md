# Reference-Guide Deep Audit — Findings Log

Per `REFERENCE-GUIDE-AUDIT-BRIEF.md`. One section per guide: what was wrong → what changed.
Gates after each guide: `Dex-Test-Suite.html` must read all-green; no re-bundling (static docs).

---

## PpgDex Reference.html — ✅ audited (gate green: 513 / 30 groups)

**Verified sound (no change needed):**
- **Formulas vs `ppgdex-dsp.js` / `ppgdex-morph.js`** — every formula matches the code's constants:
  fs 176 Hz, band-pass 0.5–8 Hz, SQI = max(0,corr)·(0.4+0.6·(1−motion)), motion gate
  max(accDynamic/120 mg, gyro/40 dps) on a 4 Hz grid, motion-reject & clean-pulse threshold 0.5,
  SD1 = √0.5·std(Δ), SD2 = √(2·SDNN²−0.5·std(Δ)²), ellipse = π·SD1·SD2, AI = 100·(P2−P1)/P1,
  RI = P2/P1, SDPPG b/a = b/a, AGI = (b−c−d−e)/a, riseTime/notchTime = (idx−foot)/fs·1000,
  PI = 100·SD(bandpassed)/mean|raw|, VO₂max = 15·(HRmax/HRrest).
- **Grades vs `ppgdex-registry.js`** — every card whose label `PpgRegistry.idForLabel` resolves carries
  the registry's `evidence` tier (measured/validated/emerging/experimental/heuristic). No mismatch.
- **Citations** — all 11 external refs are real, correctly attributed, with resolving DOIs and correct
  coordinates (Allen 2007 Physiol Meas 28(3):R1; Elgendi 2012 Curr Cardiol Rev 8(1):14; Schäfer &
  Vagedes 2013 Int J Cardiol 166(1):15; Task Force 1996 Circulation 93(5):1043; Brennan 2001 IEEE
  TBME 48(11):1342; Peng 1995 Chaos 5(1):82; Richman & Moorman 2000 AJP 278(6):H2039; Takazawa 1998
  Hypertension 32(2):365 — DOI 10.1161/01.HYP.32.2.365 web-confirmed; Lima 2002 Crit Care Med 30(6):1210;
  Guilleminault 1984 Lancet 1(8369):126; Uth–Sørensen 2004 Eur J Appl Physiol 91(1):111 — DOI
  10.1007/s00421-003-0988-y web-confirmed, original article not the 2005 erratum). Internal composites
  (HRV Score, ANS age) honestly labelled "no external source."
- **Internal anchors** — every quick-jump / abbr-map / nav `#…` target resolves to a real section id.
- **Abbreviations** — every acronym used in prose is in `abbrs[]`; every `abbrSectionMap` target exists.
- **Honesty** — no retired vocabulary in badge titles; no correction-history meta-commentary in reader text.

**Fixed:**
1. CSS header comment said *"evidence badges driven by CPAP_REGISTRY"* (copy-paste from the CPAPDex
   guide) → corrected to **PPG_REGISTRY**. (Invisible HTML comment, but factually wrong.)
2. Quick-Jump toggle label read **"13 sections"**; the document has **19** `.rs` content sections →
   corrected to "19 sections".

---

## OxyDex Reference.html — ✅ audited (gate green: 513 / 30 groups)

The fabrication-history node. The previously-flagged fakes ("Hartmann 2019" / "Castillo 2018") are
already gone. The bulk citation list (AASM Berry/Iber, ICSD-3, Azarbarzin 2019/2020, Nieto/SHHS,
Kulkas 2013, Brouillette 2000, Garg 2014, Magalang 2003, Task Force 1996, Peng 1995, Richman & Moorman
2000, Brennan 2001, Tanaka 2001, Uth–Sørensen 2004, Karvonen 1957, Jubran 1999, Allen 2007, Pépin 2020,
ACSM 2022) is real and canonically formatted; shared sources match the other guides.

**Fixed — honesty / fabrication-class conflicts (badge ↔ prose):**
1. **SBII card** claimed the app's metric was *"developed and validated in 4,485 SHHS participants …
   Published: Hui et al., Respirology 2024"* while badged `experimental` ("not externally validated").
   Two errors: (a) **wrong name** — the real Hui et al. *Respirology* 2024 metric (doi 10.1111/resp.14754,
   web-verified, SHHS n=4,485, top-quintile mortality HR ≈ 2.04) is the **"Sleep Breathing Impairment
   Index,"** not "Sleep-disordered Breathing **Intensity** Index"; (b) the app ships an internally-
   calibrated depth²×duration **approximation**, not the validated algorithm. Reworded to attribute the
   SHHS validation to the *published* SBII and frame this card as a directional internal approximation
   (consistent with its experimental badge); quintile column relabelled "Published SBII range (Hui 2024)."
2. **HD94 / HD90 / HD88 card** was badged `validated` though the registry grades `hd94` **experimental**
   ("internal composite") and the caption calls it a fixed-threshold whole-night integral → re-badged
   **experimental**. (Label doesn't resolve via `idForLabel`, so not gate-caught — honesty fix.)
3. **Hypoxic Load card** was badged `validated` while its own text says *"approximation, not a literal
   reimplementation"* of Azarbarzin 2019 → re-badged **emerging**.

**Flagged for a SEPARATE back-compat-aware node change (NOT edited here):**
- `oxydex-registry.js` `sbii.cite` says *"Sleep-breathing **instability** index."* The published name is
  *"Sleep Breathing **Impairment** Index"* (Hui 2024). Registry is node source — flagged, not touched.

**Verified sound:** every resolvable card grade matches the registry (gate-green); no retired badge
vocabulary; MOS honestly distinguished from the pediatric McGill score; VO₂max uses Tanaka
HRmax = 208−0.7·age.

---

## ECGDex Reference.html — ✅ audited, NO fixes needed (gate green: 513 / 30 groups)

Exemplary. Full citation extraction confirmed **all 15 references real, canonically formatted, with
resolving DOIs** and coordinates matching the brief seed list and the other guides:
Pan & Tompkins 1985 (IEEE TBME BME-32(3):230, doi 10.1109/TBME.1985.325532), Malik 1989 (Eur Heart J
10(12):1060), Task Force 1996 (Circulation 93(5):1043), Brennan 2001 (IEEE TBME 48(11):1342),
Peng 1995 (Chaos 5(1):82), Richman 2000 (AJP 278(6):H2039), Bauer 2006 (Lancet 367(9523):1674,
doi 10.1016/S0140-6736(06)68735-7), Costa 2017 (Front Physiol 8:255), Billman 2013 (Front Physiol 4:26,
LF/HF caveat), Hayano 2011 (Circ Arrhythm Electrophysiol 4(1):64, CVHR apnea screen), + Bazett 1920 /
Fridericia 1920 / Lomb 1976 / Scargle 1982 / Moody 1985 / AASM v3 2023 honestly printed **without** a
DOI. The provenance note ("No DOI is printed that was not checked") is accurate.
- Grades: every resolvable card matches the registry (gate-green); `sampen` honestly `experimental`;
  AF-screen and sleep-stage cards honestly hedged as screen/non-EEG (consistent with experimental/
  heuristic registry grades).
- Anchors: every `href="#…"` resolves; every `abbrSectionMap` target exists; no dead links.
- Quick-Jump count "31 metrics · 14 sections" uses the canonical format and is accurate (14 content
  sections). No stray cross-node registry comment.

---

## PulseDex Reference.html — ✅ audited (gate green)

Raw-RR HRV node. **All 9 DOIs real and resolving**, coordinates consistent with the other guides:
Task Force 1996, Brennan 2001, **Baevsky & Chernikova 2017** (Cardiometry 10:66,
10.12710/cardiometry.2017.10.6676), Peng 1995, Richman 2000, Bauer 2006, Costa 2017, **Lomb 1976**
(Astrophys Space Sci 39:447, 10.1007/BF00648343 — PulseDex prints a resolving DOI where ECGDex
declined one; both acceptable), Uth–Sørensen 2004.
- **Baevsky SI** = `AMo / (2·Mode·MxDMn)` — matches canonical (brief §2); graded `validated`.
- PIP card honestly cites **Costa 2017** (the shakier ">69% AF risk, 2025" wording is only in
  `pulsedex-registry.js` `pip.cite`, not the guide — flagged for a separate node review, not edited).
- Welltory-style composites `experimental`; ANS-age/VO₂/BP proxies `heuristic`; grades gate-green;
  all anchors + abbr-map targets resolve.

**Fixed:**
1. CSS header comment *"…driven by CPAP_REGISTRY"* → **PULSE_REGISTRY**.
2. Quick-Jump label **"12 sections"** → **"15 sections"** (15 `.rs` sections).

---

## HRVDex Reference.html — ✅ audited (gate green)

Welltory-style daily-HRV-summary node. **All 6 DOIs real and resolving**: Task Force 1996, Brennan 2001,
**Toichi 1997** (J Auton Nerv Syst 62(1-2):79-84, doi 10.1016/s0165-1838(96)00112-9 — web-verified,
PubMed 9021653, CVI/CSI), Baevsky 2017 (Cardiometry 10:66), Peng 1995, Uth–Sørensen 2004.
- **Baevsky SI** = `AMo/(2·Mode·MxDMn)`, **CAI** = `√(SD1×SD2)`, Toichi CVI/CSI coordinates all correct.
- Composite scores `experimental`; Toichi/Baevsky `validated`; ANS-age/VO₂/BP proxies `heuristic`;
  grades gate-green; anchors + abbr-map targets all resolve.

**Fixed:**
1. CSS header comment *"…driven by CPAP_REGISTRY"* → **HRV_REGISTRY**.
2. Quick-Jump label **"10 sections"** → **"11 sections"** (11 `.rs` sections).

---

## GlucoDex Reference.html — ✅ audited (gate green)

CGM node. **All 9 DOIs correctly map to the expected papers** (CGM-consensus + risk indices):
Battelino 2019 (Diabetes Care 42:1593, 10.2337/dci19-0028), Battelino 2023 (Lancet D&E,
10.1016/S2213-8587(22)00319-9), Bergenstal 2018 (Diabetes Care 41:2275, 10.2337/dc18-1581),
Nathan/ADAG 2008 (10.2337/dc08-0545), Service 1970 (Diabetes 19:644, 10.2337/diab.19.9.644),
McDonnell 2005 (Diabetes Technol Ther 7:253, 10.1089/dia.2005.7.253), Wójcicki 1995 (Horm Metab Res
27:41, 10.1055/s-2007-979906), Hill 2007 (Diabet Med 24:753, 10.1111/j.1464-5491.2007.02119.x),
Kovatchev 2006 (Diabetes Care 29:2433, 10.2337/dc06-1085).
- **Displayed formulas all canonical:** GMI = 3.31 + 0.02392·mean; eA1c = (mean+46.7)/28.7;
  J = 0.001·(mean+SD)²; TIR 70–180; TITR 70–140; CV<36% stable.
- **Clock Contract:** date example states "MDY for CGM exports, never a locale guess" — matches the
  GlucoDex `preferDMY=false` rule (brief §3/§7).
- Consensus metrics `validated`, fusion composites `experimental`, metabolic age `heuristic`;
  grades gate-green; anchors + abbr-map targets all resolve.

**Fixed:**
1. CSS header comment *"…driven by CPAP_REGISTRY"* → **GLU_REGISTRY**.
2. Quick-Jump label **"12 sections"** → **"14 sections"** (14 `.rs` sections).

---

## CPAPDex Reference.html — ✅ audited (gate green)

CPAP/APAP therapy node (registry legitimately **is** `CPAP_REGISTRY` — header comment correct, no fix).
- **Displayed constants all match the registry/brief:** Large-Leak >24 L/min, Flow-Limited >0.3,
  Snore >0.2, AASM 3% ODI, Compliance = nights(≥4 h)/30 d with CMS "≥4 h on ≥70% of nights / 90-day"
  rule.
- **Citations real & correctly attributed:** Morgenthaler TI et al. *Complex sleep apnea syndrome* —
  Sleep 2006;29(9):1203–9 (doi 10.1093/sleep/29.9.1203); Kemp & Olivan *EDF+* — Clin Neurophysiol
  2003;114(9):1755–61 (doi 10.1016/S1388-2457(03)00123-8); AASM Manual (Berry et al.) → official
  aasm.org scoring-manual page; ICSD-3 (AASM 2014); **CMS NCD 240.4 → official cms.gov NCD database
  (ncdid=226, the correct ID for 240.4) — not a guessed deep link**; ResMed AirSense spec honestly
  marked "manufacturer, not peer-reviewed"; flow-limitation/I:E honestly "CPAPDex implementation."
- All standards link to org landing pages (no fabricated DOIs); grades gate-green; anchors +
  abbr-map targets all resolve.

**Fixed:**
1. Quick-Jump label **"15 sections"** → **"16 sections"** (16 `.rs` sections).

---

## Summary

All 7 reference guides audited and gated green (`Dex-Test-Suite.html` 513 / 30, all green).
**Substantive fix:** OxyDex SBII (misnamed + over-claimed external validation on an internal
approximation) + two dishonest "validated" badges (HD94, Hypoxic Load). **Cosmetic/comment fixes:**
five guides carried a copy-paste `CPAP_REGISTRY` header comment (PpgDex, PulseDex, HRVDex, GlucoDex →
corrected to their own registry; ECGDex had none; CPAPDex's was correct) and six guides had an
inaccurate Quick-Jump section count (PpgDex, PulseDex, HRVDex, GlucoDex, CPAPDex corrected; ECGDex was
already right). **Every citation across all guides verified** real with resolving DOIs/official links;
no fabrications remain. **Flagged for separate back-compat node changes (not edited):** `oxydex-
registry.js` `sbii.cite` ("instability"→"impairment") and `pulsedex-registry.js` `pip.cite`
(">69% AF risk, 2025"). No node source, registries, or bundles were modified; nothing re-bundled.

---

## CI wiring — leaf modules brought under the shared gate (2026-06-19)

**Problem:** not every module had a CI gate. The shared suite (`tests/dex-tests.js`, run by both
`node tests/run-tests.mjs` and `Dex-Test-Suite.html`) behaviorally executed only `ecgdex-dsp`,
`ppgdex-dsp`, `integrator-dsp` + all registries/guides. `cpapdex-dsp`/`cpapdex-edf` were self-tested
**browser-only**; `ecgdex-morph`/`ppgdex-morph` had **no explicit assertion** in either runner; and the
existing `selfGateDesat` cpapdex source-mirror **silently skipped** in Node (file absent from
`readSources`).

**Fix (3 files, shared-suite-first):**
- **`tests/dex-tests.js`** — new shared group *"Leaf-module coverage — CPAPDex DSP/EDF self-tests +
  morphology"*: runs `env.CpapEdf.selfTest()` and `env.CpapDsp.selfTest()` (assert `fail===0`, surfacing
  any ✗ log line) and gates `env.ECGMorph.analyze` / `env.PPGMorph.analyze` presence. Runs in **both**
  runners now.
- **`tests/run-tests.mjs`** — loads `ecgdex-morph`, `ppgdex-morph`, `cpapdex-edf`, `cpapdex-dsp` into the
  Node sandbox in a **separate guarded block** (a load failure becomes a RED test via the missing-env
  assertion, never a fatal `exit(2)`); exposes `CpapDsp/CpapEdf/ECGMorph/PPGMorph` in `env`; adds those
  four files to `readSources` (which also activates the previously-dormant cpapdex `selfGateDesat`
  mirror + cross-drift checks in Node). Morph loads before the tests so `ECGDSP`/`PPGDSP` `analyze` run
  morph-active, matching the browser.
- **`Dex-Test-Suite.html`** — loads `ecgdex-morph.js`/`ppgdex-morph.js` as scripts, adds them +
  `cpapdex-edf.js` to `SOURCE_FILES`, and exposes the four modules in the browser `env`.

**Verified:** `Dex-Test-Suite.html` now **517 passed / 31 groups, all green** (was 513/30 → +1 group,
+4 assertions), console clean. Crucially, loading the morph modules made the suite's `ECGDSP.analyze`
tests **morph-active** and they stayed green — proving the exact module config Node will now run is safe
(the modules are `window`-IIFE, load cleanly in the Node `vm` sandbox, and their `--selftest` CLI block
no-ops because the sandbox has no `process`). Recommend a one-time `node tests/run-tests.mjs` to confirm
Node parity in CI (couldn't be run from the design environment).

**Still intentionally browser-only** (DOM/iframe-bound, can't run headless): the render-coverage groups
and `cpapCoimportGroup` — these remain in `Dex-Test-Suite.html` as designed.

---

## Dimension-3 sweep, 2026-08-03 — the same night banded two ways in OxyDex

The brief's dimension 3 asks that normative bands be "defensible, not invented" and that boundaries be
sanity-checked. It aims at the GUIDES. Checking the **code against itself** is the cheaper half and had
never been done: `tools/severity-ladder-audit.mjs` looks for one metric expression carrying two
different `good/warn/bad` ladders inside a node.

**Result: 5 conflicting of 198 laddered expressions across 21 render/app files.** One is a false
positive (`hrvdex-render.js` reuses a local `v` across unrelated metrics — the tool warns about exactly
this and does not suppress it). The other **four are real, and all four are OxyDex**:

| metric | `renderSmartSummary` (:2011) | `nightDetail` (:2478) |
|---|---|---|
| HR-Var SD | `≥3` good · `≥2` warn | `≥4` good · `≥2.5` warn |
| HR Floor | `≤52` good · `≤60` warn | `≤55` good · `≤65` warn |
| HR Slope | `≤0` good · `<1` warn | `<0` good · `<1.5` warn |
| **ODI-3** | `<5` good · `<15` warn | `<15` good · `<30` warn |

Both functions take **the same night object `n`**. So HR Floor 54 bpm reads *warn* on the Smart Summary
and *good* on the Night Detail; HR-Var SD 3.5 reads *good* then *warn*; ODI-3 12/hr reads *warn* then
*good*. One of each pair is wrong no matter which band is right. (Not verified: whether both surfaces
are ever visible at the same instant — they are reached by navigation. The contradiction stands either
way, because the value has not changed.)

### ODI-3 is the sharpest case, because it has NO published band at all

`OxyDex Reference.html` publishes a severity table headed **"ODI-4 (events/hr) Classification"** —
`<5` Normal · `5–14.9` Mild · `15–29.9` Moderate · `≥30` Severe. For ODI-3 it says only that it "is more
sensitive for mild hypoxemia". There is no ODI-3 band in the guide, and `oxydex-registry.js` carries
only a citation string (`AASM 3% oxygen desaturation index`), no thresholds.

So the code invents an ODI-3 cut-point **twice, differently**: one site borrows ODI-4's bands unchanged,
the other shifts them one severity notch. Dimension 3's own words — *"No fabricated clinical
cut-points"* — apply, and the fabrication is visible precisely because it was done inconsistently.

### Why no fix is proposed here

Picking the winning ladder IS choosing a clinical cut-point, which this brief forbids doing on
judgement. The two honest routes:

- **(a) Cite one.** Find the published ODI-3 severity banding (and the HR-proxy bands), put it in the
  guide, and make both surfaces use it.
- **(b) Refuse to grade.** Render ODI-3 (and the 1 Hz HR proxies) **neutral**, as `oxydex-render.js:3009`
  already does for ODRI — *"ranges not yet established — values are relative"*. That removes an invented
  cut-point rather than choosing between two.

(b) needs no literature and matches an in-repo precedent; (a) is better if the band exists. Either is a
render change → OxyDex re-bundle, so it should be scheduled rather than folded into an audit pass.
~~**Owner's call.**~~

### RESOLVED 2026-08-18 — (a) DOES NOT EXIST, so (b) is determined rather than chosen

The call presupposed there was a number to pick. There is not, and searching settled it rather than
deciding it — which is a stronger disposal, because a decision would need re-deciding the moment someone
found a paper.

**There is no consensus ODI-3 severity ladder.** What the literature carries for ODI-3 are
**population-specific DIAGNOSTIC cut-offs against AHI**, and they scatter by cohort: ODI-3 ≥ 4.3 /hr for
AHI ≥ 5 (ring oximeter, n = 164; and ≥ 4.3 in snoring children, n = 112), ≥ 13.1 for AHI ≥ 15, > 12 for
AHI ≥ 5 at 100 % specificity but ≥ 26 for AHI ≥ 15 (n = 1141 + 1141), ≥ 10 in infants. A diagnostic
threshold answers "is disease present against this reference", not "how severe is it" — different
question, and the numbers do not form a ladder.

**And the borrow was not neutral.** ODI-3 vs AHI-flow concordance is only **fair (κ = 0.32)**, with ODI-3
systematically classifying *more* severe (Senaratna 2019, n = 296). So the site that imported ODI-4's
bands unchanged was not making a conservative approximation — it was biased toward over-calling, in the
direction that matters clinically.

**Fixed, both sites, four metrics** — all now `neutral` / ungraded:

| metric | was (smart summary) | was (night detail) |
|---|---|---|
| `odi3.rate` | `<5` / `<15` ← ODI-4's band verbatim | `<15` / `<30` ← shifted a notch |
| `hrSdnn` | `>=3` / `>=2` | `>=4` / `>=2.5` |
| `hrFloor` | `<=52` / `<=60` | `<=55` / `<=65` |
| `hrSlope` | `<=0` / `<1` | `<0` / `<1.5` |

`severity-ladder-audit` goes **5 conflicting → 1**, the survivor being the audit's own documented false
positive (`hrvdex — v`, a shared local name colliding across unrelated metrics).

**The three HR proxies rest on a different and stronger argument than ODI-3**, and it is worth keeping
distinct: they are OxyDex-derived 1 Hz statistics with no external literature, so "no published band" is
trivially true and proves little. What condemns them is the **internal contradiction** — two ladders means
at least one is invented, and a reader saw the same night called two things on two screens. The precedent
is *inside the same block*: `RMSSD` and `Noc. Dip` were **already** `neutral` for being 1 Hz proxies, and
Night Detail already labels the section *"(relative comparison only)"* — a relative measure carrying a
good/warn/bad ladder contradicts its own label. These three were the inconsistent members of a block that
had already decided the question.

⚠ **`odi3` keeps `evidence: 'validated'`, deliberately, and the distinction is the point.** The tier is
for the **measurement** — AASM defines a 3 % desaturation index and counting it is validated — **not for a
severity band**, which is exactly what has just been shown not to exist. A metric's evidence tier does not
transfer to a ladder applied to it. Do **not** reconcile the two by restoring a ladder because the badge
says `validated`; that is the wrong direction, and it is the `desatProfile` shape (a tier attached to
something the code declines to adjudicate). If a published band is ever found, cite it and grade **both**
sites at once — never one.

The guide now states this at the ODI selection note, so the surface and the code agree.


## Dimension-2 sweep, 2026-08-18 — two formulas the guide printed and the code does not compute

Dimension 2 asks that a displayed formula match what the node actually computes. Swept mechanically:
extract every formula block from `OxyDex Reference.html`, pull its distinctive numeric constants, and
check each against the **whole** OxyDex source set. **113 formulas; 23 carry a distinctive constant; 3
flagged; 2 real.**

⚠ **The first run said 6, and 3 of those were my own denominator error** — the corpus was
`oxydex-dsp.js` + `oxydex-render.js` only, while OxyDex is **8 files**; Karvonen lives in
`oxydex-profile.js` and was "absent" solely because nothing had read it. Fixing the corpus took 6 → 3.
The remaining false positive is `Azarbarzin 2019` (a citation card quoting a paper's cohort sizes and
hazard ratio — described, never implemented), which is the shape the sweep should over-flag rather than
miss.

### LTHR — a different FORMULA, not a different constant

| | |
|---|---|
| guide printed | `LTHR ≈ HR_rest + HRR × 0.87` — an HRR/Karvonen fraction, **uncited** |
| code computes | `Math.round(hrMax * 0.88)` (`oxydex-dsp.js:6192`) — a fraction of **HRmax**, cited **Seiler 2010** |

Not a typo: the two have different *structure*, so they diverge as a function of the user's resting HR.
At HRmax 180 / HRrest 60 the guide's version reads **164.4 bpm** against the app's **158.4** — **6 bpm
high** — and the gap moves with HRrest, so no single correction to the constant would reconcile them.
The guide was corrected to state what the code computes, carrying the code's citation; the old text is
struck rather than deleted, so a reader who remembers the HRR form sees it was withdrawn.

### MAF — the formula is right and incomplete, which is worse than wrong

Guide printed `MAF HR = 180 − age`. The code computes `180 − age` **and then adjusts**: `+5` when
readiness ≥ 85, `−10` when readiness < 55 (`oxydex-dsp.js:6180–6188`). So a reader computing the printed
formula by hand gets a number the app never shows — up to **10 bpm** apart — and nothing on the card
said an adjustment existed. Now documented inline.

### Not a finding, recorded so it is not re-investigated

`SpO₂ FFT` flagged for `0.003`. The card says the dominant frequency is sought in `0.003 – 0.1 Hz`; the
code carries no fixed probe grid at all — `OXYDEX-FFT-CYCLE-NULL-2026-08-16` replaced the hand-picked
probes with **the record's own Fourier bins** plus a Mann & Lees (1996) red-noise significance test, so
there is no band constant to match and the guide's range describes the search envelope rather than a
literal. Left alone; the card's own text is not wrong, and inventing a constant to satisfy a sweep would
be the defect this audit exists to catch.


### Fleet sweep + the defect the sweep found by REFUSING to be helpful

`tools/formula-constant-audit.mjs` (new; the dimension-2 sibling of `severity-ladder-audit.mjs`) over all
7 guides: **381 formulas · 67 carry a distinctive constant · 6 flagged**, all six now explained —
3 ECGDex band cards printing exact period reciprocals of the Hz bands the code uses (`1/0.15 = 6.7 s`),
OxyDex's FFT card (no fixed probe grid exists), and two citation cards quoting a paper's cohort
(`Azarbarzin`) and Beer–Lambert wavelengths (`Jubran`) — described, never implemented.

**Five UNTERMINATED character references were live in `OxyDex Reference.html` — and, because the served
copy is generated from it, they were live ON THE DEPLOY SURFACE.** `docs/OxyDex Reference.html` carried
all five, so a reader of the *published* guide saw `널.8` where an accuracy spec belongs and
`କ events/hr` in a threshold sentence. **This is a shipped user-facing defect, not source hygiene**, and
the two get triaged very differently by whoever reads this next: the first asks "who saw it and for how
long", the second asks "tidy it when convenient". Both copies are fixed here, the served one by
`build-docs` regenerating from the corrected source.

They render as the wrong glyph: `SEE &#xB110.8` is missing its `;`, so a browser consumes hex greedily: `&#xB110` is
U+B110 and renders **널** — a Hangul syllable where **±** was intended. Full list, all fixed:

| line | written | renders as | intended |
|---|---|---|---|
| 2403 | `&#xB110.8` | `널.8` | ±10.8 |
| 2403 | `&#xB11.5` | `଑.5` | ±1.5 |
| 2448 | `&#xB12%` | `଒%` | ±2 % |
| 2478 | `&#xB15 events/hr` | `କ events/hr` | ±5 events/hr |
| 1926 | `&#x201CFair&#x201D;` | **U+FFFD + “ir”** — see below | “Fair” |

**Line 1926 is a different and worse failure than the four `±` cases, and the mechanism is the point.**
`F` and `a` **are hex digits**, so a greedy parser consumes `201CFa` — not just the intended `201C` — and
U+201CFA is **2 104 570**, past the U+10FFFF ceiling of **1 114 111**. So it is not a wrong character but
an *invalid* one: the browser emits U+FFFD, and the word **“Fair” arrives as “ir”** because its first two
letters were eaten INTO the reference. **A malformed entity adjacent to hex-adjacent letters destroys
CONTENT, not punctuation** — the four `±` cases cost a glyph; this one costs a word inside a sentence
describing a threshold. (Mechanism identified by a peer reviewing the finding; recorded because the
severity difference is invisible from the flag itself.)

⚠ **Repaired by hand at five explicit anchors, NOT by a regex pass** — and the reason is this audit's own
thesis. A general "insert `;` into unterminated numeric references" sweep would be the lenient-decoder
mistake wearing the other hat: **a tool that repairs what it should be reporting**. The gate keeps
watching; the edit stays five semicolons.

⚠ **An ad-hoc Python version of this same sweep did NOT find them, and the reason is the lesson.** It
decoded entities with a forgiving parser, which silently "repaired" `&#xB110.8` into `±10.8` and reported
the card clean. **A parser that fixes its input cannot report a broken input.** The shipped tool decodes
only well-formed `&#xNN;` and is therefore strict where the ad-hoc version was kind; that strictness is
what surfaced a rendering bug that has been live in a published guide. The same ad-hoc version also
trimmed trailing zeros from **integers**, so `660` became `66` and matched anything — hiding `Jubran`'s
660/940 nm wavelengths entirely. Two silent false negatives, both from being generous.

The tool also **drops `<s>`/`<del>` content before checking**: a guide that corrects itself keeps the old
formula struck so a reader sees it was withdrawn, and checking a retracted formula against code would
flag every honest correction forever — making deletion of the evidence the cheapest way to go green.
And its self-test **counts** its legs rather than printing a literal, after a hardcoded `8/8` survived a
ninth leg being added.


## Dimension-5 sweep, 2026-08-18 — the defect that REMOVING something leaves behind

`tools/guide-anchor-audit.mjs` (new; the dim-5 sibling of `severity-ladder-audit.mjs` and
`formula-constant-audit.mjs`). Fleet: **768 internal links · 269 ids · 246 abbreviations · 246 map
entries** across 7 guides. **Two defects, both OxyDex, both now fixed; every other guide clean.**

### `BP` / `SBP` / `DBP` jumped to a section deleted two months earlier

The abbreviation index mapped all three to `profile` — an id that does not exist. It used to: an HTML
comment in the guide records **"BP PROJECTION section REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT)…
`bpProj` is hard-null in dsp since 2026-06-21; cuffless BP from signals is indefensible."** The section
went; the three jump-links pointing INTO it did not. A reader clicking BP in the abbreviation index has
gone nowhere since June.

**This is the shape worth naming: a removal is not finished when the thing is gone.** Every reference
*into* it is now dangling, and references are held in a different structure from the thing itself — here,
a JS map at the bottom of the document, which no metric-registry or badge gate can see. Repointed to
`refs-formulas`, which is where cuff BP actually lives (it carries SBP, DBP and `MAP = DBP + ⅓(SBP −
DBP)`), consistent with the removal note's own instruction that `prof_sbp`/`prof_dbp` survive as
user-entered cuff inputs "documented elsewhere".

### `MODL` was mapped and jumpable but never defined

Present in `abbrSectionMap`, targets a real section, used as a quick-jump chip in the prose — and absent
from `abbrs[]`, so the abbreviation index had no entry for it. Added from the guide's own card heading:
**Mean Oxygen Desaturation Level**.

### Two instrument errors, recorded because both were mine and both over-reported

- **Seven phantom dead links** — one per guide, all identical: `href="#'+target+'"`, a runtime-built href
  inside a `<script>`. Reading JavaScript as markup. The tool strips `<script>` blocks first, and its
  self-test plants exactly that string to prove it.
- **Six phantom undefined abbreviations where one was real** — the abbreviation list stores `SpO\u2082`
  and the comparison saw an un-decoded key. The tool decodes `\uXXXX` and `&#xNN;` on BOTH sides before
  comparing.

In both cases the first number was larger and more alarming than the truth. A sweep that over-reports is
recoverable; the discipline is to read every flag before believing any of it.

---

## Dimension-2, second pass 2026-08-18 — the card that documented the method its code REPUDIATES

The first dimension-2 pass swept OxyDex only. Run fleet-wide (`tools/formula-constant-audit.mjs`, 7
guides, 381 formulas, 67 constant-bearing) it raised **6 flags**. Five are questions the tool is right to
ask and wrong to call defects; **one is the most serious guide defect found in this audit.**

### 🔴 `SpO₂ FFT` — stale on four independent counts, describing a method the code calls uninformative

The card was written for the pre-2026-08-16 implementation and was never revised when
`OXYDEX-FFT-CYCLE-NULL-2026-08-16-BRIEF` replaced it — **two days before this sweep.**

| the card said | `oxydex-dsp.js` does |
|---|---|
| `argmax \|X(f)\|²` | tests peak **HEIGHT** against a fitted AR(1) red background (Mann & Lees 1996) |
| band `0.003 – 0.1 Hz` | `_FFT_LO_HZ = 0.005` → `_FFT_HI_HZ = 0.05` (200 – 20 s) |
| `DFT on ≤3600 samples` | the record's **own Fourier bins** (k/N), `_FFT_MAX_BINS = 400`, strided |
| `None / >120 s` ⇒ no pattern | returns **null** whenever no bin clears significance, at ANY period |

Only the constant `0.003` was mechanically detectable — the tool flags a number in a formula that appears
nowhere in the node's source. The other three came from **reading the card against the code once the
constant had pointed at it.** That is the intended use and worth stating plainly: the sweep is a
*finder*, not a *judge*, and its yield here was one true positive that opened onto three more.

The method claim is the serious one, because the code does not merely differ — it **argues against the
card**: *"in a red spectrum the argmax sits near the low-frequency end by construction, so its position
carries no information."* A reader following the guide would attribute meaning to a number the
implementers deliberately stopped producing. The band error compounds it: `0.003 Hz` is a 333 s period,
outside the searched range entirely, so the card promises detections the code cannot return.

**Fixed** — card rewritten to state the periodogram, the real band and bin policy, the red-noise
background, the Šidák + ×2.2 inflation threshold, and the null return. The `>120 s` row became `None`,
since a long period is now reported as null rather than as a long period.

⚠️ **`oxydex-dsp.js:1696`'s own header comment is ALSO stale** — it reads `0.01–0.05 Hz band` against
constants of `0.005–0.05`. **Deliberately NOT fixed here.** A comment edit changes the inlined asset
text, so `manifestHash` **and** `computeHash` both move, which owes a corpus re-verification of every
OxyDex fixture (§🔏) for a cosmetic gain. It should ride the next PR that touches that file's compute
path for a real reason. Recorded so it is neither lost nor re-discovered as new.

### The five non-defects, triaged (a flag is a question)

- **ECGDex ×3 — `6.7`, `6.7`, `333` in a `Band` field.** All are reciprocal restatements for the reader:
  `1/0.15 = 6.7 s`, `1/0.04 = 25 s`, `1/0.003 = 333 s`. The Hz bounds themselves are all present in the
  code. Not independent constants, and the guide is *more* readable for including them.
- **OxyDex `Azarbarzin 2019` — `743`, `2.73`.** Extractor noise from the cohort sizes `n=2,743 / n=5,111`;
  the thousands separator splits one number into two. A citation's sample size is not a formula constant.
- **OxyDex `Jubran 1999` — `660`, `940`.** The red/IR wavelengths in **nm** of the sensor's Beer–Lambert
  principle, described in the cited paper. OxyDex consumes SpO₂; it never computes from raw absorbance,
  so these correctly appear nowhere in its source.

The reciprocal and thousands-separator cases are mechanically separable and worth encoding in the
extractor; the Jubran case is not (a "constant the cited hardware uses, which we do not implement" cannot
be told from a missing one by inspection). Left as **5 standing questions rather than a suppression
list** — a list of known-fine flags goes stale silently, which is the failure this whole audit is about.

## Dimension-7 sweep, 2026-08-18 — NOT APPLICABLE, which is a different answer from CLEAN

Dimension 7 asks that Clock Contract examples in the guides obey the contract (floating `tMs`, `getUTC*`
readback, explicit vendor regexes, never a fabricated `now()`). Swept all 7 guides. The result is **zero
defects, and that number means nothing on its own** — so here is the denominator instead:

| probe | hits across 7 guides |
|---|---|
| ISO / `YYYY-MM-DD HH:MM` / vendor `DD/MM/YYYY` / 14-digit stamps | **0** |
| wall-clock `HH:MM[:SS]` strings | **2**, both in one GlucoDex formula |
| `tMs` | 0 · `getUTC` | 1 · "floating" | 3 |

The 14-digit "stamps" an early pass reported were **DOI fragments** (`10.1056/NEJM198710223171717`) —
a reminder that the probe, not the corpus, produced them.

The two real hits are one card: *"count of distinct episodes &lt; 70 mg/dL during 00:00–06:00"*. That is
a **nocturnal window definition, not a parsing example**, and it is contract-consistent as written: the
binning runs on floating `tMs` read back with `getUTC*`, so `00:00–06:00` is the recording's own local
civil night and is viewer-timezone-independent by construction. No fix.

**So dimension 7 is closed as NOT APPLICABLE to this corpus, not as PASSED.** The reference guides are
metric-definition documents; they define what a number means, and never demonstrate parsing a vendor
timestamp. A dimension with no surface cannot be evidence that the surface is correct — reporting "0
defects" here would be precisely the vacuous green this audit keeps finding elsewhere. If Clock Contract
examples are to be audited, the surface is the app code, `docs/**`, and `CLAUDE.md` §🔒 itself — all of
which do carry them — and that is a different brief.

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

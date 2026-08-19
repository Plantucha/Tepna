**Status:** IN-PROGRESS — 2026-08-03 (**2026-08-04: the browser/interaction box is DRIVEN and CLEAN — 7/7 guides, 0 console errors, theme·quick-jump·both searches·drawer all exercised and observed changing state, 0 px overflow at 390 px; nav-highlight scroll-spy: see the 2026-08-09 PROOF below — this clause said "unproven" for ten days after the body recorded the proof.** dimension 4 gate-enforced by `cohesion-badges`; **dimension 3's code-side half now swept** — `tools/severity-ladder-audit.mjs`, 5 conflicting of 198 laddered expressions, 4 real and all OxyDex: the same night is banded two ways between `renderSmartSummary` and `nightDetail`, and **ODI-3 has no published band at all** yet is given two different invented ones. Findings in `audits/REFERENCE-GUIDE-AUDIT-FINDINGS.md`; **dimension 5 swept fleet-wide 2026-08-18 — `tools/guide-anchor-audit.mjs`, 768 links / 246 abbreviations, 2 defects both OxyDex: `BP`/`SBP`/`DBP` jumped to a section deleted 2026-06-23 with the bpProj metric (repointed to `refs-formulas`), and `MODL` was mapped-and-jumpable but never defined in `abbrs[]` (added). Fleet now 0.** **dimension 2 swept for OxyDex 2026-08-18 — 113 formulas, 2 real defects: `LTHR` printed an HRR-based formula the code has never implemented (code: `HRmax × 0.88`, Seiler 2010 — ~6 bpm apart at HRmax 180/HRrest 60), and `MAF` omitted the readiness adjustment the code applies (±5/−10, up to 10 bpm). Both corrected in the guide; the sweep's own first run over-reported 6 → 3 because its corpus was 2 of OxyDex's 8 files.** **dimension 3 CLOSED 2026-08-18 — no owner call was needed after all: option (a) "cite a published ODI-3 band" DOES NOT EXIST** (the literature carries only population-specific diagnostic cut-offs against AHI, 4.3–26 /hr, and ODI-3 agrees with AHI only fairly, κ 0.32, while over-classifying — so borrowing ODI-4's ladder was biased, not conservative). All 4 real conflicts neutralised in both sites; `severity-ladder-audit` 5 → 1 (the survivor is its own documented false positive). The 3 HR proxies rest on the INTERNAL contradiction, not on absent literature — `RMSSD`/`Noc. Dip` in the same block were already neutral. `odi3` keeps `evidence: validated` on purpose: the tier is for the count, not for a band. **dimension 2 swept FLEET-WIDE 2026-08-18 — 7 guides, 381 formulas, 67 constant-bearing → 6 flags, 1 real: OxyDex's `SpO₂ FFT` card documented the argmax method that `OXYDEX-FFT-CYCLE-NULL-2026-08-16` had replaced TWO DAYS EARLIER, stale on four independent counts (method, band `0.003–0.1` vs `0.005–0.05` Hz, `≤3600`-sample cap, null semantics). Only the constant was mechanically detectable; the other three came from reading the card once it pointed there — the sweep is a finder, not a judge. The remaining 5 flags are triaged non-defects (reciprocal period restatements, a thousands-separated cohort size, a cited sensor's nm wavelengths), left as standing questions rather than a suppression list.** **dimension 3's FLEET half is NOT mechanically decidable** — three citation-presence proxies flag 135/166, then 68, then ~26, and all three are wrong (the last because every `validated` band traces to a real standard: ATTD, Bergenstal, Kovatchev, Bazett, Baevsky, AASM). The proxy measures citation LOCALITY and this suite centralises citations by design. **True narrower result: no `validated`-tier band in any of the 7 guides is invented.** OPEN: whether the `emerging`/`experimental`/`heuristic` disclaimers are honest — per-metric reading, not a sweep. **dimension 7 CLOSED as NOT APPLICABLE 2026-08-18** — the guides carry ZERO timestamp-parsing examples (0 ISO/vendor/14-digit — the 14-digit hits were DOI fragments; 2 wall-clock strings, one GlucoDex nocturnal window, contract-consistent). A dimension with no surface is not evidence the surface is correct. **dimension 6 clean, after fixing 3 correction-history violations this audit's own execution introduced.** **dimension 3's LAST half CLOSED 2026-08-19 — the per-metric honesty reading is done, and it found 2 real defects, both OxyDex, both `heuristic`.** ⚠️ **A fourth citation-presence proxy was built and thrown away first**, exactly as this header already warned: it flagged **69 of 76** lower-tier banded cards as uncited, which is the same locality artefact that produced 135/68/26. The discriminating filter is not *is it cited* but *does the band issue a CLINICAL DIRECTIVE it has not earned* — 53 lower-tier bands use verdict words, but only **3** tell the reader to act, and that set is small enough to read. Read: **OxyCrash** (heuristic) carried invented 2/8/20-per-hour cut-points ending *"Severe — evaluate immediately"*, with no citation, no `no-norm-note` and a generic badge title — neither (a) nor (b), fixed by removing the directive and adding the note; **Positional Shifts** (heuristic) hedged correctly in prose (*"may indicate"*) then hardened it in the band to *"screen for PLMS/RLS"* at an invented >20 cut — softened to match its own prose, note added. **MOS is NOT a defect and is deliberately left**: despite the strongest-looking directive in the fleet (*"Urgent sleep specialist referral"*) it is the one card that states *"Not the published McGill Oximetry Score"*, names it as pediatric (Brouillette/Nixon) and says *"is not validated"* — the disclaimer the criterion asks for, present and explicit. The strongest wording had the strongest hedge; the quiet cards were the dishonest ones. nav-highlight scroll-spy is NOT open: PROVEN 2026-08-09, 111/111 testable sections across all 7 guides, probe shown to FAIL first (neutered `window.scrollTo` → `followed=0`) — the [x] box in this brief's own body recorded it while this header kept saying otherwise for ten days. Corrected 2026-08-19) · **Created:** (undated — pre-2026-07-03, grandfathered)

# Build Brief — Deep Audit of ALL Reference Guides

> **For a fresh AI coder.** Read `CLAUDE.md` first (the two gates, the Evidence-badges section, the
> Clock Contract), then `SYSTEM-COHESION-BRIEF.md` (the badge/grade contract), then this. Your job is
> to **audit, verify, and correct** the seven single-signal reference guides — not redesign them. The
> guides are static, hand-authored HTML docs (no `*-dsp.js` / `.src.html`, **not bundled, not inlined**).
> They are the *consumer* in the cohesion contract: when a guide and the node registry disagree, **fix
> the guide**, never the registry (the registry ships in the app and is test-backed).

## Scope — the artifacts under audit

| Guide | Grade authority (registry) | Node DSP (formula truth) |
|---|---|---|
| `OxyDex Reference.html` | `oxydex-registry.js` (`OXY_REGISTRY`/`OxyRegistry`) | `oxydex-dsp.js` |
| `ECGDex Reference.html` | `ecgdex-registry.js` (`ECG_REGISTRY`/`EcgRegistry`) | `ecgdex-dsp.js` · `ecgdex-morph.js` |
| `PpgDex Reference.html` | `ppgdex-registry.js` (`PPG_REGISTRY`/`PpgRegistry`) | `ppgdex-dsp.js` · `ppgdex-morph.js` |
| `CPAPDex Reference.html` | `cpapdex-registry.js` (`CPAP_REGISTRY`/`CpapRegistry`) | `cpapdex-dsp.js` · `cpapdex-edf.js` |
| `PulseDex Reference.html` | `pulsedex-registry.js` (`PULSE_REGISTRY`/`PulseRegistry`) | `pulsedex-dsp.js` |
| `HRVDex Reference.html` | `hrvdex-registry.js` (`HRV_REGISTRY`/`HrvRegistry`) | `hrvdex-dsp.js` |
| `GlucoDex Reference.html` | `glucodex-registry.js` (`GLU_REGISTRY`/`GlucoRegistry`) | `glucodex-dsp.js` |

The Integrator has no per-node registry and no guide — out of scope.

Do **one guide fully** (all dimensions below → fix → re-gate) before starting the next. Commit-quality per guide.

---

## The audit dimensions — check EVERY one, per guide

### 1. Citations: real, correctly attributed, and resolving
Treat every citation as **guilty until verified** (this is how OxyDex shipped fabricated "Hartmann 2019"
/ "Castillo 2018" before the last audit). For each citation in the guide (Academic References table,
Citation Map, Formula Provenance, and any inline `cite`/title text):
- **Author · title · journal · year · volume:pages · DOI all match one real paper.** A real author on
  the wrong paper is still an error. A real paper with a wrong year/volume/DOI is still an error.
- **Every DOI/PMID must resolve.** Open `https://doi.org/<doi>` (or `pubmed.ncbi.nlm.nih.gov/<pmid>`)
  and confirm it lands on the cited work — not a 404, not a different paper. Books/standards → official
  publisher/org landing page or ISBN, never a guessed deep link.
- **Cross-guide consistency:** a source shared by several guides (e.g. Task Force 1996, Brennan 2001,
  Uth–Sørensen 2004, Peng 1995) must carry the **same** verified string + DOI in all of them. Diff them.
- **Never invent or "fix" a DOI by guessing.** If you cannot confirm it, do not print it — see §6.
- Seed list to verify exactly (confirm each — do NOT trust this brief's spelling/coordinates):
  Task Force 1996 (Circulation 93:1043); Brennan 2001 (IEEE TBME 48:1342); Peng 1995 (Chaos 5:82);
  Richman & Moorman 2000 (AJP 278:H2039); Bauer 2006 (Lancet 367:1674); Costa 2017 (Front Physiol 8:255);
  Toichi 1997 (J Auton Nerv Syst 62:79); Baevsky & Chernikova 2017 (Cardiometry 10:66); Lomb 1976 /
  Scargle 1982; Takazawa 1998 (Hypertension 32:365); Lima 2002 (Crit Care Med 30:1210); Allen 2007
  (Physiol Meas 28:R1); Elgendi 2012 (Curr Cardiol Rev 8:14); Schäfer & Vagedes 2013 (Int J Cardiol
  166:15); Guilleminault 1984 (Lancet 1:126); Uth–Sørensen 2004 (Eur J Appl Physiol 91:111); Tanaka
  2001 (JACC 37:153); Battelino 2019 (Diabetes Care 42:1593); Battelino 2023 (Lancet D&E 11:42);
  Bergenstal 2018 (Diabetes Care 41:2275); Nathan/ADAG 2008 (Diabetes Care 31:1473); Service 1970
  (Diabetes 19:644); McDonnell 2005 (Diabetes Technol Ther 7:253); Wójcicki 1995 (Horm Metab Res 27:41);
  Hill 2007 (Diabet Med 24:753); Kovatchev 2006 (Diabetes Care 29:2433); Morgenthaler 2006 (Sleep
  29:1203); Kemp & Olivan 2003 (Clin Neurophysiol 114:1755); AASM Scoring Manual; ICSD-3 (2014);
  CMS NCD 240.4.

### 2. Formulas: correct AND matching what the node actually computes
For every Formula/Method block:
- **Canonical correctness.** The displayed formula must match the metric's standard definition. Spot
  targets: `GMI = 3.31 + 0.02392·mean(mg/dL)`; `eA1c = (mean+46.7)/28.7`; `J-index = 0.001·(mean+SD)²`;
  `HRmax = 208 − 0.7·age` (Tanaka — **never** 220−age); `SD1 ≈ RMSSD/√2`; `SampEn = −ln(A/B)`, m=2,
  r=0.2·SD; QTc Bazett `QT/√RR`; `Baevsky SI = AMo/(2·Mo·MxDMn)`; `CV = SD/mean×100`; TIR band 70–180;
  the AASM 3% ODI definition; the CMS ≥4 h / ≥70% / 90-day adherence rule.
- **Code-vs-doc agreement.** Open the node's `*-dsp.js` (and `*-morph.js` / `*-edf.js`) and confirm the
  doc's formula is what the code computes (OxyDex previously shipped a doc that contradicted the code).
  Where the code uses a constant/threshold (e.g. the 24 L/min large-leak gate, FL>0.3, snore>0.2, SQI≥0.5,
  the 50 ms pNN threshold, 7.8125 ms histogram bins), the doc's number must match the code's number.
- **Internal coefficients** with no external source must be labelled "internal / no external source",
  never attributed to a paper.

### 3. Normative tables / thresholds: defensible, not invented
- Every normative band table must be either (a) a published/consensus target (cite it — TIR>70%, CV<36%,
  TBR<4%, CMS ≥4 h, ODI/AHI severity bands, Decel-Cap risk bands, etc.) **or** (b) explicitly marked
  relative ("no fixed clinical cut-point") via the `no-norm-note`. **No fabricated clinical cut-points.**
- Sanity-check the band **directions and boundaries** (good vs bad rows not inverted; ranges contiguous,
  no gaps/overlaps; units correct: mg/dL vs mmol/L, ms vs s, L/min vs L/s, cmH₂O).

### 4. Grade/badge conformance (this is gate-enforced — make it pass)
- Every metric card's `ev-corner ev-<tier>` MUST equal that metric's `evidence` in the node registry,
  for any card label the node's **own** `idForLabel` resolves. The `cohesion-badges` group in
  `tests/dex-tests.js` checks this in BOTH runners — a mismatch is a hard fail, not a nitpick.
- Disc CSS in each guide must be byte-identical to the engine (`MetricRegistry.BADGE_CSS` ≡
  `dex-badges.css`). The gate diffs the six disc props per tier; don't hand-edit the `.ev-*` rules.
- **No retired vocabulary** in badge titles (`Proxy `/`Composite `/`Provisionally validated `) and no
  `data-ev=` / `validated-provisional`. No non-canonical `ev-*` class (allowed set only).
- Tier chip (`Core`/`Advanced`/`Research`) and any `data-tier` attribute should match the registry
  `depth` for that metric.

### 5. Links & rendering: nothing dead, nothing broken
- **External links:** every `<a href>` to a DOI/PMID/publisher resolves (§1) and carries
  `target="_blank" rel="noopener"`.
- **Internal anchors:** every `href="#..."` (sidebar nav, mobile drawer, quick-jump `.qm`/`.qj-sec`,
  `↑ back to index`, top-abbr-strip, abbr-card jump links) points at an `id` that exists in the doc.
  Grep every `href="#x"` and assert a matching `id="x"`. Flag orphans both ways (link→missing id,
  and section id with no nav entry).
- **JS sanity:** open each guide in a browser, console must be **clean** (no errors). Exercise: theme
  toggle (persists), quick-jump open + filter + clear, abbreviation search + alpha tabs, mobile drawer
  open/close, back-to-top, IntersectionObserver nav highlight, top-abbr pills populate.
- **Abbreviation index:** every acronym used in the prose appears in the `abbrs[]` list; every
  `abbrSectionMap` target is a real section id; definitions are correct and node-appropriate.
- **Markup hygiene:** no stray non-ASCII in citation strings; entities render (no literal `&#x...;`
  showing); tables well-formed; no duplicate `id`s; headings/labels not truncated.
- **Responsive:** check ~390 px width — nav collapses to the drawer, tables scroll, cards stack, no
  horizontal overflow.

### 6. Honesty rules (epistemic — `ARCHITECTURE-PRINCIPLES.md` §4)
- An unverifiable attribution is **removed or flagged** (a brief "internal / directional / no external
  source" note), never dressed up as authoritative. Replace a fabrication with the correct canonical
  source if one exists; otherwise delete it and label the metric internal.
- Internal composites and population projections must read as such (the experimental/heuristic cards and
  the Validation Matrix must agree on this — cross-check that a card graded `experimental`/`heuristic`
  isn't described elsewhere as validated/measured).
- **No correction-history meta-commentary** in reader-facing text ("corrected this revision",
  "previously mis-stated", "vXX fix"). State the clean final fact only. (Invisible HTML/`//` comments are fine.)

### 7. Clock Contract (only where a time example appears)
These are static docs, but if any guide shows an example timestamp or epoch math it must obey the Clock
Contract (floating `tMs` via `Date.UTC`, read back with `getUTC*`/`{timeZone:'UTC'}`, never `new Date()`/
`getHours()`/now()). Don't restate the whole contract; just keep any example correct.

---

## Method (per guide)

1. **Inventory.** Grep the guide for `\b(19|20)\d{2}\b`, `doi`, `href=`, `class="ma">`, `ev-corner ev-`,
   `<tr class=`, and the Formula blocks. Build a list of every claim, citation, link, formula, table,
   and badge.
2. **Verify each** against: the literature (web — confirm DOIs resolve), the node `*-dsp.js` (formulas +
   constants), and the node registry (grades/depths). Use the node's **own** `idForLabel` to join card↔registry.
3. **Fix the guide** (citations, formulas, tables, grades, links, abbr, copy). Never edit the registry to
   match the doc; if the registry itself is wrong on the merits, that's a *separate* node change under
   `CLAUDE.md`'s back-compat rule — call it out, don't fold it into the doc edit.
4. **Re-gate** (below). Move to the next guide only when green.

## Gates — run after EACH guide (`CLAUDE.md`)
1. **Regression:** open `Dex-Test-Suite.html`, wait ~3 s, `#summary` must read **all green** (currently
   **513 / 30 groups**). The `cohesion-badges` group must show the guide's disc-equivalence + grade-agreement
   assertions passing with zero disagreements. Node CI (`node tests/run-tests.mjs`) runs the same shared
   assertions — keep both green. (All seven guides are already wired into both runners' `env`/`docs` and the
   `NODES` array; you should not need to add wiring, only keep it passing.)
2. **Provenance:** **N/A** — these are static docs; you add no app and re-bundle nothing, so no `buildHash`
   changes and `verify-provenance.html` is unaffected. Do **not** re-bundle anything for a doc edit.
3. **Manual:** open each edited guide in the browser; console clean; spot-check 5 external links resolve and
   5 internal anchors jump correctly.

## Per-guide acceptance criteria
- [x] **DONE 2026-08-04 — all 55 DOIs verified against the DOI registry, and the shared-source
      inconsistency was real but stylistic.**

      **Resolution.** Every DOI in the seven guides (55 distinct, extracted from the `href` form so the
      match cannot be a prose artifact) resolves at `doi.org`. Three initially read as failures — 405 on
      a Thieme DOI, 202 on two IEEE ones — and all three are **publisher-side HTTP behaviour, not
      unregistered DOIs**: `doi.org` returns 302 with a correct `Location` for each. Do not re-flag them;
      resolve against `doi.org`, not against what the publisher does afterwards.

      **Identity — the stronger check.** "Resolves" only proves a DOI exists, not that it is *this*
      paper. Every DOI's registry metadata (CSL JSON: journal · year · volume · issue · pages) was
      compared against the citation text beside it. **55 of 55 match.** Two flagged on year and both were
      disproved: `10.1007/s00421-003-0988-y` (registry `issued` 2003) and `10.1093/eurheartj/ehy624`
      (2018) are **online-first** dates; their `published-print` fields are 2004-01 and 2019-04, and the
      guides' `2004;91(1):111–115` / `2019;40(14):1149–1157` are the correct print citations. **Compare
      against `published-print`, not `issued`, or this brief will keep re-finding two false positives.**

      **Shared sources.** 9 DOIs are cited in more than one guide. All 9 name the same paper; 6 differed
      only in **page-range style** — ECGDex/OxyDex expanded (`1043–1065`), HRVDex/PpgDex/PulseDex
      Vancouver-abbreviated (`1043–65`). Both are valid, but the item asks for identical shared sources,
      so 15 ranges across 3 guides were expanded to **the registry's own `page` value** — an authoritative
      normalisation rather than a house preference. Re-checked after: **0 shared DOIs differ.**

      ⚠ Two of the 19 candidates the sweep produced were **regex artifacts**, not defects (`R1–R39` read
      as `1–R39`, `H2039–H2049` as `2039–H2049` — a leading letter dropped by the capture group). They
      were excluded by hand. A page-range sweep that does not special-case letter-prefixed pagination
      over-reports; only exact-string replacements with a per-edit assertion were applied (15 of 15).

      No citation was replaced or removed — none needed it.
- [~] **Dimension 2, the NAMED formulas — audited 2026-08-04. Three verify clean; the fourth found a
      cross-node trap.**

      | formula | guide | code | verdict |
      |---|---|---|---|
      | HRmax (Tanaka) | `208 − 0.7 × age` | `oxydex-dsp` ×2, `hrvdex-dsp` ×1 — identical | ✓ |
      | GMI (Bergenstal 2018) | `3.31 + 0.02392 × mean` | `glucodex-dsp`: `3.31 + 0.02392 * m` | ✓ |
      | QTc | Bazett `QT/√RR` primary, Fridericia `QT/∛RR` alternative | `ecgdex-dsp` both present | ✓ |
      | **SampEn** | every guide: `m=2, r=0.2` | **values right, ARGUMENT divergent** | ⚠ |

      **`sampEn`'s `r` means two different things.** `ECGDex`/`PulseDex` take it as the **absolute**
      tolerance (callers pass `0.2 * std(seg)`); `PpgDex` takes it as a **multiplier**
      (`tol = (r || 0.2) * sd`); `OxyDex` inlines `r = 0.2 * stdv`. Same name, same arity, opposite
      meaning — in sibling files that are routinely copied between. PpgDex's own comment says its cap
      "matches PulseDex", which is true of the decimation and false of `r`.

      Every node computes r = 0.2·SD today, so no output is wrong. The hazard is the next caller.
      Measured on one 400-interval series (SD 91.4 ms):

      ```
      ECGDSP.sampEn(x,2,0.2*SD) = 0.514     PPGDSP.sampEn(x,2,0.2)    = 0.52   ← same quantity
      ECGDSP.sampEn(x,2,0.2)    = null      PPGDSP.sampEn(x,2,0.2*SD) = 0.01
      ```

      **The asymmetry is the finding.** Mis-calling ECGDex returns `null` — visible. Mis-calling PpgDex
      returns **0.01**: not an error, a plausible value that reads as pathological regularity ("Low
      (regular)" on OxyDex's own scale). A 52× error that renders as a finding.

      **Not unified** — changing either signature moves a DSP, re-bundles and re-records fixtures for a
      defect with **no live instance**. Pinned instead (`dsp · sampen · cross-node-convention`), so a
      future harmonisation is deliberate and a cross-node copy-paste reds. Mutation-verified.
      The other guide dimensions (1, 3, 6, 7) remain per-guide work.
- [x] **DONE 2026-08-18 (OxyDex; dimension 3's code+guide halves)** — Every normative table is published/consensus (cited) or explicitly marked relative; no invented
      clinical cut-points; units/directions/boundaries sane.
      **2026-08-04 — the guides cannot settle the OxyDex conflict.** The code-side sweep left 4 real
      conflicts (`n.odi3.rate` `<5/<15` vs `<15/<30`; `h.hrSdnn` `>=3/>=2` vs `>=4/>=2.5`; `h.hrSlope`
      `<=0/<1` vs `<0/<1.5`; and the `<=55/<=65` pair) pending an owner cut-point call. The obvious
      tie-breaker would be the documented band — `OxyDex Reference.html` is the published contract. It
      **states none**: the guide defines ODI-1/2/3/4, the SDNN proxy and the slope metrics, but attaches
      no numeric severity cut-points to any of them. So the documentation cannot arbitrate, and this
      stays an owner call rather than something the audit can close. Recorded so it is not re-derived.

- [x] **DONE 2026-08-04 — the first three were already gate-green; the FOURTH was gated nowhere, and
      gating it found a real defect in the generated guide.**

      Grade ≡ registry `evidence`, disc CSS ≡ engine, and the retired-vocabulary ban are all covered by
      `cohesion-badges`. The **tier chip / `data-tier`** axis was not: `data-tier` occurred **336 times
      across the guides and ZERO times in the entire test suite.**

      Across the 7 authored guides the mapping was already perfect — `secondary`↔Advanced(`.ta`),
      `research`↔Research(`.tr`), attribute **absent**↔Core(`.tc`), 397/397 with no exceptions. So the
      new gate is a ratchet, not a fix… **for the authored guides.**

      ⚠ **The GENERATED EEGDex guide did not conform, and an ad-hoc sweep could not have seen it** — it
      lives at `codegen/generated/eegdex-reference.html`, so a `*Reference.html` glob at the repo root
      misses it entirely. `codegen/dex-gen.js` emitted `<div class="mc">` with **no `data-tier` at all**
      while rendering the chip from the very same `m.tier` it declined to project. Every generated card
      therefore read as **Core** to anything consuming the attribute while **displaying** Advanced or
      Research. Fixed at the generator (one expression, mirroring the authored convention: emit for
      secondary/research, omit for core) and regenerated — 5 attributes now present. The gate reads
      `env.docs`, which includes the generated guide, which is why it caught what the sweep did not.

      ⚠ **`data-tier` is INERT.** No JS reads it (`dataset.tier`, `getAttribute`) and no CSS selects on
      it in any guide, and the guides are self-contained, so that is the whole picture. It is metadata,
      not behaviour — a drift misrenders nothing today, which is exactly why nothing would notice. If the
      two ever disagree, **trust the CHIP**: it is what the reader sees.

      **Gated** by `cohesion-badges · guide-tier` (6 assertions, both lanes, 407 cards across 8 guides),
      anti-vacuity first (card count ≥ 300, every card has a chip, all three tiers present). Two mutants
      confirm failure by value: flipping one authored chip (2 legs) and introducing an unknown tier value
      (4). Its RED was demonstrated on the real EEGDex defect before the fix, not only on a planted one.
- [~] **Internal half DONE + gate-backed (2026-08-04); external half is UNGATEABLE, deliberately.**
      Measured across all 7 authored guides + the generated EEGDex one: **128 distinct in-page anchors,
      284 ids, ZERO dead and ZERO duplicated.** Nothing needed fixing, so what landed is a **ratchet**
      over a verified-clean state — `Reference guides — every in-page anchor resolves, no duplicate ids`
      in `tests/dex-tests.js`, both lanes (env.docs already carries the guides in each). Mutation-verified
      two ways: renaming one `id` reds with `OxyDex Reference.html → #quick-jump`, and duplicating an
      `id` reds with `OxyDex Reference.html #themeToggleBtn`. A duplicate matters as much as a dead
      anchor and is nastier: the link still *works*, it just lands on the wrong copy.
      **The DOI half is NOT gated and cannot be** — the suite takes no network (§📚's hard line), so a
      resolving DOI is checkable only by a human with a browser. It is left explicitly ungated rather
      than folded in, because a gate named "zero dead links" that silently checks only the internal ones
      is precisely the borrowed-scope dishonesty the neighbouring gates exist to remove.
- [x] **Console clean; quick-jump / abbr search / theme / drawer all work; responsive at ~390 px** —
      **DRIVEN HEADLESS 2026-08-04**, all 7 authored guides, via Playwright + Chromium against a local
      HTTP server. Not "the element exists" — each widget was **exercised** and its state change observed:

      | check | how it was proven | result |
      |---|---|---|
      | console clean | `console`+`pageerror` listeners for the whole load | **0 errors × 7** |
      | theme toggle | click `#themeToggleBtn`, diff `body.light` + computed background | **flips × 7** |
      | quick-jump toggle | click `#qjToggle`, diff `aria-expanded` + panel `hidden` | **opens × 7** |
      | quick-jump search | type into `#qjSearch`, count `.qm:not(.qm-hide)` | **filters × 7** (e.g. OxyDex 113 → 0 on a miss) |
      | abbr search | type into `.abbr-search-inp`, count `#abbrGrid .abbr-card` with `display !== 'none'` | **filters × 7** |
      | mobile drawer | call `openDrawer()` at 390 px, diff computed transform/visibility/opacity | **opens × 7** |
      | responsive 390 px | `scrollWidth − clientWidth` at 390×844 | **0 px overflow × 7** |

      ⚠️ **Read the abbr-search row carefully — it took four attempts and three of the failures were the
      probe, not the page.** (1) Selectors guessed from convention (`#theme`, `[data-search]`) matched
      nothing, reporting theme+search "absent" on all 7 when both exist as `#themeToggleBtn` /
      `.abbr-search-inp`. (2) The probe then typed into the ABBR input while counting the QUICK-JUMP
      mechanism (`[data-hidden]` on `.qj-group`) — two different IIFEs, so it read NO-OP × 7. (3) With the
      right mechanism, CPAPDex and GlucoDex still looked broken because the probe searched `"hr"`, which is
      **not in a CPAP or CGM glossary**; searching `"ap"` → 13 hits (AHI, APAP, ASV) and `"gl"` → 12 (AGP,
      CGM, CONGA) shows the filter working. **A UI probe that reports "broken" is far more likely to be a
      wrong selector than a broken page — verify the mechanism in the source before filing the defect.**
- [x] **nav-highlight — scroll-spy — PROVEN 2026-08-09.** 111/111 testable sections across all 7 guides
      follow the scroll; no multi-highlight (so `setActive` clears), 0 page errors. **The probe was
      shown to FAIL first** — neutering `window.scrollTo` puts every guide at `followed=0`, so the pass
      measures scroll-dependent state rather than passing by construction. Two details that only came
      from reading the mechanism first, as this brief insists: the observer's
      `rootMargin:'-20% 0px -70% 0px'` makes a section active only inside a **20–30 % viewport band**
      (so `scrollIntoView` lands it at 0 % and highlights nothing — the probe places each top at 25 %),
      and `html{scroll-behavior:smooth}` makes every read a race unless forced to `auto`. The
      sections↔nav gap (ECGDex 20/16, OxyDex 33/20) is expected: only `.rs[id]` WITH a nav entry can
      highlight, and those are excluded rather than counted as misses.
- [ ] No correction-history meta-commentary; internal composites/projections honestly labelled and
      consistent with the Validation Matrix.
- [ ] `Dex-Test-Suite.html` all green after each guide; `node tests/run-tests.mjs` green.

## Deliverable
A short findings log per guide (what was wrong → what you changed), plus the corrected guides. Keep the
log OUT of the reader-facing HTML (a separate `REFERENCE-GUIDE-AUDIT-FINDINGS.md` is fine). Do NOT touch
node source, registries, or bundles except to flag a genuine registry/code error for a separate, back-compat-aware change.

## Do NOT
- Do not edit a node registry or `*-dsp.js` to make a guide "pass" — the guide conforms to the node, not
  vice-versa.
- Do not re-bundle any `*.html` app or touch `verify-provenance.html` for a doc change.
- Do not hand-edit the `.ev-*` disc CSS (it is gate-checked byte-for-byte against the engine).
- Do not introduce `@font-face`/CDNs (system-font stacks only) or print a DOI you have not confirmed resolves.
- Do not leave correction-history notes in reader-facing text.

---

## Findings — 2026-08-09

### F1 · `OxyDex Reference.html` sourced a metric that does not exist — FIXED

`BP Projection` was removed on 2026-06-23 (`oxydex-registry.js:195`, external-review WP-A: *"cuffless BP
from oximetry/HRV is indefensible"*). The removal reached **one** table and not the other five places,
so the guide simultaneously said the metric was gone and cited three published papers for it:

| line | what it claimed | verdict |
|---|---|---|
| 2238 | Nieto 2000 *"underpinning BP Projection"*, and published the projection's **internal coefficients** (ODI-4 → +0.37 mmHg SBP / +0.17 mmHg DBP per event·hr) | **worst of the six** — advertised app-internal calibration for a metric the app does not compute |
| 2532 | citation row · BP Projection (ODI contribution) — Nieto 2000 | removed |
| 2533 | citation row · BP Projection (HD94 contribution) — Kim/Azarbarzin 2020 | removed |
| 2581 | citation row · BP projection from nocturnal HR — Palatini 2009 | removed |
| 2691 | Clinical-Equivalence caveat *"BP projection is epidemiological, not a cuff measurement"* | removed — a caveat for a dead metric |
| 2609 | validation matrix · **REMOVED 2026-06-23** | **kept** — this is the honest record |

Azarbarzin and Palatini are legitimately cited elsewhere (hypoxic burden; Mean/Resting HR), so only
their BP rows went. **Nieto 2000's only stated purpose in this guide was BP Projection**, so its card
was restated rather than deleted: the SDB→hypertension association is the clinical reason an ODI matters
at all, and the card now says plainly that **no metric is derived from it** and that the projection it
formerly underpinned was withdrawn. 7 mentions → 2, both honest.

**Why a gate would not have caught this.** `cohesion-badges` checks grades for cards the node's own
resolver maps; a citation row for a **deleted** metric is mapped by nothing, so it is invisible to every
existing check. The class is "documentation outliving the code it documents", and it is silent by
construction.

### F2 · ⚠ THE SAME DEFECT, 5× WIDER — `ANS Age`, NOT fixed here

`ANS Age` was removed on the same review sweep (2026-06-21, WP-A) and is **absent from every registry** —
`ppgdex-registry.js:382`, `hrvdex-registry.js:122`, `pulsedex-registry.js`, `oxydex-registry.js` all
carry removal comments, not metrics. It is still named **18 times across 5 guides**: HRVDex ×8 (including
a metrics list at :342), PpgDex ×4, PulseDex ×3, OxyDex ×2 (a metrics list at :810), GlucoDex ×1.

**Deliberately not swept in this pass**, for a reason this brief already teaches: several of those
mentions sit in *"internal composite — no external source, directional only"* provenance rows, which is
**honest labelling** and not the same defect as a citation row. Telling them apart needs the same
per-mention reading that F1 got, and a blanket find-and-replace across five reader-facing guides is
precisely the move that manufactures false defects. Sized here so the next pass starts from a count
rather than a suspicion.

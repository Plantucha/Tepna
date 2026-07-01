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
- [ ] Every citation verified to a real paper with a **resolving** DOI/PMID (or replaced with a verified
      source, or removed + labelled internal); shared sources identical across guides.
- [ ] Every formula canonically correct AND consistent with the node `*-dsp.js` (constants/thresholds match).
- [ ] Every normative table is published/consensus (cited) or explicitly marked relative; no invented
      clinical cut-points; units/directions/boundaries sane.
- [ ] Every metric card's grade == node registry `evidence` (gate-green); disc CSS ≡ engine; no retired
      vocabulary; tier chip/`data-tier` matches `depth`.
- [ ] Zero dead links (external DOIs resolve; every internal `#anchor` has a matching `id`).
- [ ] Console clean; quick-jump / abbr search / theme / drawer / nav-highlight all work; responsive at ~390 px.
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

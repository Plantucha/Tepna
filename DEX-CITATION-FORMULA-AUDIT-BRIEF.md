<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — Citation & Formula Audit for the Remaining Dexes

> **For a fresh AI coder.** Read `CLAUDE.md` first (the two gates, the Clock Contract, the Evidence-
> badges section). This brief asks you to repeat, on the OTHER nodes, the citation-and-formula
> correction pass that was just completed on **OxyDex** end-to-end. The OxyDex work is the worked
> example — its source (`oxydex-*.js`), manifest (`codegen/manifests/oxydex.manifest.json`), guide
> (`OxyDex Reference.html`) and bundle (`OxyDex.html`) are now clean and are your reference for "what
> good looks like." **Do not re-audit OxyDex.**

## Scope — nodes to audit (in priority order)
1. **ECGDex** — `ecgdex-registry.js` · `ecgdex-dsp.js` · `ecgdex-app.js` · `ECGDex.src.html` →
   `ECGDex.html` · `ECGDex Reference.html` (a guide already exists — audit it too).
2. **PulseDex** — `pulsedex-registry.js` · `pulsedex-dsp.js` · `pulsedex-app.js` · `PulseDex.src.html`
   → `PulseDex.html`. (No reference guide yet — do not create one unless asked.)
3. **HRVDex** — `hrvdex-registry.js` · `hrvdex-dsp.js` · `hrvdex-app.js` · `HRVDex.src.html` →
   `HRVDex.html`.
4. **GlucoDex** — `glucodex-registry.js` · `glucodex-dsp.js` · `glucodex-app.js` · `GlucoDex.src.html`
   → `GlucoDex.html`.
5. **Integrator** — `integrator-dsp.js` · `integrator-app.js` · `Integrator.src.html` →
   `Integrator.html` (no per-node registry; fusion layer — citations are lighter here).
6. **EEGDex** — planned/not built yet; skip unless its files exist.

Do one node fully (audit → fix → re-bundle → gates) before starting the next. Commit-quality per node.

---

## Why this is necessary — what the OxyDex pass actually found
Treat every citation as guilty until verified. The OxyDex audit found **multiple fabricated and
misattributed citations that had propagated into source, manifest, fixtures AND the shipped bundle**:
- **Fabricated (no such paper):** "Hartmann 2019" Δ-index; "Castillo 2018" wrist-oximetry; "Chami 2011
  (Am J Hypertens 24:416)".
- **Misattributed (real author, wrong paper/journal/year/DOI):** MAP→Meaney (wrong title/journal);
  ERS 2011→actually Randerath; Jurca (metabolic-syndrome paper used for a VO₂max method — real paper
  is Jurca *Am J Prev Med* 2005); Palatini (wrong journal: *Curr Hypertens Rep*, not *Cardiol*);
  Azarbarzin 2021 (fabricated coordinates; the real 2021 AJRCCM paper is the *pulse-rate* one — the
  hypoxic-burden biomarker paper is **Chest 2020;158:739–750**); Azarbarzin 2022 (wrong title + DOI
  `2535OC`→`2608OC`).
- **Formula display errors:** `HRmax = 220 − age` mislabeled "Tanaka 2001" (Tanaka is **208 − 0.7·age**;
  220−age is the obsolete Haskell–Fox); Azarbarzin 2019 wrong volume/pages; stray CJK "公式" in the
  manifest.

Expect the SAME failure modes in the other nodes. The fact that one node was this contaminated means
you must verify, not assume, on the others.

---

## The audit method (apply per node)

### 1. Inventory every citation/claim
Grep the node's source + manifest + guide for author-year patterns and known-risky names. Useful seeds:
`grep` for `\b(19|20)\d{2}\b`, `et al`, `doi`, `cite:`, `fullName`, plus signal-specific authors:
- **ECG/HRV:** Task Force 1996 (Circulation 93:1043, doi:10.1161/01.CIR.93.5.1043), Bazett 1920 &
  Fridericia 1920 (QT correction), Peng 1995 (Chaos, DFA), Richman & Moorman 2000 (AJP, SampEn),
  Brennan 2001 (IEEE TBME, Poincaré), **Bauer 2006 (Lancet, deceleration capacity)**, Lomb 1976 /
  Scargle 1982 (periodogram), Hayano (CVHR), Malik 20% rule (Task Force 1996).
- **PulseDex (RR→HRV):** same HRV canon as above; plus pulse-rate-variability caveats.
- **GlucoDex (CGM):** Battelino 2019 (Time-in-Range consensus, *Diabetes Care*), Danne 2017 (CGM
  targets), GMI/eA1c (Bergenstal 2018), MAGE (Service 1970), CONGA, J-index. Verify each.
- **Integrator:** mostly internal fusion logic; cite the source nodes, not external papers, unless it
  prints a literature claim.

### 2. Verify each against the literature (web search)
- Confirm **author · title · journal · year · volume:pages · DOI** all match a real paper. A real
  author on the wrong paper is still an error.
- **Never fabricate or guess a DOI.** Only print a DOI/PMID you have confirmed resolves. Books/
  standards → official publisher/org landing page or ISBN.
- If you cannot confirm it, do not dress it up — see §4.

### 3. Check formulas for correctness (objective errors)
Verify the standard formulas match their canonical definition AND that the doc/manifest display
matches what the DSP actually computes (OxyDex had a code-vs-doc contradiction). Spot targets:
- **HRmax = 208 − 0.7 × age** (Tanaka 2001) — NOT 220−age, anywhere.
- **QTc:** Bazett = QT/√RR; Fridericia = QT/∛RR — check which the code uses and label correctly.
- **SampEn / ApEn:** r ≈ 0.15–0.2 × SD, m = 2; ApEn = Φ(m) − Φ(m+1) with mean-of-logs (not log-of-mean).
- **DFA α1, SD1/SD2** (SD1 ≈ RMSSD/√2), **deceleration capacity** (Bauer phase-rectified signal averaging).
- **GMI (%) = 3.31 + 0.02392 × mean glucose(mg/dL)**; **eAG**, **TIR** band 70–180 mg/dL.
- Flag any coefficient with no external source as **"internally calibrated, no external source"** —
  do not attribute internal weights to a paper (this was the OxyDex BP-coefficient fix).

### 4. Honesty rules for anything unverifiable
- Replace a fabrication with the correct canonical source if one exists (e.g. Chami→Nieto 2000); if
  none exists, **remove the false citation** and label the metric "internal / no external source."
- Genuinely-uncertain attributions get a brief scoping note ("association per X; coefficient internal,
  treat as directional") — NOT a fake citation. Keep these notes; they're good practice.

### 5. Remove correction-history meta-commentary (these docs are unpublished)
Do NOT leave a visible changelog of your fixes. No "corrected this revision / verified / to-verify /
relabelled / previously mis-stated / Prior version (vXX) …" in reader-facing text. State the clean,
final fact only. (Internal `//` code comments and invisible CSS `/* fix */` comments are fine to leave.)
Strip "(vXX corrected)" / "(vXX fix)" tags from formula labels and prose; keep genuine product-version
**compatibility** tags in the footer.

### 6. Conform the guide to the registry, never the reverse
Per CLAUDE.md: the node's `<node>-registry.js` `evidence` field is the **grade source of truth**, and
`metric-registry.js`/`dex-badges.css` is the **badge-visual** source of truth. If a reference guide's
grade or badge disagrees with the registry, fix the **doc**. Do not edit the registry to match a doc
unless the registry itself is wrong on the merits (and if so, keep back-compat per CLAUDE.md).

---

## Propagation map — fix ALL layers, not just the guide
A citation in OxyDex lived in up to five places. For each node, check and fix every layer it appears in:
1. **`<node>-registry.js`** — `cite:` fields (OxyDex's were already clean; others may not be).
2. **`<node>-dsp.js`** — comments AND any runtime-output strings (method labels, CSV/export headers).
3. **`<node>-app.js`** — export headers, displayed labels.
4. **`codegen/manifests/<node>.manifest.json`** — `name` / `fullName` / `formulaNote` strings.
5. **`<Node> Reference.html`** — cards, provenance tables, banners.
6. **`tests/fixtures/<node>.summary.json`** and **`uploads/*.json`** — generated outputs that embed a
   corrected runtime string must be updated to match (string-replace; re-validate JSON). The method
   string is NOT part of `buildHash`, so updating it does not break provenance.

---

## Re-bundle discipline (critical — avoid flipping provenance)
Any change to a node's `*-dsp.js` / `*-app.js` / `*-render.js` requires re-bundling `<Node>.html`.
**Do a SURGICAL re-bundle** that swaps only the changed asset's bytes and leaves the
`__bundler/template` byte-identical — this keeps `buildHash` unchanged so no provenance fixtures flip.
The OxyDex pass did exactly this; reuse that approach:
1. Parse the `<script type="__bundler/manifest">` JSON in `<Node>.html`.
2. Find the asset whose decompressed text uniquely contains a known function name from the file.
3. gzip the edited source, base64 it, round-trip-verify it decodes back to the exact source.
4. Replace only that one base64 blob; assert the `__bundler/template` slice is unchanged.
- Manifest-only or registry-`cite`-only edits do NOT require re-bundling (manifest feeds codegen;
  registry CSS is injected identically). Re-bundle only for runtime-behavior changes.

---

## Gates — run after EACH node (per CLAUDE.md)
1. **Regression** — open `Dex-Test-Suite.html`, wait ~3 s, `#summary` must read **all green**. Run
   after any DSP/app change and after re-bundling. A red is a blocker.
2. **Provenance** — after re-bundling, open `verify-provenance.html`; confirm **0 mismatches** and the
   node's `buildHash` is unchanged (surgical swap guarantees this). Edited `uploads/*.json` exports
   should still read "reproducible ✓".
3. If you extend a node's reference guide into the `cohesion-badges` group, wire its
   `<NODE>_REGISTRY` + `<Node>Registry` + doc into `env` in BOTH runners (`tests/run-tests.mjs` +
   `Dex-Test-Suite.html`), per the Evidence-badges section of CLAUDE.md.

---

## Per-node acceptance criteria
- [ ] Every citation in registry + dsp + app + manifest + guide verified against the literature, with
      a working DOI/PMID, or replaced with a verified canonical source, or removed + labeled internal.
- [ ] No fabricated/misattributed authors, no guessed DOIs, no stray non-ASCII in citation strings.
- [ ] Standard formulas correct AND consistent between code and doc (esp. HRmax = 208−0.7·age, QTc,
      SampEn/ApEn, DFA, GMI/TIR). Internal coefficients labeled "no external source."
- [ ] No correction-history meta-commentary in reader-facing text; clean final statements only.
- [ ] Guide grades/badges conform to the node registry (not vice-versa).
- [ ] All output layers (fixtures, uploads exports) consistent with corrected runtime strings.
- [ ] Surgical re-bundle done where source changed; `buildHash` unchanged.
- [ ] `Dex-Test-Suite.html` all green; `verify-provenance.html` 0 mismatches.

## Order of operations per node (checklist)
1. Inventory citations/formulas (grep). 2. Web-verify each. 3. Fix source (registry/dsp/app) +
manifest + guide; remove correction noise. 4. Update fixtures/uploads to match runtime strings.
5. Surgical re-bundle `<Node>.html`. 6. Run both gates. 7. Only then move to the next node.

<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** IN-PROGRESS — 2026-08-03 (**2026-08-04: four more acceptance boxes verified and closed — reader-facing correction-history 0/7 guides, badge conformance gate-enforced 74/74, gates green 9/9 + 16 fixtures. ONE blocker remains and it is not code: §1/§2 citation verification needs NETWORK, which this suite forbids by construction.** §3 formula dimension CHECKED and CLEAN, now gated — HRmax/Tanaka, QTc Bazett-vs-Fridericia, SampEn m=2 r=0.2·SD all verified against the code; ApEn is N/A (nothing computes it). One real cross-node SD1 difference measured at 0.002–0.008 % on five overnight RR files — immaterial, and the divergent node is the canonically-correct one. The CITATION half (§1/§2) stays open: it needs network verification and is governed by `LITERATURE-USE-POLICY-2026-07-11-BRIEF.md`)

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

### §3-RESULT — the formula dimension is CLEAN, checked 2026-08-03, and now gated

This brief's status says *"every citation verified against the literature is not a property the tree can
show"* — true of the **citation** half. The **formula** half is, and §3's spot targets are objective, so
they were checked against the code rather than left open. Every one is clean:

| §3 target | verdict |
|---|---|
| `HRmax = 208 − 0.7·age`, never 220−age | **clean** — no `220 − age` anywhere; OxyDex cites Tanaka 2001 and explicitly names Haskell–Fox as superseded |
| QTc Bazett vs Fridericia, labelled correctly | **clean** — `ecgdex-morph` computes both, `qtcTrend` emits Bazett as the primary `qtc`; the registry carries `qtc` (Bazett) *and* `qtcFrid`, the guide names both, `idForLabel` maps both |
| ApEn = Φ(m) − Φ(m+1), mean-of-logs | **N/A** — nothing in the fleet computes ApEn; only SampEn |
| SampEn m=2, r=0.2·SD | **clean** — every explicit call site is `(…, 2, 0.2·SD)`, consistent across ECGDex · PulseDex · PpgDex and stated identically in all three guides |
| GMI · eA1c · TIR 70–180 | **clean** — verified against `glucodex-dsp.js` in the sibling `REFERENCE-GUIDE-AUDIT` pass |

**One genuine cross-node difference, measured rather than assumed.** SD1 is computed two ways:
`hrvdex`/`pulsedex` use `RMSSD/√2` (root-mean-square of successive differences), `ppgdex:1680` uses
`√0.5·SD(Δ)`. These coincide only when mean(Δ) = 0, so they are different estimators sharing a name and
a unit — AUDIT-PROMPT bug class 5. Measured on **five real overnight RR files (6 020–24 443 intervals)**
they differ by **0.002–0.008 %**, far below the 0.1 ms both nodes round to.

Immaterial — and note the direction: **`ppgdex`'s is the canonical one** (SD1² = ½·SDSD², i.e. the
*standard deviation* of differences), while `RMSSD/√2` is the common approximation the brief itself
writes with an "≈". So nobody should "unify" ppgdex toward the other two.

**Gated, because a clean result is worth keeping clean.** Two groups in `tests/dex-tests.js`: a
source-scan pinning no-220−age / Tanaka-present / SampEn-(2, 0.2), and a differential oracle asserting
the two SD1 forms agree to <0.05 % on a series that carries a real 22.5 ms overnight drift (asserted, so
the agreement is not trivially true). Both verified RED by planting the defects
(`got "hrvdex-dsp.js" · want ""`, `got "hrvdex-dsp.js: m=2 r=0.15" · want ""`).

The scan **strips comments first**, and that is load-bearing: `ppgdex-dsp.js` documents its default
tolerance by naming the value it is *not* — "≠ `sampEn(nn, 2, 0.15)`" — and the first version of the gate
read that prose as a call site and reported a defect that does not exist.

**Still open:** the citation half (§1/§2 — author·title·journal·DOI resolution) for ECGDex · PulseDex ·
HRVDex · GlucoDex, which needs network verification and is governed by `LITERATURE-USE-POLICY`.

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

## Audit 2026-08-04 — the offline-checkable half, measured

The suite takes no network, so "a **working** DOI" is not machine-checkable here. What is checkable was
measured across all node registries — **956 `cite`/`label`/`unit` strings** — and gated
(`docs · citations · registry-strings`, mutation-verified both ways):

| check | result |
|---|---|
| malformed DOI (trailing punctuation / embedded space) | **0** |
| correction history in a reader-facing string | **0** |
| stray non-ASCII | **0** — the 72 non-ASCII characters present are all legitimate (`é` in Poincaré, `π`, `§`, `–`, `≈`, `√`) |

⚠ **The headline finding is what is NOT there: across 412 `cite:` strings there are ZERO DOIs.** The
registries cite author-year — "Task Force 1996", "Brennan 2001", "Uth–Sørensen 2004". So criterion 1 is
not partially met, it is **unmet by construction**, and no gate can close it: adding a DOI requires
reading the literature. The gate deliberately does **not** require one — a rule that would pressure 412
identifiers into existence is worse than the gap, and `LITERATURE-USE-POLICY` §2 already forbids
fabricated authority.

Out of scope by design: three **papers** narrate their own corrections (`null-calibration`,
`ppg-quality-gate-pooling`, `papers.html`). A paper whose finding *is* a retraction — *"the analysis
that came first was wrong, and this paper exists because acting on it would have removed a working
feature"* — is being honest, not noisy. Two reference guides carry `REMOVED 2026-06-23` notices for
metrics withdrawn as indefensible (HRV→BP, ANS-age); those are a **safety** record and must stay.

## Per-node acceptance criteria
- [~] Every citation verified against the literature with a working DOI/PMID — **structurally clean,
      substantively OPEN and unclosable offline.** See the audit above: 0 DOIs exist to verify. Closing
      this needs a human with a browser, per node.
- [x] **No guessed DOIs, no stray non-ASCII in citation strings — verified 2026-08-04 and gated.**
      (The "no fabricated/misattributed authors" half is a literature claim and rides criterion 1.)
- [x] **Standard formulas correct AND consistent between code and doc** — **§3, 2026-08-03:** HRmax/Tanaka,
      QTc Bazett-vs-Fridericia and SampEn `m=2, r=0.2·SD` all verified against the code; ApEn is N/A (nothing
      computes it). The one cross-node SD1 difference measured at 0.002–0.008 % on five overnight RR files —
      immaterial, and the divergent node is the canonically-correct one. Now gated.
- [x] **No correction-history meta-commentary in reader-facing text** — **AUDITED 2026-08-04:** all seven
      `* Reference.html` guides scanned for `was previously|was wrong|now corrected|used to say|formerly|
      this was a bug`-class phrasing. **0 hits in 7 of 7.** The one repo-wide hit is in
      `sigma-no-reference-analysis.html`, an analysis tool rather than a reader-facing guide.
- [x] **Guide grades/badges conform to the node registry** — enforced by construction, not inspection:
      the `cohesion-badges` group asserts every reference-guide card the node's OWN resolver maps carries
      the registry's grade, and that each guide `<link>`s `dex-badges.css` rather than inlining disc CSS.
      **74/74 green, re-run 2026-08-04.** A doc that disagrees now reds the suite.
- [x] **AUDITED 2026-08-04 — 269 labelled strings across 215 committed artifacts; ONE is stale, and it
      states the opposite of what the code now says.**

      Method: deep-walk every committed `uploads/**/*.json` for values keyed `*Method` / `*Note` /
      `*Label`, then require each to be traceable to current source. **The naive check is useless** — a
      literal match reports ~40 % false positives, because these strings are built three ways: literal
      (164), **interpolated** (`SpO₂ DFA (α1=1.612) — …`, 38 variants of one template at
      `oxydex-dsp.js:1618`), and **concatenated** (`'beat-template energy median' + (reconciled ? … : …)`
      at `ecgdex-app.js:2477`, which never exists as a whole literal anywhere). Four successive
      narrowings were needed; each residue was template output, not staleness.

      **The one real hit:** `uploads/qrs-yield-stats.json` → `arms.ECG.rmssdNote` =
      *"reconstructed-rMSSD attenuated by the synthetic R-peak phase rendering; ECG certified for YIELD
      only"*. No source emits it — three distinct fragments are absent from every `.js`/`.mjs`/`.html` in
      the repo. `qrs-yield-analysis.js:319` now emits *"faithful (R-peaks rendered at true beat times;
      reference arm)"*. Its sibling `arms.PPG.rmssdNote` matches source exactly, so this is one arm, not
      a whole orphaned field.

      ⚠ **Not cosmetic — the two strings make opposite claims.** The committed one says that arm's rMSSD
      is *attenuated* and fit for yield only; the current one says it is *faithful* and is the
      **reference** arm. `papers/qrs-yield.html` already uses the corrected framing ("faithful" ×4), so
      the tool and the paper were both updated and **only the committed artifact was left behind** — a
      reader who opens the stats file gets a retracted caveat.

      **ROUTED, not fixed here.** The artifact is regenerable (the tool is synthetic-only, no corpus
      needed) but re-running it is a fresh Monte-Carlo pass: it would move **every number in a published
      paper's stats file**, not just the string. Changing a paper's numbers to correct one caveat is an
      owner call, and the honest options are (a) re-run and re-publish the table, or (b) hand-correct the
      single string with the reason recorded. This audit deliberately does neither.
- [~] **Surgical re-bundle where source changed** — satisfied in practice (no source changed for the
      formula half; `build.mjs --check` clean). ⚠️ **This criterion cites a RETIRED signal:** `buildHash`
      was retired as a provenance signal by SIGNAL-ADAPTER-AND-FRONTIER Phase 7 and **no gate reads it**
      (CLAUDE.md §🔏). The live equivalents are `manifestHash` (executed-code identity) and `computeHash`
      (export-inertness). Re-word if this brief is ever revised; do not go looking for a stable `buildHash`.
- [x] **Gates green** — full suite green throughout the 2026-08-04 sweep; `verify-manifest` reports
      **GATE A 9/9 bundles matching, GATE B 16 fixtures reproducible, 0 mismatches**.

## Order of operations per node (checklist)
1. Inventory citations/formulas (grep). 2. Web-verify each. 3. Fix source (registry/dsp/app) +
manifest + guide; remove correction noise. 4. Update fixtures/uploads to match runtime strings.
5. Surgical re-bundle `<Node>.html`. 6. Run both gates. 7. Only then move to the next node.

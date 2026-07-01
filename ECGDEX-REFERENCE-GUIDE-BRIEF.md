<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — `ECGDex Reference.html` (single-signal reference guide)

> **For a fresh AI coder.** Read `CLAUDE.md` first (the two gates + the Clock Contract + the
> **Evidence badges** section), then open the finished reference implementation —
> **`OxyDex Reference.html`** — which is your exact structural template, and **`ecgdex-registry.js`**
> (the grade authority) + **`ecgdex-dsp.js`** (what ECGDex actually computes). This guide documents
> ECGDex's metrics/formulas/thresholds the way the OxyDex guide documents OxyDex's. Everything below
> is decided; clone the OxyDex guide's structure, swap in ECG content, conform to the cohesion
> system, and pass the gate. **Do not redesign the layout or invent a new badge scheme.**

---

## §0 — What you're building

A single self-contained `ECGDex Reference.html` at the repo root (same folder as `OxyDex Reference.html`),
dark-theme, sidebar-nav, scrollable reference doc. **100% local. System-font stacks only** (no
`@font-face`, no CDN, no woff2 — see CLAUDE.md Known non-issues). It is a **static design doc**, not
an app bundle — it has no `*-dsp.js`/`.src.html` and is NOT inlined/bundled. You hand-author the HTML.

The deliverable is ONE HTML file. It is the consumer in the cohesion contract: its badges and grades
must conform to ECGDex's engine + registry, enforced by the test suite (see §5).

---

## §1 — Cohesion conformance (NON-NEGOTIABLE — this is the point of the doc)

1. **Badge CSS = mirror, not a fork.** Copy the badge disc CSS **verbatim** from `dex-badges.css`
   (the canonical mirror of `MetricRegistry.BADGE_CSS`). The 5 tier discs
   (`.ev-measured/.ev-validated/.ev-emerging/.ev-experimental/.ev-heuristic`) and the `.ev-corner`
   wrapper must be byte-identical to OxyDex's. Easiest path: copy the OxyDex guide's inline
   `<style>` badge block exactly (it already matches `dex-badges.css` — the suite proves it). Do NOT
   tweak colors, sizes, or shapes. `--ev-ink:#aab8cc` only; never a status hue.
2. **5-level ladder, frozen order:** measured · validated · emerging · experimental · heuristic.
   Render the **evidence legend strip** (`.ev-legend-strip`, copy OxyDex's markup) once near the top.
3. **Every metric card carries a corner badge** `<span class="ev-corner ev-<tier>" title="<Label> — <cite>"></span>`
   as the LAST child of the `.mc` card (bottom-right). Title format: `"<Label> — <cite>"` (em-dash U+2014).
4. **Grades come from `ECG_REGISTRY`, not your judgement.** For any metric that exists in
   `ecgdex-registry.js`, the card's tier MUST equal that metric's `evidence` field (table below).
   For ECGDex metrics that are NOT in the registry (doc-only advanced metrics — SampEn, triangular
   index, fragmentation, QTc-Fridericia, posture, sleep-stage proxies), grade them by the taxonomy
   definitions in `MetricRegistry.EVIDENCE`:
   - **measured** = a direct sensor reading / raw statistic, NOT computed (mean HR, step count,
     coverage %, correction %, SQI, ectopy count). If it has a Formula/Method block, it is almost
     never `measured`.
   - **validated** = established, externally validated derived metric (HRV time-domain, QTc, SD1/SD2).
   - **emerging** = published but device-dependent / less standardized (DFA α1, DC/AC, EDR resp,
     LF/HF, SD1/SD2 ratio, CVHR, CR coupling).
   - **experimental** = ECGDex composite, not externally validated (AF screen, HRV stability slope,
     RSA efficiency, any multi-signal score). Sleep-stage-from-HR heuristics → `heuristic`.
   - **heuristic** = convenience estimate / population proxy / a trend not a measurement.
5. **No retired vocabulary, ever:** the words "Proxy", "Composite", "Provisionally validated" must
   not appear as badge titles; no `data-ev=` attribute; no `ev-validated-provisional` class. The gate
   greps for these and fails.

### Canonical grades from `ecgdex-registry.js` (use these EXACTLY)

| Label (card `.ma`) | tier | depth | cite (registry) |
|---|---|---|---|
| rMSSD | validated | advanced | Task Force 1996 — short-term parasympathetic HRV |
| SDNN | validated | advanced | Task Force 1996 — overall HRV over window |
| ln rMSSD | validated | advanced | Log-RMSSD — readiness-friendly scale |
| QTc | validated | advanced | Bazett rate-corrected QT |
| SD1 | validated | research | Poincaré SD1 (≈ RMSSD/√2) |
| SD2 | validated | research | Poincaré SD2 — long-term dispersion |
| Mean HR | measured | basic | Mean HR — direct from detected R-peaks |
| Total steps | measured | basic | Accelerometer step count |
| % Analyzable | measured | basic | Fraction analyzable — direct coverage |
| Coverage | measured | advanced | On-body recording coverage |
| Correction | measured | advanced | Beats corrected during cleaning |
| Mean SQI | measured | advanced | Mean signal-quality index |
| Ectopy | measured | advanced | Detected ectopic-beat count (PVC+PAC) |
| DFA α1 | emerging | research | Detrended-fluctuation short-term exponent |
| CVHR index | emerging | advanced | Cyclical-variation-of-HR index (Hayano) |
| Decel. capacity | emerging | research | Heart-rate deceleration capacity (Bauer 2006) |
| Resp Rate | emerging | advanced | ECG-derived respiration (EDR) surrogate |
| SD1/SD2 | emerging | research | Poincaré ratio — nonlinear short/long balance |
| CR Coupling | emerging | research | Cardiorespiratory phase-locking (PLV) |
| LF/HF | emerging | research | LF:HF power ratio — sympatho-vagal proxy |
| AF Screen | experimental | advanced | AF irregularity screen — directional, not diagnostic |
| HRV Stability | experimental | research | Overnight ln-RMSSD stability slope — composite |
| RSA Efficiency | experimental | research | Inspiratory:expiratory HR ratio — composite |

`depth` maps to the disclosure tier exactly as OxyDex: `basic` → no `data-tier` (Core), `advanced`
→ `data-tier="secondary"`, `research` → `data-tier="research"`. Mirror the `<span class="mt …">Core/
Advanced/Research</span>` tier chip in each card header.

---

## §2 — Content map (sections — grounded in `ecgdex-dsp.js`)

Clone the OxyDex guide's section anatomy: each section is `<div class="rs" id="…"><div class="sh">
<div class="si …">ICON</div><div><div class="st">Title</div><div class="sd">subtitle</div></div></div>
…cards…</div>`. Cards use `.mc` → `.mh`(`.mi`:`.ma` short name + `.mf` full name; `.mt` tier chip) →
`.md` prose → optional `.fb`(`.fl`Formula/`.ft`expression/`.fn`note) → `.nt` normative table → corner
badge. Suggested sections (combine/split to taste, but COVER what the DSP emits):

1. **Signal & Beat Detection** — ECG sampling (synthetic fs 130 Hz), bandpass, R-peak detection,
   two-detector agreement, per-beat **SQI gate** (flatline · kurtosis · RR plausibility), NN
   interpolation, **% analyzable**, **coverage %**, **correction rate**, **ectopy** (PVC/PAC) via the
   Malik 20% local-median rule (Task Force 1996). [measured cards]
2. **Heart Rate** — Mean/min/max HR from R-peaks. [measured]
3. **HRV — Time Domain** — rMSSD, SDNN, pNN50, ln rMSSD; the **duration tiers** that gate validity:
   `ultra-short` (<5 min: HR·rMSSD·pNN50·SD1·HF valid; SDNN/LF withheld), `short` (5-min standard),
   `overnight` (+VLF·DFA·CVHR·staging). Document WHY each tier withholds metrics. [validated]
4. **HRV — Poincaré (Nonlinear geometry)** — SD1, SD2, SD1/SD2. [SD1/SD2: validated; ratio: emerging]
5. **HRV — Frequency Domain** — Lomb–Scargle (handles uneven RR): VLF/LF/HF/total power, LF/HF,
   HFnu/LFnu, EDR **Resp Rate** (per-epoch median, NOT HF-peak — see the DSP comment + test #12).
   [LF/HF & resp: emerging]
6. **Nonlinear & Complexity** — DFA α1 (Peng), SampEn (Richman), triangular index, fragmentation
   (PIP/IALS/PSS), **deceleration / acceleration capacity** (Bauer). [DFA/DC: emerging; SampEn/frag: experimental]
7. **Repolarisation** — QTc (Bazett primary; Fridericia alt), what rate-correction means, ranges. [validated]
8. **Rhythm & Morphology** — ectopy classification, **AF Screen** (irregularity, directional only —
   NOT a diagnosis; add a prominent warning callout `.co.co-w`). [experimental]
9. **CVHR / Apnea autonomic signature** — cyclic HR variation, events, index/hr (Hayano). [emerging]
10. **Cardiorespiratory Coupling** — CR coupling PLV, RSA efficiency (I:E ratio), surge escape. [CRC: emerging; RSA: experimental]
11. **Accelerometer** — steps, posture/tilt, motion series, ACC-derived resp. [steps: measured; posture: measured/heuristic as appropriate]
12. **Sleep staging proxies** — HR-pattern REM/NREM estimation. **heuristic**, with a "not validated
    staging — not EEG" warning callout (mirror OxyDex's sleep-stage caution).
13. **Device cross-check** — self-RR vs device RR, Malik-corrected-vs-corrected, ΔrMSSD/ΔSDNN. [measured/quality]
14. **Signal Quality & Artifact Flags** — gaps, off-body spans, low-coverage messaging.
15. **Full Abbreviation Index** — searchable (clone OxyDex's `#abbr` block + its search JS; note the
    fixed count-label bug already corrected in OxyDex — use the working `.filter(c=>c.style.display!=='none')`
    form, NOT a `[style*="display:none"]` selector).
16. **Academic References** — see §4.

Use the same icon-tinted `.si` classes OxyDex uses (pick sensible hues per section; ECG accent can
differ from OxyDex's SpO₂ palette but keep it within the existing token set, no new brand colors).

---

## §3 — Time display (Clock Contract)

This is a static doc, so it mostly shows formulas, not live timestamps. **If** you show any example
timestamp or reference epoch math, obey the Clock Contract verbatim (CLAUDE.md §THE CLOCK CONTRACT):
floating `tMs = Date.UTC(...)`, render with `getUTC*` / `{timeZone:'UTC'}`, never `new Date()` /
`getHours()`. Don't restate the whole contract in the doc; link the concept and keep examples correct.

---

## §4 — Citations (READ THIS — the OxyDex guide shipped with ≥3 FABRICATED citations)

The single biggest risk in this doc. Hard rules:
- **Verify every citation against the literature before printing it.** Do NOT trust author/year/journal
  from memory or from this brief. The OxyDex guide had a non-existent "Hartmann 2019" Δ-index, a
  mis-titled Meaney MAP paper, and an ERS misattribution — all fixed only by checking.
- **Never fabricate a DOI.** Link only DOIs/PMIDs you have confirmed resolve. Books/standards →
  official publisher/org landing page or ISBN, not a guessed deep link.
- Any attribution you could not confirm goes in a **provisional / to-verify** warning callout
  (`.co.co-w`), exactly like OxyDex's `#clin-valid` banner — do not dress it up as authoritative.
- **Starting points to VERIFY (not authoritative — confirm each):** Task Force 1996 HRV standards
  (Circulation/Eur Heart J); Bazett & Fridericia QT correction (1920); Peng 1995 DFA (Chaos);
  Richman & Moorman 2000 SampEn (Am J Physiol); Bauer 2006 deceleration capacity (Lancet); Brennan
  2001 Poincaré (IEEE TBME); Lomb 1976 / Scargle 1982 periodogram; Hayano CVHR; Malik 20% ectopy rule.
  Confirm exact title/journal/year/DOI for each before linking; drop or flag any you cannot verify.
- Reuse OxyDex's "Academic References" categorized layout + DOI link styling (teal, `target=_blank`,
  `rel="noopener"`). Where ECGDex shares a source with OxyDex (e.g. Task Force 1996), use the SAME
  verified citation string/DOI.

---

## §5 — Wire it into the gate (so it can never drift)

After the doc is built, extend the shared `cohesion-badges` group to cover it — it's a few lines, and
the group already does the work. In BOTH runners add ECGDex's registry + the doc to `env`:

- **`tests/run-tests.mjs`:** add `'ecgdex-registry.js'` to the `loadInto([...])` list; add
  `ECG_REGISTRY: ctx.ECG_REGISTRY, EcgRegistry: ctx.EcgRegistry` to `env`; add
  `'ECGDex Reference.html'` to `readDocs()`'s `wanted` list.
- **`Dex-Test-Suite.html`:** add `<script src="ecgdex-registry.js"></script>` (it's not loaded
  standalone today); add `ECG_REGISTRY: window.ECG_REGISTRY, EcgRegistry: window.EcgRegistry` to
  `env`; add `['ECGDex Reference.html','ECGDex Reference.html']` to the `docs` fetch list.
- **`tests/dex-tests.js` (`cohesion-badges` group):** generalize the OxyDex-only block to also run
  for ECGDex — i.e. parameterize over `[{reg:env.OXY_REGISTRY, resolver:env.OxyRegistry, doc:'OxyDex Reference.html'},
  {reg:env.ECG_REGISTRY, resolver:env.EcgRegistry, doc:'ECGDex Reference.html'}]` and assert, per node,
  that every card `EcgRegistry.idForLabel` maps carries the registry's `evidence`. Keep the CSS-equivalence
  assertions adding the ECG doc as a third comparison source. Follow the existing block's exact style;
  don't change its assertion shape (Node CI runs the same file).

The grade-equivalence check uses the node's OWN `idForLabel`, so name your cards with the labels in
`ECG_LABEL_ALIAS` (e.g. "rMSSD", "DFA α1", "Decel. capacity", "% Analyzable", "AF Screen") and the
join is automatic — no crosswalk to maintain. Decode HTML entities in card names will be handled by
the group's `dec()`; just write the visible label.

---

## §6 — Build & verify checklist (the gates decide done, not a spot-check)

1. Build `ECGDex Reference.html` (clone OxyDex structure, ECG content, §1 conformance).
2. Verify it renders clean (no console errors) and the badge legend + corner badges display.
3. Extend the gate (§5).
4. **Regression gate:** open `Dex-Test-Suite.html`, wait ~3 s, confirm the `#summary` pill is
   **all green** — the `cohesion-badges` group must show the ECGDex disc-equivalence + grade-agreement
   assertions passing (matched count ≥ ~15; zero disagreements). A red here is a blocker.
5. **Provenance gate:** N/A for this change — you added no app and re-bundled nothing, so no
   `buildHash` changed. Do not re-bundle anything for this doc.
6. Self-audit citations one more time (§4) before calling done.

## Acceptance criteria
- [ ] `ECGDex Reference.html` exists at repo root, self-contained, system fonts, 100% local.
- [ ] Badge disc CSS byte-identical to `dex-badges.css`; legend strip present; every metric card has a
      bottom-right corner badge.
- [ ] Every registry-backed card's tier == `ECG_REGISTRY[...].evidence` (table in §1); doc-only metrics
      graded per the taxonomy definitions; no retired vocabulary.
- [ ] Covers the ECGDex DSP surface (§2): beat detection/quality, HR, full HRV (time/Poincaré/freq/
      nonlinear), QTc, rhythm/AF, CVHR, CR coupling, accelerometer, sleep proxies, device cross-check,
      signal quality, searchable abbreviation index, verified academic references.
- [ ] Every citation verified; unverifiable ones flagged in a provisional callout; no fabricated DOIs.
- [ ] `cohesion-badges` group extended to ECGDex in BOTH runners; `Dex-Test-Suite.html` all green.
- [ ] Clock Contract obeyed in any time example.

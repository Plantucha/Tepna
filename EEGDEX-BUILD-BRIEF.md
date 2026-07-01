<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — EEGDex (Muse single-channel EEG node) + cohort integration

> **For the next thread / an AI coder.** Read `CLAUDE.md` first (it is law), then `LEXICON.md`
> (naming), then this. EEGDex is the **8th Dex node** and the only one that can do *real* sleep
> staging — every other node ships a "sleep stages are HR/SpO₂ heuristics, **not EEG**" apology
> (see `OxyDex Reference.html`, `ECGDex Reference.html`, `ecgdex-registry.js`). EEGDex is the node
> those apologies point at. Build it to that standard or don't claim staging.

---

## 0. Decisions already made (override at will, but these are the recommended defaults)

| Fork | Default chosen | Why |
|---|---|---|
| **Input format** | **Mind Monitor CSV** (Muse) | The dominant consumer Muse export; one well-documented layout. Add Muse Direct / museS later as additional regex branches, same as we add Polar formats per-file. |
| **Headline metric** | **Real sleep staging** (Wake/N1/N2/N3/REM hypnogram) + band powers | The unique value. Sleep-architecture metrics (SOL/WASO/SE/N3%/REM%/cycles) ride on the hypnogram. |
| **Deliverable** | **Full node** (`eegdex-dsp.js` + `-registry.js` + `-render.js` + `-app.js` + `EEGDex.src.html` → bundle `EEGDex.html`) **and** cohort integration | Match the other nodes; don't leave a half-node. |
| **Cohort integration** | **Yes** — SYNTH `renderEEG` + EEGDex worker lane + staging scoring | EEGDex must be cohort-validated like the other 7 nodes. The synthetic ground truth **already carries a sleep latent** (see §5) so staging is scorable on day one. |
| **Staging evidence grade** | **`emerging`** | Single-channel automated staging is literature-backed but **not PSG-validated**. Never grade it `validated`. Band powers = `measured`; ratios = `emerging`; spindle/SWA = `experimental`. |

If the user wants raw-EEG-only ingest or PSG-grade claims, stop and re-confirm — those change the parser and the badges.

---

## 1. Non-negotiables inherited from the suite (do not relitigate)

- **File pattern:** build from external `eegdex-*.js` referenced by `EEGDex.src.html`, then bundle to
  standalone `EEGDex.html` via the inliner. **Edit the `.js` + `.src.html`, never the bundled `.html`;
  re-bundle after changes.** 100% local — no network, no CDNs.
- **Fonts:** system stacks only. No `@font-face`, no CDN, no woff2. (`'Inter'`/`'IBM Plex Mono'` in a
  stack that falls through to `system-ui`/`ui-monospace` is the house style — see `AUDIT.md`.)
- **`parseTimestamp` is duplicated locally** in `eegdex-dsp.js` (mirror it from any existing
  `*-dsp.js`; do **not** extract a shared util). This is intentional per the Clock Contract.
- **Naming (`LEXICON.md`):** the node is **`EEGDex`** — acronym stem stays all-caps, capital `D`,
  closed compound. Never `EegDex`, `EEG-Dex`, `eegdex` in prose. Global is **`EEGDSP`** (mirror
  `ECGDSP`/`OXYDSP` style), registry globals **`EEG_REGISTRY`** + **`EegRegistry`**.

---

## 2. THE CLOCK CONTRACT (verbatim from `CLAUDE.md` §🔒 — EEGDex MUST obey)

- Canonical unit: **UTC-normalized floating wall-clock ms** `tMs = Date.UTC(y,mo-1,d,h,mi,s,ms)`.
  Never a real UTC instant, never a `Date`/string as source of truth.
- Mirror `parseTimestamp(raw, opts) → { tMs, offsetMin } | null` with the full resolution order
  (numeric epoch → ISO+zone → ISO no-zone → explicit vendor regex → time-only+anchor → `null`).
  **Mind Monitor stamps** look like `2026-05-12 23:55:00.400` (no zone) → branch 3 (`Date.UTC` of
  components verbatim, `offsetMin=null`); some exports carry `±HH:MM` → branch 2 (zone authoritative).
  Add the exact Mind Monitor column/format to the parser by regex — **never** `new Date(str)`/`Date.parse`
  on a vendor string, **never** fall back to `now()`. A missing stamp must surface as `null`.
- Per-recording anchors: `t0Ms` = first valid sample's `tMs`; `dateAnchorMs` from full date in data,
  else 14-digit filename stamp, else file `lastModified`→floating, else `null` (date unknown).
- **Display ALWAYS via `getUTC*`** — `fmtClock/fmtDate/fmtDateTime` from `getUTCHours()/…`; pass
  `{ timeZone:'UTC' }` to any `toLocale*`. Viewer-timezone independence is a test (re-render under a
  changed `TZ` → identical clock).

### Export contract (cross-node currency)
Node JSON export: `schema.name:"ganglior.node-export"`, `schema.node:"EEGDex"`, `bus:"ganglior"`,
`recording.startEpochMs` = floating `t0Ms`, `ganglior_events:[{ t:"HH:MM:SS", impulse, node, conf, meta? }]`
with **wall-clock `t` (no date)**; new emitters SHOULD also write absolute floating `tMs` per event.
EEGDex events = stage transitions, arousals, spindle bursts, SWA peaks (impulse names below).

---

## 3. Evidence badges — ONE canonical source (`CLAUDE.md` §🎫)

- Apps load **`metric-registry.js`** (injects the badge stylesheet; exposes `MetricRegistry.BADGE_CSS`).
  Do **not** hardcode disc CSS. The 5-tier ladder is `measured · validated · emerging · experimental ·
  heuristic` (ranks 0→4); **disc shape = trust, never hue**.
- **Grade source of truth = `eegdex-registry.js`** (`EEG_REGISTRY`): each metric's `evidence` field.
  Build `EegRegistry` with `idForLabel`, `REGISTRY`, `ALIAS` (mirror `pulsedex-registry.js` /
  `ecgdex-registry.js` exactly — read one before writing).
- If you ship an `EEGDex Reference.html`, the **doc must conform to the registry**, not vice-versa.
- **Gate wiring:** to cover EEGDex in the shared `cohesion-badges` group, pass its
  `EEG_REGISTRY`+`EegRegistry`(+ reference-guide text if built) into `env` in **both**
  `tests/run-tests.mjs` **and** `Dex-Test-Suite.html`. Never reintroduce retired vocabulary
  (proxy→heuristic, composite→experimental, "provisionally validated"→emerging).

---

## 4. The EEGDex DSP (`eegdex-dsp.js`, exposes `window.EEGDSP`)

Mirror the structure of `pulsedex-dsp.js` (parser + pure math + a single analyze entry). Suggested API:

```
EEGDSP = {
  parseTimestamp,                       // mirrored, Clock-Contract
  parseMindMonitor(text) → { t0Ms, offsetMin, fs, chMicroV:{TP9,AF7,AF8,TP10}, bands?:{delta,theta,alpha,beta,gamma}, hsi? },
  analyze(rec, opts?) → {               // the whole engine
    t0Ms, durMin, fs, source,
    bandPowers:{ abs:{delta,…}, rel:{…} },           // measured / emerging
    hypnogram:[{ tMs, stage:'W'|'N1'|'N2'|'N3'|'REM', conf }],   // 30-s epochs — emerging
    architecture:{ TST, SOL, WASO, SE, n3Pct, remPct, nCycles, remLatency },  // measured-on-hypnogram
    spindles?:[{tMs,durMs,freqHz}], swa?:{ saPerHr, peakUv },     // experimental
    quality:{ analyzablePct, contactPct, meanHSI },              // measured/quality
    events:[…ganglior_events…], kernel:{hash,version}
  },
  // pure helpers (bandpass, welchPSD, epochStage, …) — give style objects UNIQUE names
}
```

- **Staging approach (emerging):** 30-s epochs; per-epoch relative band powers + a small rule/threshold
  or lightweight model → stage. Cite the basis (e.g. single-channel automated staging literature) in the
  registry `cite`. Keep it deterministic and dependency-free (no model downloads — 100% local).
- **Bands:** if the export carries Mind Monitor's precomputed band columns, you MAY use them (label
  `measured` for absolute, `emerging` for derived ratios); if raw-only, compute via Welch PSD on the
  4 channels (then everything downstream is your own math).
- **Contact/quality:** Mind Monitor exposes a Horseshoe/HSI contact indicator — gate epochs on it;
  surface `contactPct`. Off-head spans → `null` stage, not fabricated.

---

## 5. Cohort integration — the synthetic EEG lane

**The ground truth already has a sleep latent**, so staging is immediately scorable:
each `uploads/synthetic/ground_truth_nightN.json` event carries `meta.rem` (REM pressure 0..1) and
`meta.supine`; nights have `t0Ms`/`durSec`/`story`. Use these (and the apnea/desat timeline) to drive a
coherent hypnogram so the synthetic EEG agrees with the same night the other nodes see.

1. **`synth-gen.js` → add `renderEEG(tl)`** (mirror `renderRR`/`renderPPG`). Emit Mind Monitor-format
   CSV (or raw µV) for the night, with a latent stage track that: spends more time in N3 early-night,
   REM in later cycles (use the existing per-event `meta.rem` envelope as the REM-pressure curve),
   fragments around apnea clusters (arousals at event ends), all on **floating `tMs`**. Stamp the latent
   hypnogram into `SYNTH.groundTruth(tl)` as `hypnogram:[…]` so the cohort can score against it.
2. **`cohort-worker.js` → add EEGDex to a realm.** EEGDex is headless-friendly (CSV in, JSON out) and
   IIFE/clean-global if you keep `EEGDSP` self-contained — it can join the **`rrgluco`** realm (cheap)
   **or** get its own kind if staging is heavy. Add `'eegdex-dsp.js','eegdex-registry.js'` to that
   realm's `SCRIPTS`. Build the minimal envelope (band powers + hypnogram + architecture + quality +
   kernel) the way `runPulse`/`runGluco` do.
3. **`cohort-runner.html` → score it.** Add to `finishPatient` via the `extra` bag (like
   `ecgScore`/`cpapPerNight`): **staging accuracy + Cohen's κ** of detected vs latent hypnogram
   (epoch-aligned), plus REM%/N3% abs-error and architecture deltas. New flags: `eeg_stage_kappa_low`,
   `eeg_contact_low`, `eeg_threw`. Add distributions (κ, REM%, N3%) + a health row + a timing bar
   (`eeg` key, same plumbing as `ecg`/`ppg`). Folds into the same Integrator path.
4. **Frozen-seed reproducibility** still holds: EEG is rendered from the same `tl` seed; no new RNG
   stream outside the established `mulberry32(tl.seed + offset)` pattern.

---

## 6. Integrator + cross-node (the payoff)

- EEGDex emits the **authoritative hypnogram**. The Integrator (`integrator-dsp.js`,
  `IntegratorDSP.normalizeFile → runFusion`) should treat an EEG `sleep.stageMinutes`/hypnogram as
  **higher-evidence** than the HR/SpO₂/ECG sleep *proxies* — when an EEGDex record overlaps, the fused
  sleep stage should defer to it (and the other nodes' proxies become corroboration, not the source).
  Confirm the existing fusion overlap/kernel-audit path accepts the new node with no special-casing.
- **`fascia` back-compat alias** on input still applies (Integrator reads it); don't break it.

---

## 7. Definition of done (gates — `CLAUDE.md`)

1. **`Dex-Test-Suite.html`** all-green (`#summary` pill). Add EEGDex assertions to `tests/dex-tests.js`
   (the shared contract): `parseMindMonitor`/`analyze` signatures + return shapes, Clock-Contract
   round-trips (first/last shown == raw; viewer-TZ independence; overnight monotonic past midnight),
   and the `cohesion-badges` coverage (registry ≡ `dex-badges.css` ≡ any reference doc). Same file runs
   under `node tests/run-tests.mjs` — keep both runners' `env` updated.
2. **Re-bundle `EEGDex.html`** from `EEGDex.src.html` after DSP/app changes, then open
   **`verify-provenance.html`** — no red verdicts (a fresh node has no stamped-hash fixtures yet, so
   "no provenance" on old fixtures is fine; just confirm the new bundle's `buildHash` computes).
3. **Cohort:** `cohort-regression.html` still green; a small `cohort-runner.html` FAST run shows EEGDex
   κ/REM%/N3% populated, 0 throws, fusion overlap intact.
4. Update `COHORT-VALIDATION-README.md` (add EEGDex to the lane node list + timing table) and the
   landing card (`index.html` line ~308: flip `EEGDex · soon` to live) and the `Planned` rows in
   `uploads/READ.ME.md` / `README_Ganglior.md`.

---

## 8. Capture provenance (mirror `CLAUDE.md` §🎙️)
Document EEGDex's real-capture path the way ECG/PPG document Polar Sensor Logger: **Muse headband →
Mind Monitor app** (or Muse Direct) → CSV export with its own timestamp column. Treat Mind Monitor's
export layout as a first-class input format; honor the Clock Contract on its stamps (regex the explicit
format). Add real column/timestamp formats to `eegdex-dsp.js` as you encounter actual files.

---

### Quick-start order for the next thread
1. Read `pulsedex-dsp.js` + `pulsedex-registry.js` + one `*.src.html` (structure) and `metric-registry.js`
   (badge injection). 2. Write `eegdex-dsp.js` (parser+analyze+staging) → `eegdex-registry.js`. 3. Wire
   `tests/dex-tests.js` + both runners; get green. 4. `eegdex-render.js`+`eegdex-app.js`+`EEGDex.src.html`;
   bundle; provenance-check. 5. `synth-gen.js renderEEG` + cohort worker/runner scoring. 6. Integrator
   deference + docs/landing. Commit-quality per step.

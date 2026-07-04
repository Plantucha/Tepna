<!--
  INGEST-AUDIT-FINDINGS.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# Ingest & Capture-Robustness Audit — findings + PR note

Execution of `INGEST-AUDIT-BRIEF.md`. Both gates green; no shell (`.src.html`)
changes, so every `buildHash` is unchanged and no provenance fixture was
regenerated (confirmed below).

---

## What changed

### §1 — ECGDex multi-part concatenation (PRIORITY) + sweep
- **`ecgdex-dsp.js`** — added the shared, DOM-free `partKey()` + `mergeMultipart()`
  to the `ECGDSP` export (mirror of the PpgDex helper, now canonical in the DSP
  layer of both nodes).
- **`ecgdex-app.js`** — `loadFiles()` now buckets by kind, then folds Polar
  `…_part0NofMM` splits **per kind**:
  - **Primary ECG** part-groups (numeric order, `part2` before `part10`) are
    streamed into **one** worker run → one continuous recording. The worker
    (`WORKER_SRC`) accepts `files[]` and streams each part in order; repeated
    header lines auto-drop (non-numeric last column), and the `timestamp [ms]`
    column stays monotonic across part boundaries so gap detection and `t0Ms`
    (from part 1) stay correct. Every part is `noteInput`-attested for provenance.
  - **Companions** (ACC/RR/HR) split files are concatenated (header from part 1)
    and routed to the existing single-file loaders unchanged.
  - Single-file drops are byte-identical to before (one-element groups).
- **Verified through the real drop path**: 3 out-of-order ECG parts with repeated
  headers fold into **one** recording (recording-switcher stays hidden), not three
  fragments.

### §2 — Multi-part fix is unit-tested (both runners)
- The fold lives in `PPGDSP.mergeMultipart` / `ECGDSP.mergeMultipart` (loaded live
  in `tests/run-tests.mjs` **and** `Dex-Test-Suite.html`), and **PpgDex now
  delegates** to it (`DSP.mergeMultipart`) — so the assertion exercises the real
  ingest path, not a copy.
- New group **“Multi-part split-file concatenation (ingest §1/§2)”** in
  `tests/dex-tests.js`: feeds out-of-order parts with repeated headers, asserts one
  merged stream, numeric part order, header appears exactly once, base-name strip,
  and that non-part singles pass through. Runs against both PPGDSP and ECGDSP.

### §3 — PulseDex empty / all-zero onboard stream
- **`pulsedex-dsp.js`** — `parseRRInput()` now also returns
  `{ nRaw, nUsable, usable, reason }` (additive; counts intervals in the
  physiological 250–3000 ms band). Header-only PPI → `usable:false` with a
  “columns present but no interval rows … no usable beats” reason; all-zero
  HR/PPI → “all N values outside the physiological range … no usable beats”.
- **`pulsedex-app.js`** — `calculate()` gates on `parsed.usable === false`
  **before** artifact-cleaning (catches the all-zero case that previously slipped
  the `<10`-values gate and produced a zero analysis), surfaces the explicit
  `reason`, and points the user at the raw-waveform node:
  *“analyze the raw optical waveform in PpgDex (`*_PPG.txt`) …”.*
- Also folds Polar `_RR_part…` / `_PPI_part…` splits in `loadRawFiles`
  (`mergeMultipart`, mirrored locally in `pulsedex-dsp.js`).
- New group **“PulseDex empty/all-zero onboard stream → explicit null (ingest §3)”**
  (source-mirror, like the existing `oxydex-dsp` groups — `parseRRInput` is
  global-scope and not headless-loadable).

### §4 — PpgDex `classify()` `*_HR.txt` misroute (latent)
- **`ppgdex-app.js`** — added an `hr` branch to `classify()` so a Polar `*_HR.txt`
  no longer falls through to `'ppg'` and into `parsePPG` (which expects a 6-column
  waveform → throw). HR files are ignored with a friendly note pointing at the raw
  `*_PPG.txt` (PpgDex is raw-PPG-first). Inline multipart helper removed in favor
  of `DSP.mergeMultipart`.

### §5 — Paper polish (static doc, no gate)
- **`papers/sigma-no-reference.html` §3.2** — added one sentence reconciling the
  H10 ≈0.7 bpm short-term repeatability (§2.3/§3.1, rolling-median residual) with
  the three-cornered-hat 2.17 bpm (total reference-free variance incl. 1-Hz
  bucketing + instantaneous-ECG granularity) so the two aren’t read as contradictory.

---

## §6 — Node × checklist audit

Legend: ✓ handled · ✓* handled this pass · n/a not applicable (input cannot occur)

| Node | Multi-part split | Empty/all-zero → null+reason | Polar/vendor formats (regex) | Clock Contract | fs from sensor-ns | Drop out-of-range/dropout | Filename-stamp anchor |
|---|---|---|---|---|---|---|---|
| **oxydex** | n/a — Wellue O2Ring exports one whole CSV/night; not Polar-split (dup-by-startTs already guards re-imports) | ✓ — no-night parse → explicit “No valid data” error + per-file warnings | ✓ O2Ring CSV `HH:MM:SS DD/MM/YYYY` (DMY) + JSON/JSONL + native `.dat/.bin` | ✓ | n/a (1 Hz fixed) | ✓ `--`/`- -`, out-of-range dropped | ✓ |
| **ecgdex** | ✓* primary ECG + companion ACC/RR/HR | ✓ 0-sample stream → worker yields n=0 (no fabricated `t0Ms`; `_floatNow` only when no stamp) | ✓ ECG `…;timestamp [ms];ecg [uV]` (~130 Hz); RR/PPI; HR | ✓ worker + main-thread mirror | ✓ median `timestamp [ms]` delta → fs | ✓ HR<30/>220 & non-numeric rows skipped | ✓ `YYYYMMDD_HHMMSS` |
| **ppgdex** | ✓ PPG + ACC/GYRO/MAGN/PPI/MARKER | ✓ no-PPG → explicit error; device-PPI lane reports `usable:false` | ✓* PPG `…;ch0;ch1;ch2;ambient` (~176 Hz); `*_HR.txt` now classified (was misrouted) | ✓ | ✓ median sensor-ns delta → fs | ✓ SQI + motion gate; out-of-range beats corrected | ✓ |
| **pulsedex** | ✓* RR/PPI splits | ✓* header-only PPI & all-zero HR → `{usable:false, reason}` + UI pointer to PpgDex | ✓ RR `…;RR-interval [ms]`; PPI `…;PP-interval [ms];…`; Welltory CSV | ✓ | n/a (interval list, not sampled) | ✓ artifact-clean (300–2200 ms / 20% local-median) | ✓ (T5 filename anchor) |
| **glucodex** | n/a — CGM (Dexcom/Libre) export is one file; not Polar-split | ✓ parse failure → explicit error (no silent empty) | ✓ CGM CSV; ECGDex JSON; Cronometer nutrition | ✓ | n/a (5-min CGM cadence) | ✓ non-numeric/blank glucose rows dropped | ✓ |
| **Integrator** | n/a — ingests node-export **JSON** (one per node); not stream-split | ✓ `normalizeFile` collects warnings; empty/over-trimmed envelopes flagged, never fabricated | ✓ consumes `ganglior.node-export` (+ `fascia` back-compat alias) | ✓ (event `t` → absolute `tMs` via `startEpochMs`, midnight-rolling) | n/a | ✓ dedupes stampless duplicates | n/a |

No retired badge vocabulary touched; no `@font-face`/CDN added; `parseTimestamp`
left duplicated per module (Clock Contract); no `ganglior.*` / `fascia` identifiers
changed.

---

## §7 — Bundles, gates, build-hash

**Re-bundled** (sources edited → re-inlined via the bundler): `ECGDex.html`,
`PpgDex.html`, `PulseDex.html`. (`tests/*` and the paper are not bundled.)

**buildHash — unchanged** (only external `*-dsp.js`/`*-app.js` were edited, never
the `.src.html` shells that the `__bundler/template` hashes):

| Bundle | buildHash | fixtures |
|---|---|---|
| ECGDex.html | `446a8ecf3527` | — |
| PpgDex.html | `ab7d7d51ae21` | pre-R1 fixture → “no provenance” (fine); matches the §0-verified value |
| PulseDex.html | `77e4ccfaab1e` | pre-R1 fixtures → “no provenance” (fine) |

**Gates**
- `Dex-Test-Suite.html` — **all green, 543 passed / 34 groups** (was 517/32; +2
  groups, +1 net assertion family for §2/§3).
- `verify-provenance.html` — **no red verdicts**: every stamped fixture
  “reproducible ✓”, pre-R1 fixtures “no provenance” (expected).

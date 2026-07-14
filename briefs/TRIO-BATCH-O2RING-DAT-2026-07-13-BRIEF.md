<!--
  TRIO-BATCH-O2RING-DAT-2026-07-13-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-07-13 (§1 decoder exposed export-inert · §2 `.dat` anchors a night · equivalence proved on 2026-07-06, the night that has both files: same-code CSV-path ≡ `.dat`-path, **zero diffs**; 6 previously-invisible nights recovered — and the audit that followed found **2 more** trio-capable nights, 2026-06-20 + 2026-07-04, that had complete data *and* vendor CSVs and had simply never been run) · **Created:** 2026-07-13

# trio-batch: anchor a night on the O2Ring **native `.dat`**, not only the vendor CSV

## The bug, and how it hid

`tools/trio-batch.mjs` discovers the oximetry corner with **one** pattern:

```js
const RE_O2 = /^O2Ring[^_]*_(\d{14})\.csv$/;   // line 223 — .csv ONLY
```

and then **anchors the whole night on it** (line ~342: *"Anchor on the O2Ring: it is always the sleep
session"*). No O2Ring file ⇒ `⊘ not a trio night (no O2Ring anchor)` ⇒ the night is dropped — **even when
a complete Polar H10 ECG + Verity PPG pair is sitting right there**.

The O2Ring app writes **two** files per session: the vendor CSV *and* the device's native `.dat`
(same 14-digit stamp). When the CSV export stops — the app is not opened, the phone is not synced —
the `.dat` still lands in the capture folder. `trio-batch` cannot see it, so those nights vanish.

**This is not hypothetical.** In the 2026-07-13 capture folder, **20 `.dat` files had no paired CSV**,
six of them (2026-07-07 … 07-12) with full concurrent Polar streams. Six analyzable nights were
invisible. The failure is silent by construction: a dropped night prints one `⊘` among hundreds of
`·` skip lines, and the run still exits 0.

**OxyDex itself has read this format the whole time** — `oxydex-dsp.js` `isO2RingBin()` /
`decodeO2RingBinToCSV()`, reachable from the browser drop path (`OxyDex.html`'s file input already
lists `.dat`). Only the *headless* corner was blind: `OxyDex.compute()` accepts
`{samples|rows|text}` (line ~5786) — never bytes — so even a `.dat` handed to it would not parse.

## The fix

**Reuse the decoder; do not copy it.** The 3-byte record layout, the `0xFF 0xFF` trailer, the
`motion × 2` scale and the filename→`t0` rule are already written down once, correctly, in
`oxydex-dsp.js`. A second copy in `tools/` would drift.

### §1 — `oxydex-dsp.js`: expose the two existing functions (export-inert)

Add to the public namespace block (~line 5900), alongside the existing `OxyDex.parseCSV` /
`OxyDex.trimSensorWarmup` precedent:

```js
OxyDex.isO2RingBin = isO2RingBin;
OxyDex.decodeO2RingBinToCSV = decodeO2RingBinToCSV;
```

No DSP logic changes. `compute()` output is **byte-identical** ⇒ no fixture output moves; the rebuild
re-stamps `manifestHash` only (an export-inert rebuild of identical source moves nothing else).

### §2 — `tools/trio-batch.mjs`: accept the `.dat` as an oxy candidate

1. `RE_O2_DAT = /^(\d{14})\.dat$/` — index it as an `oxy` candidate with `kind:'dat'` (CSV ⇒ `kind:'csv'`).
2. **Prefer the vendor CSV when both exist for the same stamp.** Deduplicate on the 14-digit stamp and
   drop the `.dat` twin. Rationale: the vendor CSV is the corpus's established provenance, and the two
   are equivalent (see *Evidence*). Without this the two files would both be oxy candidates for one
   night and the anchor would be decided by `bytes` — an accident, not a rule.
3. **End-stamp.** The `[t0, tEnd]` window is read from a 64 KB tail for text streams; a `.dat` has no
   text timestamps, so decode it (the files are ~75 KB — full decode is free) and take
   `tEnd = t0 + samples × 1000 ms`.
4. **Compute.** For `kind:'dat'`, read the file as bytes and decode via the newly exposed
   `OxyDex.decodeO2RingBinToCSV(bytes, name)` → CSV text → the existing `OxyDex.compute({text})` path.
   Stamp `source: 'o2ring-dat'` (the free-form provenance string; `o2ring-csv` for the CSV path).

## Evidence — the two formats are the same recording

Night **2026-07-06** has *both* files. Decoding `20260706224137.dat` with the `oxydex-dsp.js` rules and
comparing against the vendor `O2Ring S 2100_20260706224137.csv`:

- **24,040 decoded samples ≡ 24,040 non-blank CSV rows — zero mismatches** on SpO₂, pulse **and** motion.
- The `motion × 2` scale is *confirmed, not assumed*: 83 motion mismatches without the doubling, 0 with it.
- The CSV's 10 trailing `- -` rows begin exactly where the `.dat`'s `0xFF 0xFF` trailer starts.

## Done when

- [x] §1 exports land; `node tools/build.mjs --app OxyDex` re-stamps `manifestHash`
      (`5453679d7a50 → f3b6705502fc`, 3 fixtures re-stamped); `--check` clean.
      **The two orchestrators inline `oxydex-dsp.js` too** — `Data Unifier.html` + `OverDex.html` drifted
      and were rebuilt in the same pass (`--check` is the guard that catches this; `--app OxyDex` alone
      leaves the repo red).
- [x] §2 lands; a folder whose CSVs stop mid-corpus now plans the `.dat`-only nights as trios
      (2026-07-07 · 07-08 · 07-09 · 07-11 · 07-12 — five of the six; 07-10's Polar logger died 30 min in,
      which is a capture dropout, not a parse failure).
- [x] **Equivalence:** 2026-07-06 computed from its `.dat` alone ≡ the same night from its vendor CSV —
      **0 diffs** across every metric, event and timeseries value (provenance/`contentId` aside, which
      *must* differ). Note the *committed* 07-06 export differs from both: it predates the current
      `desatProfile.events[].tMs` fields, so the corpus carries code-version drift — a separate matter.
- [x] Gates: `npm run check` green — **2343 passing · 0 failing · 2 skipped** (149 groups).
      ⚠️ `node_modules` was absent on this machine, so `npm run lint` had been silently unrunnable
      (`biome: not found`) and the chain exited non-zero at lint before any test ran. Installed.
- [x] `DOCS-INDEX.md` links this brief. The `docs-ledger` gate **caught a real inconsistency** during
      execution — the index row said `DONE` while this header still said `IN-PROGRESS` (check3b), which
      is exactly the "status-in-header is the source of truth" contract biting as designed.

## Not in scope

- **Back-filling the pre-Polar oximetry.** 14 of the 20 CSV-less `.dat`s are **2026-05-07 … 06-05**,
  before the Polar sensors existed. They can never be trios; `uploads/trio` is trio-only by definition.
  Whether a single-node OxyDex corpus is worth committing is a separate question, and needs its own brief.
- **The silent-drop ergonomics.** A night rejected for a *missing* corner and a night rejected for a
  *non-concurrent* corner both print one line and exit 0. A `--strict` / summary-of-dropped-nights flag
  would have surfaced this in June. Deliberately deferred: it is a UX change, not a data-loss fix, and
  it belongs in its own brief.

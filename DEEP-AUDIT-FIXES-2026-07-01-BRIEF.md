<!--
  DEEP-AUDIT-FIXES-2026-07-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-07-01 (both findings executed; both gates green) · **Created:** 2026-07-01 · **Owner brand:** Tepna
**Executes:** [`DEEP-AUDIT-FINDINGS-2026-07-01.md`](DEEP-AUDIT-FINDINGS-2026-07-01.md) (its prioritized punch-list — Finding 1 + Finding 2)
**Follows:** [`DEEP-AUDIT-FIXES-2026-06-30-BRIEF.md`](DEEP-AUDIT-FIXES-2026-06-30-BRIEF.md)

## Execution log (2026-07-01)

- **Finding 1 (HRVDex, MED — fabricated absence) — DONE + gate-green.** `hrvdex-dsp.js`:
  - NEW `numOrNull(cell)` helper (`''`/`undefined`/non-finite → `null`; a real numeric string incl.
    `'0'` → its number). The **TRANSPARENT** (objective) summary columns now parse through it —
    `_hr/_meanRR/_sdnn/_rmssd/_mxdmn/_pnn50/_amo50/_mode/_totalPow/_hf/_lf/_vlf/_cv` — so a blank/absent
    core cell is `null`, **not a fabricated 0**. The six **SUBJECTIVE** Welltory black-box columns
    (`_stress/_energy/_focus/_sns/_psns/_coherence`) and the proprietary `_hrv` HRV Score **keep `||0`**
    (the `_hasSubj` presence gate in `computeDerived` relies on them moving as an all-or-none 0-seed
    group — the WELLTORY-COMPOSITES quarantine; migrating them to `null` is a separate decision).
  - The 7-day rolling **SDNN filter is now symmetric with its rMSSD twin** — `sdnn7 = …filter(v =>
    !isNaN(v) && v > 0)` (was `!isNaN(v)` only), so a `null`/`0` never enters `meanSDNN7`/`stdSDNN7`.
    And `d_sdnn_z` gates on the row's **OWN** `_sdnn > 0` (was `stdSDNN7 > 0` only), so an absent-SDNN
    row gets `NaN`, not a fabricated z from a `null − mean` coercion. Net: a blank core cell no longer
    biases the rolling SDNN baseline **or** the row's own z-score (the audit's `~33 %` reproduction).
  - `null` **round-trips through persistence** — `_seedFromRow`/`_rowFromSeed` preserve `null` (was
    coerced to `0`); subjective fields stay finite (`0`) so they are unaffected.
  - External-JS-only edit (`hrvdex-dsp.js`) → **HRVDex re-bundled `manifestHash 6c4a8930b1cb →
    00578ca08503`**, `buildHash de20db283366` UNCHANGED (no inline-script/style `.src.html` edit).
  - **EXPORT-INERT:** the committed Welltory CSV has complete core cells, so `numOrNull` returns the
    same numbers `parseFloat` did → `HRVDex.compute()` reproduces byte-identical (`env.equiv.hrvdex`
    green). Both HRVDex code-gated fixtures (`equiv` + `events`) **re-recorded `manifestHash` only** in
    `FIXTURE-PROVENANCE.json`, NOT regenerated (`outputHash`/`inputHashes` unchanged; GATE B reproducible).

- **Finding 2 (ECGDex, LOW–MED — Clock-Contract / parser drift) — DONE + gate-green.** `ecgdex-app.js`:
  - The three device cross-check loaders (`loadDeviceRR`/`loadDeviceHR`/`loadDeviceACC`) now **delegate
    to the Clock-Contract-faithful DSP twins** `ECGDSP.parseDeviceRR`/`parseDeviceHR`/`parseDeviceACC`
    (regex `parseTimestamp` = **floating wall-clock**, viewer-TZ-independent; a missing stamp stays
    `null`). The app-local `parseRows` (which used `Date.parse` — locale/viewer-TZ-dependent) is
    **deleted**, and `loadDeviceHR`'s `_floatNow()` **stampless ramp fabrication** is gone (the twin
    keeps `tsMs: null`). This removes the viewer-timezone-dependent HR-alignment behavior and the
    app-vs-orchestrate parser divergence (the same `*_RR/_HR/_ACC` file now parses identically on both
    entry paths). `loadDeviceACC` re-bases a stampless (`_relBase`) twin result onto `RESULT.t0Ms`
    exactly as the old loader did (Clock §2.6 — never `now()`).
  - `_floatNow()`/`parseTSfloat()` **remain** in the file — they are still used by the **primary** ECG
    loader and the RR/HRV exporters (`:126/:148/:1092/:1119`), which are OUT OF SCOPE for this finding
    (see the follow-ups brief §1).
  - External-JS-only edit (`ecgdex-app.js`) → **ECGDex re-bundled `manifestHash 39388acbc7dd →
    ede9e04831c8`**, `buildHash 146ac9c8b1bd` UNCHANGED.
  - **EXPORT-INERT:** the cross-check is display-only, absent from `ecgBuildNodeExport`, so
    `ECGDex.compute()` reproduces byte-identical (`env.equiv.ecgdex` green). The one ECGDex code-gated
    fixture (`equiv`) **re-recorded `manifestHash` only**, NOT regenerated.

- **Regression gates added (`tests/dex-tests.js`, both runners):**
  - HRVDex group *"HRVDex Phase-9 — compute() surface + summary adapter"* gained a Finding-1
    **source-mirror** block (numOrNull present; transparent cols use it; subjective keep `||0`; the
    symmetric `sdnn7` filter; the `d_sdnn_z` presence gate) plus a **functional** parse test in the
    *"Phase-9 compute() — headless functional floor"* group (a blank-`SDNN` Welltory row → `_sdnn ===
    null` and `_rmssd`/`_pnn50 === null`, a present cell → its number, subjective Stress → `0`, and a
    genuine `'0'` cell → `0`).
  - NEW group *"ECGDex device cross-check parsers — floating clock, no Date-parse/now() (Finding 2)"*:
    `parseDeviceRR` tsMs `=== Date.UTC(components)` (floating, NOT a viewer-local `Date.parse` instant);
    a stampless HR row → `tsMs === null`; source-mirror that the app loaders call `DSP.parseDevice*` and
    that `parseRows` + a `Date.parse` call are gone from `ecgdex-app.js`.

- **Gates.** `verify-provenance` core (recomputed from disk via `manifest-gate.js`): **GATE A 8/8
  match** `BUILD-MANIFEST.json` (`HRVDex 00578ca08503`, `ECGDex ede9e04831c8`, the other 6 unchanged);
  **GATE B 15/15 reproducible, 0 drift, 0 absent** (the 3 re-recorded fixtures reproduce byte-identical
  at their new `manifestHash`; the 2 Integrator historical fixtures byte-pinned OK); `__provenanceOK`
  ≡ true. `Dex-Test-Suite.html` headless floor **green — 1534 passed / 98 groups, 0 failing**
  (the only red rows are the known sandbox JSON-fetch artifact for `BUILD-MANIFEST.json` /
  `FIXTURE-PROVENANCE.json`, which parse cleanly on disk — not a code issue); the `env.equiv.hrvdex` +
  `env.equiv.ecgdex` equivalence legs confirm the export-inertness dynamically.

- **Discovered during execution → `DEEP-AUDIT-FIXES-FOLLOWUPS-2026-07-01-BRIEF.md`:** (1) the ECGDex
  **primary** ECG loader + RR/HRV exporters still fall back to `_floatNow()` for a missing `t0Ms` (a
  Clock §2.6 question separate from the cross-check loaders); (2) HRVDex's pNN50 rolling slope
  (`pnn507`/`win_pnn`) still filters `!isNaN`, so a blank pNN50 is coerced to `0` in the slope (a
  latent fabricated-absence, unchanged by this pass — pre-existing behavior identical to the old
  parse-to-0); (3) the deliberate deferral of migrating the six SUBJECTIVE columns to `null` +
  presence-gate.

# Deep-audit fixes — HRVDex fabricated-absence · ECGDex cross-check Clock Contract

> **Read `CLAUDE.md` first** — the two gates (`Dex-Test-Suite.html`, `verify-provenance.html`), the
> Clock Contract, the frozen `Ganglior`/`fascia` identifiers, and the **edit-`*.js`/`.src.html`,
> never the bundled `*.html`, then re-bundle** rule. This brief turns the two residues in the
> 2026-07-01 deep-audit into ordered, gate-checked edits. Everything the audit VERIFIED CLEAN (units
> mandate · `std()`/SDNN unification · spectral honesty · ECGDex stampless events · silent fallbacks ·
> provenance) is **out of scope — do not re-investigate it.**

Both findings are the residue OUTSIDE the prior clean-ledger. Finding 1 (MED) is the one real
surfaced-number defect; Finding 2 (LOW–MED) is a contract/parser drift on a display-only path. Done in
priority order — correctness first.

---

## Finding 1 · (MED) HRVDex transparent columns fabricate `0` for an absent cell → the fake `0` pollutes the rolling SDNN baseline

**What's wrong.** In the HRV-summary parser a blank/absent *transparent* column
(`SDNN`/`rMSSD`/`Mean RR`/`pNN50`/…) parsed to `parseFloat('' || 0)` = **`0`**, not `null`. The row
still entered `allRows` (push gated only on a finite timestamp), and the fake `_sdnn = 0` flowed into
the 7-day rolling SDNN baseline because `sdnn7` filtered `!isNaN(v)` only while its rMSSD twin filtered
`!isNaN(v) && v > 0` — biasing `meanSDNN7`/`stdSDNN7` → `d_sdnn_z` (~33 % on the audit's 3-row repro).

**Fix (executed).** Parse absent transparent cells to `null` via `numOrNull`; keep the subjective
columns at `||0`; make the SDNN rolling filter symmetric (`&& v > 0`); gate `d_sdnn_z` on the row's own
`_sdnn > 0`; preserve `null` through `_seedFromRow`/`_rowFromSeed`. See the execution log.

**Gate cost.** One HRVDex re-bundle (`manifestHash` bump only; `buildHash` unchanged), EXPORT-INERT →
fixtures re-recorded not regenerated. Regression assertions added (source-mirror + functional).

---

## Finding 2 · (LOW–MED) ECGDex device cross-check loaders use `Date.parse` + `_floatNow()`, diverging from the Clock-Contract-faithful DSP twins

**What's wrong.** `ecgdex-app.js`'s `parseRows` used `Date.parse()` (viewer-timezone-dependent) and
`loadDeviceHR` fabricated `_floatNow()` for a stampless row — while the contract-faithful DSP twins
(`ECGDSP.parseDeviceRR/parseDeviceHR/parseDeviceACC`, regex `parseTimestamp`, `null` stays `null`)
already existed and were the ones the Unifier/OverDex routed path used. The same `*_RR/_HR/_ACC` file
therefore parsed to a different `tsMs` depending on entry path and viewer timezone; `validateHR`'s
window test was viewer-TZ-sensitive (charter bug class #2).

**Fix (executed).** Point the three loaders at the DSP twins; delete `parseRows` and the
`Date.parse`/`_floatNow` copies. Behavior-preserving for the correctly-stamped UTC-viewer case; removes
the TZ-dependence and the stampless fabrication. See the execution log.

**Gate cost.** One ECGDex re-bundle (`manifestHash` bump only), EXPORT-INERT (display-only path, absent
from `buildNodeExport`) → fixture re-recorded not regenerated. Parity + TZ-invariance + stampless-null
assertions added.

---

## Acceptance
- [x] **Finding 1 done:** transparent cols parse absent→`null` (`numOrNull`), subjective keep `||0`,
      symmetric `sdnn7` filter, `d_sdnn_z` presence gate, `null` persistence round-trip; edited
      `hrvdex-dsp.js` (never the bundled `.html`); **HRVDex re-bundled** `6c4a8930b1cb→00578ca08503`,
      `buildHash de20db283366` unchanged; both HRVDex fixtures re-recorded `manifestHash` (NOT
      regenerated); source-mirror + functional regression assertions added.
- [x] **Finding 2 done:** the three cross-check loaders delegate to `ECGDSP.parseDevice*`; `parseRows`
      + `Date.parse` + `_floatNow` stampless ramp removed; edited `ecgdex-app.js`; **ECGDex re-bundled**
      `39388acbc7dd→ede9e04831c8`, `buildHash 146ac9c8b1bd` unchanged; `ecgdex` fixture re-recorded
      `manifestHash` (NOT regenerated); parity + TZ-invariance + stampless-null assertions added.
- [x] **Both gates green:** `verify-provenance` GATE A 8/8 + GATE B 15/15 reproducible
      (`__provenanceOK` ≡ true); `Dex-Test-Suite.html` headless floor all-green (1534/98) incl. the two
      new regression groups + the `env.equiv.hrvdex`/`ecgdex` equivalence legs. Clock Contract honored
      (floating `tMs`, no `now()`); no new unbadged metric; the `ganglior.node-export`/`ganglior_events`
      schema preserved; `Ganglior`/`fascia` untouched.
- [x] **Lifecycle:** header flipped to `Status: DONE — 2026-07-01` (filename frozen), findings doc noted
      as executed, `DOCS-INDEX.md` row synced, residue captured in
      `DEEP-AUDIT-FIXES-FOLLOWUPS-2026-07-01-BRIEF.md`.

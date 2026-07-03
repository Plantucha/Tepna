<!--
  DEEP-AUDIT-FIXES-FOLLOWUPS-II-2026-07-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-01 · **Owner brand:** Tepna
**Follows:** [`DEEP-AUDIT-FIXES-FOLLOWUPS-2026-07-01-BRIEF.md`](DEEP-AUDIT-FIXES-FOLLOWUPS-2026-07-01-BRIEF.md) (residue surfaced while executing its §1+§2; the parent's "no residue" line is superseded by this brief)
**Context:** the 2026-07-01 deep-audit pass made HRVDex transparent columns **nullable** (`numOrNull`, [`DEEP-AUDIT-FIXES-2026-07-01-BRIEF.md`](DEEP-AUDIT-FIXES-2026-07-01-BRIEF.md) Finding 1) and made the ECGDex primary loader **thread null** for a stampless recording (this brief's parent §1). Two consequences of *those* changes were only reasoned-about statically, not fixed/verified — captured here.

# Deep-audit fixes — follow-ups II (consequences of making fields nullable)

> **Read `CLAUDE.md` first** — the two gates, the Clock Contract, the edit-`*.js`/`.src.html`-then-rebundle
> rule, frozen `Ganglior`/`fascia`. Everything the 2026-07-01 passes already fixed/decided (HRVDex
> `numOrNull` + symmetric SDNN filter + `d_sdnn_z` gate + pNN50-slope `Number.isFinite`; ECGDex
> cross-check twins + primary-loader thread-null + `_floatNow` retirement; the §3 subjective-columns
> no-go) is **out of scope — do not re-open it.**

Both items are the **same root class** the earlier passes fixed *pointwise*: once a field can be `null`,
any consumer that used **`!isNaN(x)` / `isFinite(x)` as a "present?" test is wrong**, because
`isNaN(null) === false` and `isFinite(null) === true` (JS coerces `null → 0`) — so a **null passes as a
real 0**. Finding 1 fixed this in the DSP rolling baselines (`sdnn7`, `pnn507`, `d_sdnn_z`); §1/§2 fixed
it in ECGDex loaders + the pNN50 slope. **The render layer and the ECGDex ACC-companion paths were not
swept.** Neither is a *newly*-introduced regression (a blank cell rendered/aggregated as `0` before too,
when it parsed to `0`), so severity is **LOW–MED** — but both are now genuine fabricated-absence leaks in
*surfaced* views/paths, and closing them completes the nullability change honestly.

Correctness order.

---

## §1 · (LOW–MED, the real one) HRVDex render layer plots/aggregates a blank transparent cell as `0` (fabricated absence in surfaced viz)

**What's wrong.** `hrvdex-render.js` has two pattern-explorer views that read a **raw transparent
field** (`_sdnn`/`_rmssd`/`_hr`/`_pnn50`/… — all now nullable) directly and gate presence with
`isFinite`, which **passes `null`** (→ coerced to `0`):
- **Correlation scatter (`~:819`):** `const pts = rows.map(r=>({ x:r[kx], y:r[ky] })).filter(p=>isFinite(p.x) && isFinite(p.y));` — `kx`/`ky` are user-selectable metric keys (default `_rmssd`/`_sdnn`; any `PATTERN_METRICS` key). A row with a **blank SDNN/rMSSD/… cell** has `r[kx] === null`; `isFinite(null) === true`, so it enters as a **`(0, y)` point** → drags the plotted cloud toward the axes and **biases the reported Pearson r** (computed at `:820` over the same points).
- **Weekday distribution (`~:849`):** `rows.forEach(r=>{ const v=r[key]; if(!isFinite(v)) return; … buckets[d].push(v); });` — a blank cell for the selected metric is pushed as **`0`** into that weekday's bucket → **deflates the weekday average bar** and the hi/lo readout (`:856`).

`_patVals` (`:771`, `typeof v==='number' && isFinite(v)`) is **already correct** (a `null` is not `typeof
number` → dropped), so the correlation **heatmap** (which routes through `_patVals`→`_patPearson`) is
protected. The two DIRECT-read paths above are the leaks. This is the render-layer twin of the DSP
`sdnn7` fix.

**Reproduction.** Load a Welltory CSV with ≥1 row whose SDNN (or rMSSD) cell is blank, open the pattern
explorer, select that metric on an axis: the blank day appears as a `0` point in the scatter (and a `0`
contribution to its weekday bucket) rather than being excluded. (Or, headlessly: build a `rows` array
with one `_sdnn:null` row and assert the scatter/weekday filters drop it.)

**Fix.** Make the two direct-read presence checks match `_patVals` — drop `null` (and `NaN`), **keep a
real `0`** (a genuine `0` for e.g. pNN50 is physiological and must stay):
- `:819` → `.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))` (or `typeof p.x==='number' && isFinite(p.x)`, matching `_patVals`).
- `:849` → `const v=r[key]; if(!(typeof v==='number' && isFinite(v))) return;` (or `if(!Number.isFinite(v)) return;`).
- Audit the rest of `hrvdex-render.js` for any other **raw `_`-field** read behind `isFinite`/`!isNaN`
  (the `d_*` derived fields are already `NaN`-on-absent, so their `!isNaN` checks are fine — this is only
  about the raw transparent inputs `_sdnn/_rmssd/_hr/_meanRR/_pnn50/_mxdmn/_mode/_amo50/_totalPow/_hf/_lf/_vlf/_cv`). The KPI/hero cards already use `v != null && !isNaN(v)` (`:177`,`:260`) — those are correct, leave them.

**Gate cost.** `hrvdex-render.js` edit → **re-bundle HRVDex** (`manifestHash` bump; `buildHash` unchanged
— external-JS). **EXPORT-INERT** (render-only; `hrvBuildNodeExport`/`compute` untouched) → the two HRVDex
code-gated fixtures re-record `manifestHash` only, NOT regenerated (confirm via `env.equiv.hrvdex`). Add a
regression assertion (source-mirror that the scatter/weekday filters use a presence-correct test; +, if
you expose a headless hook, a functional check that a `null`-cell row is excluded while a `0`-cell row is
kept).

---

## §2 · (LOW, verification debt) ECGDex stampless-primary-ECG runtime paths were reasoned null-safe, not exercised

**What's open.** The parent §1 made a stampless primary ECG yield `RESULT.t0Ms = null` (instead of a
fabricated `_floatNow()`). The following were **confirmed** null-safe by reading the code: `_fmtEpochClock`
(relative `"Nm"` axis), node-export `startEpochMs:r.t0Ms||null`, `validateHR` (its `_alignDevSeconds` does
`if(ecgT0Ms)…` then `base = rows[0].tsMs` → self-relative to the device-HR clock), the rec-map synthetic
key, and `exportName`→`'undated'`. **Not exercised** — three ACC-companion functions that receive
`ecgT0Ms` and run only when a **stampless primary ECG is loaded *with* an ACC companion** (edge-within-
edge): `stampEpochPositions(epochs, deviceACC, accFs, ecgT0Ms, durSec)` (`ecgdex-dsp.js:1477`),
`accAnalyze(deviceACC, accFs, ecgT0Ms, durSec, epochs)` (`:1499`), `accExtras(…, ecgT0Ms, …)` (`:1659`).
If any does `new Date(ecgT0Ms + …)` or absolute-stamp arithmetic assuming a number, `null → 0` yields
**1970-based epoch positions / NaN**, silently. Also unverified: the **undated export anchor** — a
stampless recording's `exportRR`/`_welltoryRowFor` now anchor at `0` (1970-01-01, deterministic
relative-from-0), so `ecgdex_computed_RR_undated.txt` carries 1970 timestamps and the Welltory-CSV row is
dated 1970-01-01 — is that a sensible **downstream** ingest into PulseDex / HRVDex, or should "undated" be
represented as a bare relative `HH:MM:SS`-from-00:00 (no date) or skipped?

**Reproduction.** `ECGDSP.genSynthetic({durSec:1800})` → set `rec.t0Ms = null` → attach a synthetic
`deviceACC` → `analyze(rec)` → call `accExtras`/`stampEpochPositions` and assert epoch positions are
**relative / not 1970-anchored / not NaN** (mirror of the existing `group('ECGDex stampless events — null
clock, never now()')` at `tests/dex-tests.js:~567`, extended to the ACC path). For the export: run
`exportRR` on a null-`t0Ms` RESULT and assert the emitted timestamps are a documented relative form, then
ingest into PulseDex and confirm the HRV is spacing-correct.

**Fix.** Read the three ACC functions; where they build absolute stamps from `ecgT0Ms`, guard `ecgT0Ms ==
null` → compute relative (from `0`/epoch index) exactly as the `_relBase` ACC path already does. If they
already treat `ecgT0Ms` as an optional offset (likely — the ACC path is built around `_relBase` relative
timing), then **no code change is needed** and this collapses to *adding the regression test* + a decision
on the undated-export representation.

**Gate cost.** If guards are needed → `ecgdex-dsp.js` edit → **re-bundle ECGDex** (`manifestHash` bump),
**EXPORT-INERT** (the equiv fixture is a *stamped* clip; the ACC path is display-only, absent from
`ecgBuildNodeExport`) → re-record `manifestHash` only. If verification-only (no code) → **no re-bundle**,
just new test assertions. Either way add the stampless-ACC + stampless-export assertions (both runners).

---

## Verification & environment note (NOT a code defect — so the next coder does not chase it)

In **this sandbox** the *browser* gates are unreliable to READ, though the underlying files are correct:
1. **`verify-provenance.html` + the Dex-Test-Suite "Manifest JSON well-formed" group** show a GATE-A/B
   **red** — `BUILD-MANIFEST.json` / `FIXTURE-PROVENANCE.json` "failed to load/parse (… position 78 …)".
   Both files are **valid JSON on disk** (`JSON.parse` succeeds); the served blob in the preview is
   transformed (no early newline → "line 1 column 79"), a **fetch/serve artifact**, not corruption.
2. **Render-coverage (`?full`)** rigs saturate the preview → `eval_js`/screenshot **time out**, so the
   all-green pill is hard to read here.

**Authoritative gate runs** (use these, not the browser, in this environment): `node tests/run-tests.mjs`
(behavior) and `node tests/verify-manifest.mjs` (GATE A + best-effort GATE B); or recompute from disk with
`ManifestGate.manifestHashFromText` + `gateBEvaluate` in a script (the method used across the 2026-07-01
passes — GATE A 8/8, GATE B 15/15 confirmed that way). The 2026-07-01 code changes were validated by (a)
`new Function(src)` syntax checks, (b) direct source-mirror regex over the loose `.js`, and (c) the
disk-recomputed gates — the browser render-coverage boot was NOT read. **If you can run node CI, do a full
`run-tests.mjs` pass to close that residual** (confirm the new source-mirror groups + the two new §-groups
here are green, and that no render-coverage rig regressed).

---

## Acceptance (any PR off this brief)
- [ ] **§1 done:** `hrvdex-render.js` correlation-scatter (`:819`) + weekday-distribution (`:849`) presence
      checks drop `null`/`NaN` but KEEP a real `0`; other raw-`_`-field `isFinite`/`!isNaN` reads audited;
      HRVDex re-bundled (`manifestHash` bump, `buildHash` unchanged), fixtures re-recorded (export-inert),
      regression assertion added.
- [ ] **§2 done:** the three ACC functions verified/guarded for `ecgT0Ms == null` (relative, never 1970/NaN);
      undated-export representation decided; stampless-ACC + stampless-export regression tests added; ECGDex
      re-bundled only if code changed (else test-only).
- [ ] **Both gates green** via node CI (`run-tests.mjs` + `verify-manifest.mjs`): GATE A 8/8 + GATE B
      reproducible; behavior all-green incl. render-coverage. Clock Contract honored (no `now()`, floating
      `tMs`); no new unbadged metric; `ganglior.node-export` schema + `Ganglior`/`fascia` untouched.
- [ ] **Lifecycle:** flip this header to `Status: DONE — <date>` (filename frozen); sync the `DOCS-INDEX.md`
      row; spawn `-III` only if new residue, else state "no residue" in the header.

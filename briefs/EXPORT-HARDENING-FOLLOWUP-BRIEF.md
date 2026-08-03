**Status:** IN-PROGRESS — 2026-08-03 (**§4 MEASURED**: its drift premise is stale — every bundle that inlines `crossnight-envelope.js` carries the current version and `build.mjs --check` now guards it. The wiring half would catch NOTHING: 98 committed exports, 0 failing. Both warnings are validator blind spots — MotionDex's numeric `schema.version` bypasses the unknown-major guard, and the multi-night shape is unknown to it. §2's GlucoDex `tMs` did land)

# Export-Hardening — Follow-up Brief for the Next Coder

**Context:** A multi-session export-format hardening pass landed (CSV null≠0/BOM/CRLF, tidy
summary CSVs + Evidence column, CPAPDex CSV, JSON `exportGanglior` unification, Integrator findings
CSV + ingest diagnostics, a `validateNodeExport()` validator, light-theme PDF/print across all 8
nodes, page-break polish). Suite is green (**632 passed, 39 groups**), provenance all reproducible.
This brief lists what was **found but NOT fixed**, ranked, each with exact location, rationale, the
fix, and the gate to run. Read `CLAUDE.md` first — the gate/re-bundle/provenance rules below are
non-negotiable.

## Ground rules (from CLAUDE.md — apply to every item)
- **Edit `*.js` / `*.src.html`, never the bundled `Foo.html`. Re-bundle after changes** via the
  inliner (`super_inline_html` input=`Foo.src.html` output=`Foo.html`).
- A **`.src.html` change moves `buildHash`** → regenerate that node's `uploads/*.json` fixtures and
  re-check `verify-provenance.html`. A **JS/CSS-only re-bundle does NOT move `buildHash`** → fixtures
  stay reproducible. Every fix below is achievable JS-only.
- **Gates after ANY `*-dsp.js` / `*-app.js` change:** open `Dex-Test-Suite.html`, wait ~5 s, the
  `#summary` pill must say all-green; then `verify-provenance.html` must show no red verdicts.
- The shared assertions in `tests/dex-tests.js` ARE the public contract. Keep back-compat (new params
  LAST + optional; new return data via NEW fields), don't edit assertions to match a behavior change.

---

## 1. ⛔ ECGDex fabricates a timestamp for stampless recordings (HIGHEST VALUE)
**Where:** `ecgdex-dsp.js:1162` —
```js
const events = gangliorEvents(cvhr, ambulatory?[]:stages, rec.t0Ms||Date.now(), sqi, times, epochPos);
```
**Why it matters:** `rec.t0Ms || Date.now()` stamps events at the *viewer's wall-clock now* when a
recording carries no timestamp. This violates the **Clock Contract §2.6** ("NEVER fall back to
`new Date()`/now() — a missing stamp must be visible (null), never fabricated") **and** it is the one
place that makes a real ECGDex export **non-deterministic** (two exports of the same stampless file
differ). ECGDex's own stampless convention elsewhere is `_floatNow()` (a floating-now), not raw
`Date.now()` — so this is also internally inconsistent.
**Fix (choose, in order of preference):**
1. Prefer `rec.t0Ms` and, when absent, pass the node's existing floating fallback `_floatNow()`
   (mirrors ECGDex's stated stampless behavior) — still non-deterministic but at least floating +
   consistent; OR
2. Better per the Contract: thread `null` through and have `gangliorEvents` skip/emit events with
   `tMs:null` (date-unknown, never fabricated), so the export's `recording.startEpochMs:null` and the
   events agree. Check whether `gangliorEvents` already tolerates a null t0 before choosing this.
**Gate:** `Dex-Test-Suite.html` (ECGDex DSP groups) + re-bundle `ECGDex.html` + `verify-provenance`.
Add a regression assertion: a stampless synthetic ECG recording → events carry no fabricated
now()-based tMs (mirror the existing `parseTimestamp … → null (never now())` test at
`tests/dex-tests.js:~1121`).

## 2. GlucoDex fusion events use `t:"HH:MM"` and omit `tMs`
**Where:** `glucodex-app.js` ~L559–564 (computeFusion event builder):
```js
const t0=DSP.hhmm(ecgStartMs||r.t0Ms);
const events=[{ t:t0, impulse:'glucose_autonomic_correlation', node:'GlucoDex', conf, meta:{…} }, …];
```
Also the DSP event builder `glucodex-dsp.js:686+` (`buildEvents`) uses `t:hhmm(...)` (HH:MM, no
seconds, no `tMs`).
**Why:** Every other node emits `t:"HH:MM:SS"` and newer emitters add absolute floating `tMs`
(Clock Contract §6: "New emitters SHOULD additionally write `tMs`"). GlucoDex is the only emitter at
minute resolution with no `tMs`. The Integrator tolerates it (`reconstructEventTMs` handles HH:MM),
so this is a **contract-compliance polish, not a break**.
**Fix:** add a seconds-precision clock string and an absolute floating `tMs` to each emitted event.
There's an `hhmm(ms)` helper; add/borrow an `hhmmss(ms)` (UTC getters per Clock Contract §5) and set
`tMs` to the floating ms used to build `t`. Keep `t` (back-compat) — ADD `tMs`, don't replace.
**Gate:** re-bundle `GlucoDex.html`; `Dex-Test-Suite.html` (glucodex groups) + `verify-provenance`.
Sanity: load a fusion JSON in GlucoDex, export Ganglior, confirm events now carry `tMs` + `HH:MM:SS`.

## 3. `render-coverage` test group is flaky (false-red risk)
**Where:** the final browser-only group in `Dex-Test-Suite.html` (boots a real app bundle in a hidden
iframe, asserts "computed values actually render").
**Symptom observed this session:** on a slow load the suite transiently reported 3 then 7 failures
before settling all-green on a longer wait. The group depends on a fixed delay, not a readiness
signal, so a slow iframe boot = spurious CI red.
**Fix:** replace the fixed wait with a readiness gate — poll for a concrete post-render marker in the
iframe (e.g. the app's results container populated / an `exportBar.show` / a known KPI node) with a
timeout, and only then assert. Keep the timeout generous. This only touches `Dex-Test-Suite.html`'s
harness JS (not a node bundle), so no `buildHash` impact.
**Gate:** reload `Dex-Test-Suite.html` several times; it must be green every time, including a
cold/slow load.

## 4. `validateNodeExport()` exists in the shared module but only the Integrator re-bundled
**Where:** `crossnight-envelope.js` (added `validateNodeExport`, exported on
`global.CrossNightEnvelope`); only `Integrator.html` was re-bundled (the lone consumer). The other 6
node bundles (`OxyDex/ECGDex/GlucoDex/PpgDex/HRVDex/PulseDex.html`) embed the **older**
`crossnight-envelope.js` without the function.
**Why:** Per CLAUDE.md this is an acceptable "inert shared-module addition" (those nodes never call
it). But it IS source-vs-bundle drift; if any of those nodes ever calls `validateNodeExport` it's
`undefined`. **Decision needed:** either (a) leave as-is and add a one-line note in the module that it
ships live only in the Integrator until a future sweep, or (b) re-bundle all 6 (JS-only → no
`buildHash` move → no fixture regen) so source == bundles. Low risk either way; (b) is tidier.
**Gate (if re-bundling):** `Dex-Test-Suite.html` + `verify-provenance` (expect all hashes unchanged).

### §4-RESULT (2026-08-03) — the drift half is GONE, and the wiring half would catch nothing

**The drift premise is stale.** §4 says the other six node bundles "embed the **older**
`crossnight-envelope.js` without the function". Measured: every bundle that inlines the module —
`OxyDex · ECGDex · PpgDex · PulseDex · CPAPDex` — carries the current version (3 occurrences, matching
source); `GlucoDex · HRVDex · MotionDex` do not inline it at all. There is no source↔bundle drift, and
there cannot be one any more: `build.mjs --check` became a standing CI guard after this brief was
written, so option (b) has effectively already happened as a side-effect of other re-bundles.

Note §4's costing is also pre-`OWN-THE-BUILD`: it says a JS-only re-bundle means "no `buildHash` move →
no fixture regen". `manifestHash` is now the code identity and IS a projection of the inlined asset
text, so any such re-bundle *does* move it. Cheap, but not free.

**The wiring half is real but not urgent, and that is measured, not assumed.** The validator ships in
five node bundles and the only production caller is `integrator-app.js:123` — which validates on
**INGEST**, not on export. So no node checks its own output. `tools/validate-exports.mjs` ships with
this entry and runs the real `validateNodeExport` over every committed export:

| | |
|---|---|
| `ganglior.node-export` files scanned | **98** |
| FAILING | **0** |
| with warnings | 2 |

Per node: ECGDex×29 · PpgDex×29 · OxyDex×25 · CPAPDex×5 · GlucoDex×3 · HRVDex×3 · PulseDex×3 ·
MotionDex×1. **Export-time validation would have caught nothing on this corpus.**

#### Both warnings are defects in the VALIDATOR, not in the exports it flagged

1. **MotionDex emits `schema.version: 1` — a number** — where every other node emits `"2.0"`. The
   message fired is *"schema.version missing"*, which is wrong: it is present, just not a string. And
   the unknown-major check on the next line is guarded by `typeof s.version !== 'string' || …`, so the
   numeric form **short-circuits past the very warning that exists to catch an unrecognised major**. A
   node could ship `version: 9` and be waved through. (MotionDex sitting on v1 at all is a separate,
   real contract gap — the fleet is on 2.0 with `nodeVersion`/`bus`.)
2. **`cpapdex_synthetic_multinight_golden`** is warned for having no `recording.startEpochMs` and no
   `ganglior_events[]` — but it declares `schema.multiNight: true` and carries `nights[]` (3 entries)
   with `recording: null` **by design**. The validator has no notion of the multi-night shape.

So across 98 exports the validator's only two complaints are about itself. That sharpens §4's answer:
**wiring export-time validation today would emit two spurious warnings and zero true ones.** Fix the
validator first; then wiring is worth doing and cheap.

#### Not landed here

All three fixes (multi-night awareness · numeric-version guard · MotionDex schema bump) touch modules
inlined into several bundles, so they serialize against in-flight bundle work per `CLAUDE.md` §👥.3 —
two PRs were open. The sweep touches nothing and lands now.

**§4 revised verdict:** (b) is already done by the standing drift guard; the open work is the validator's
two blind spots, then the wiring — in that order.

## 5. No precision policy on exported numbers (minor)
**Where:** `ppgdex-app.js buildV2` epochs + `ppgdex` epochs CSV emit raw epoch HRV
(`e.rmssd,e.sdnn,e.lf,…`) straight from the epoch objects — float noise (`42.317480…`). GlucoDex
(`glucodex-dsp.js round(v,d)`) and ECGDex (`buildV2 round()`) round in-DSP, so they're clean.
**Why:** cosmetic — noisy diffs, marginally larger files; not wrong. **Fix (optional):** route PpgDex
epoch numeric fields through a `round(v,d)` helper consistent with the other nodes (e.g. ms metrics
to 1–2 dp, powers to a sane precision). Don't over-rotate; keep enough precision for downstream HRV.
**Gate:** re-bundle `PpgDex.html` + suite.

## 6. JSON export blobs omit `;charset=utf-8` (trivial)
**Where:** node `exportJSON`/`exportGanglior` and the Integrator `download()` use
`new Blob([…], {type:'application/json'})`. JSON is UTF-8 by spec so this is harmless, but the CSV
pass added `;charset=utf-8;` and JSON didn't — an easy consistency nit. **Fix:** append
`;charset=utf-8;` to the JSON blob type strings. JS-only; re-bundle affected nodes.

## 7. `_hrvTs()` duplicates `_exportTs()` (trivial)
**Where:** `hrvdex-app.js` — `_hrvTs()` is a byte-identical copy of the suite-wide `_exportTs()`
filename stamp. Consolidate to one name when convenient. No functional impact.

---

## 8. Deferred (not a defect — unfinished verification)

### 8a. Gate-enforce the GlucoDex cleaned-CSV round-trip (attempted, reverted)
The cleaned-CSV semantic round-trip is **live-verified** (exported glucose column → mean 102.5 →
GMI 5.8% == source GMI 5.8%) but **not** gate-enforced. An attempt to add a unit test was reverted
because it was brittle against `parseCSV`'s internal cleaning.
**To do it right:**
1. `glucodex-dsp.js` is headless-safe (`global.GLUDSP = { parseCSV, analyze, genSynthetic,
   coreMetrics, hhmm, … }`, no DOM refs). Load it as an **executed** module + expose `GLUDSP` in env
   in BOTH runners: `tests/run-tests.mjs` (add to the optional-load array + `GLUDSP: ctx.GLUDSP` in
   `env`) and `Dex-Test-Suite.html` (add `<script src="glucodex-dsp.js">` after `ppgdex-dsp.js` +
   `GLUDSP: window.GLUDSP` in `env`). Keep both env objects in sync.
2. Write the `dex-tests.js` group to assert on the **cleaned series semantics**, NOT raw cell flags —
   that's what tripped the first attempt. `parseCSV` flags warm-up/gap cells, so don't gate on
   `FLAG.OK` counts. Instead: build the `timestamp(ISO+Z),glucose_mgdl,flag` CSV exactly as
   `exportCleanCSV` emits; `GLUDSP.parseCSV` it; assert (a) `t0Ms` round-trips within one cadence
   (ISO-with-Z → Date.UTC components → same floating tMs), and (b) `coreMetrics`/mean over the
   cleaned series ≈ source mean within tolerance. Verify it green in the **browser** suite; the Node
   side mirrors (cannot be run from the design environment).
**Note:** `run-tests.mjs` can't be executed here — whoever does this must run `node tests/run-tests.mjs`
to confirm the Node half.

### 8b. Multi-night JSON-array re-ingest — never verified
Single-export Integrator ingest is verified (a canonical ECGDex export produced a `confirmed_apnea`).
The **multi-night array** paths were not exercised end-to-end:
- OxyDex multi-night export (bare array <3 nights; `ganglior.crossnight`-wrapped ≥3) → Integrator
  `adaptOxyDex`.
- The `multiNight/multiRecording` wrappers (CPAPDex/PulseDex/PpgDex) with a `crossNight` block.
**To do:** construct a realistic ≥3-night export per node and confirm the Integrator ingests N
recordings + absorbs the crossNight block into the longitudinal store, with no "no events found"
fallback. Best as a live check first, then a gate group if cheap.

---

## Suggested order
1 (correctness + determinism) → 3 (CI reliability) → 2 (contract) → 8a/8b (coverage) → 4/5/6/7
(tidy-up). Items 1–7 are all JS-only (no `buildHash` move). Run BOTH gates after each.

# Dex Suite — Findings & Fix Brief (for AI coder)
*Compiled June 19 2026, during the v1.5 generator re-run pass. Apply AFTER the eligible pilots are
re-run and rewritten — but items §1 and §2 are blockers that gate those very re-runs, so do them first.*

This brief is the result of an audit triggered when the user found a stale figure and several stale
numbers in the papers. The audit surfaced one self-inflicted blocker, one real documentation bug,
several inefficiencies, and a class of generator artifacts now mostly fixed. Read top-to-bottom;
items are ordered by urgency.

---

## §0 — (RESOLVED June 2026) OxyDex ODI-4 severity-proportional under-count — corrected at the detector
The robustness benchmark's one systematic failure (ODI-4 under-counts desaturations in proportion to
OSA severity; severe-stratum mean bias ≈−31 events·h⁻¹ on the 20k v1.6 run, calibration R² *rising*
0.77→0.92 = deterministic) was traced to **trailing-mean baseline self-suppression**: `detectODI`
measured each dip against a trailing 5-min MEAN SpO₂ (`computeBaselineArr`), which the closely-spaced
dips in severe OSA drag down, sinking the `baseline−4%` threshold so later events of equal depth go
uncounted. **Fix (OxyDex v22.36):** new O(n) trailing **p90 ceiling** baseline
(`computeCeilingBaselineArr`, sliding 101-bin SpO₂ histogram, in `oxydex-util.js`) wired into
`detectODI` ONLY (minimal first cut). Brief dips sit in the lower tail → can't suppress a high
percentile → the ceiling tracks resting SpO₂. Validated (v1.6 cohort, N=220 representative re-run):
severe bias −30.6→**−15.7**, gradient flattened, `none` not inflated, ODI↔AHI slope 0.42→0.69; real
SubjectA pilot severe-night ODI-4 7.6→14.9. AHI surrogate ×1.1 **retained** (corrected ODI still
under-represents AHI, slope-to-truth ≈1.4>1 → no over-shoot; not re-fit, per the no-overfit guardrail).
Gates: Dex-Test-Suite 545/34 green (+ ceiling-baseline contract assertion), verify-provenance green
(buildHash `09c77b53517c` unchanged — JS-only change, template untouched), OxyDex.html re-bundled.
Papers updated (odi4-ahi-bias, robustness-benchmark, index). **Follow-ups left open:** (a) optional 2nd
pass migrating the other nadir detectors (`computeDesaturationProfile`, `computeHypoxicLoad`, `SBII`,
…) onto the ceiling baseline for consistency — until then desat-profile counts diverge slightly from
ODI; (b) regenerate the committed OxyDex *export* fixtures' pre-fix ODI/AHI values + the robustness
20k Table 2 / Figure 1 (needs driving the live app on the original inputs / a full 20k cohort-runner
re-run). See `OXYDEX-ODI-CEILING-FIX-BRIEF.md`.

---

## §1 — (RESOLVED June 20 2026) `cgmcouple` / `iccpg` worker kinds
**Both branches now exist in `cohort-worker.js` `doJob`.** `iccpg` = per-night rMSSD (`runPulse`) +
per-calendar-day CGM-CV (`splitCgmByDay`), consumed by `nights-icc-analysis.js`. `cgmcouple` =
per-night rMSSD + per-night NOCTURNAL glucose (`sliceNocturnalCsv` on `[t0,t0+durSec]`), consumed by
`cgm-hrv-coupling-analysis.js` (boots a `cgmcouple` pool, joins `res.pulse` + `res.nocturnal` per night
`n`). No half-converted state remains. Gate green (558). *Historical detail below.*
**Fix — implement the `cgmcouple` branch in `doJob`** (mirror `iccpg`, but slice the NOCTURNAL CGM
window per night, not per calendar day):
- `cgmcouple`: `CohortGen.patient(seed, { only:['rr','gluco'] })`. For each night with RR + the
  patient's CGM CSV: score rMSSD via `runPulse(nt)` (existing helper) → `pulse[]`; AND slice the
  nocturnal CGM window for that night and score it with the real GlucoDex `analyze`, returning
  `nocturnal:[{ n, score:{ mean, cv, nHypo, dawnSurge } }]`. The nocturnal-slice logic currently
  lives in `cgm-hrv-coupling-analysis.js` as `sliceNocturnal(glucoCSV, t0Ms, durSec)` — **move/copy
  it into the worker** (the worker must do the windowing so the main thread stays free). Return
  `{ meta: meta(pat), pulse, nocturnal, timing }`.
- `iccpg`: `only:['rr','gluco']`; per night → rMSSD (`pulse[]`); per **day** → CGM CV split by
  calendar day (GlucoDex per-day), returned as `perDay:[{ day, score:{ cv, mean } }]`. The
  per-day split logic is in `nights-icc-analysis.js` today — move it into the worker.
**Verify:** run `cgm-hrv-coupling-analysis.html` at N=300, confirm Table 1 + Figure populate and the
pooled/within/between correlations are finite and match a serial (harness) spot-check at the same seeds.
**Alternative if time-boxed:** revert `cgm-hrv-coupling-analysis.js` to the iframe-harness path
(git/history) until the worker branches exist. Do NOT ship the half-converted state.

## §2 — DOC BUG (real): ODI-4 accessor inconsistent across papers
Resolved against `oxydex-dsp.js`: `processNight()` returns `night.odi4 = { rate, count }`. **ODI-4
rate = `processNight().odi4.rate`.** The cohort harness re-exposes it as `score.odi`
(`cohort-harness.html` line ~91: `odi: night.odi4.rate`) — that `.odi` is a HARNESS score alias, not
a `processNight` field.
- `papers/treatment-response.html` says `processNight().odi4.rate` — **CORRECT**, keep.
- `papers/nights-icc.html` says `oxydex-dsp.js (ODI-4 = processNight().odi)` — **WRONG**, there is no
  `night.odi`. Fix to `processNight().odi4.rate` (optionally note "harness score alias `score.odi`").
Grep other docs for `processNight().odi` / `.odi4.rate` and make them consistent.

## §3 — STRAY FILE: `treatment-response-analysis copy.html`
A duplicate "copy" file at repo root, **referenced by nothing** (grep clean). Almost certainly
finder-cruft. Delete after a final grep. (Left in place this session — audit only.)

## §4 — INEFFICIENCY: serial single-thread iframe harness in most analysis tools
The cohort analysis tools were built on `cohort-harness.html?node=…` — ONE same-origin iframe,
awaited one item at a time. Same-origin iframes share the main thread → effectively serial → ~6×
slower than the available cores. Converted this session to a real `cohort-worker.js` Web Worker pool
(generation + scoring off-thread, true multicore): **hrv-confound (DONE, lean `pulse` kind, ~31 pt/s
vs ~17 serial) and cgm-coupling (DONE pending §1).** Still serial, to convert with the same pattern:
- `treatment-response-analysis.js` — TWO pools: existing `oxy` kind (ODI-4) + `pulse` kind (rMSSD),
  joined per night. (OxyDex and PulseDex DSP collide on bare globals — `parseCSV`, `mean`, `std` — so
  they MUST be in separate worker realms; that's why it's two pools, not one.)
- `nights-icc-analysis.js` — `oxy` pool + `iccpg` pool (§1), joined per subject.
- `qrs-equiv-analysis.js`, `qrs-yield-analysis.js` — already use a `qrs-*-worker.js` pool for the
  FULL-lane waveform work + one PulseDex harness; lower priority, but the single PulseDex realm can
  become a small `pulse` pool too.
- `cohort-regression.js` — the 5-night gate; serial is fine (tiny N), leave.
Pattern reference: the boot/dispatch/lane code in `hrv-confound-analysis.js` (`bootPool`, `runSeed`,
`lane`) is the template. Worker count `Math.min(8, navigator.hardwareConcurrency||4)`.

## §5 — INEFFICIENCY/UX: live ETA + per-machine calibration only on hrv
`hrv-confound-analysis.js` now shows a live "patient x/N · K× · rate · ETA" status and stores a
per-machine `pt/s` in localStorage (`hrvconf_ptPerSec`) to pre-estimate the next run (so a weaker
machine sees a realistic time before committing). Roll the same `fmtETA` + rate-persist pattern into
every analysis tool's run loop and add an `#eta` echo next to the N input.

## §6 — GENERATOR: the clamp-pileup artifact CLASS (mostly fixed; audit the rest)
**Principle (now proven 5×):** a hard `clamp(value, a, b)` to CONSTANTS in a quantity that later gets
plotted draws a visible pileup LINE on any scatter of that quantity (vertical if it's an x-axis var,
horizontal if y). Fixed in `cohort-gen.js`, versions stamped in `CohortGen.VERSION`:
- v1.1 CPAP residual AHI `min(ahi, clamp(ahi*0.6,0,15))` → pinned **AHI=15** → jittered proportional.
- v1.2 night AHI ceiling `clamp(…,0,90)` → **AHI=90** line → jittered ceiling 80–92.
- v1.3 rMSSD floor/ceiling `clamp(…,9,72)` + baseline `clamp(…,12,62)` → **horizontal bands** →
  jittered bounds.
- v1.4 integer age `Math.round(20+rng*65)` → **vertical age stripes** → continuous fractional age.
- v1.5 apnea→rMSSD suppression made **saturating** (asymptotes to a soft floor) so severe nights
  fade in above the floor instead of all clipping onto it; bounds widened to "breathe".
**TODO for the coder:** audit EVERY other rendered quantity in `cohort-gen.js` and `synth-gen.js`
for the same hard-clamp-to-constant pattern BEFORE any paper plots it — candidates: glucose mean/CV,
SpO₂ nadir/T90, desat depth, HR. Jitter or saturate each bound. Add a one-line comment tagging each
intentional jitter so it isn't "tidied" back to a constant.

## §7 — PROVENANCE/FIXTURES: cohort-gen bumped 1.0→1.5
Per CLAUDE.md the `buildHash` is over each app's `__bundler/template`, and `cohort-gen.js` is in NO
app bundle, so **app buildHashes are unaffected and no app needs re-bundling.** The real-corpus
regression fixtures in `uploads/synthetic/` are REAL device captures (O2Ring / Polar / Lingo) + their
`ground_truth_night*.json`, also independent of cohort-gen — **unaffected.** What IS affected: any
committed export/figure/number that was *derived from cohort-gen output* at the old version (all the
simulation-paper numbers, and the in-repo `papers/figures/*` for sim papers). Those are exactly what
the re-run pass regenerates. After the pass: run `Dex-Test-Suite.html` (must be all-green — it was,
556 passed, after each generator edit) and `verify-provenance.html` (no red).

## §8 — ROBUSTNESS: long analysis runs die on preview navigation
The analysis tools hold the whole run in page memory; navigating the preview/tab (or a preview reset)
**loses a multi-minute/hour run** with no resume. `cohort-runner.html` already solves this with
IndexedDB checkpoint/resume — consider lifting that into the long analysis tools (or at minimum a
`beforeunload` warning + a localStorage checkpoint of accumulated rows every ~1–2 %). Lower priority
than §1–§4 but it cost a full 100k run this session.

## §9 — STATUS of the simulation papers (numbers to refresh on v1.5 @ scale)
| Paper | Tool | State | Action |
|---|---|---|---|
| hrv-age-confound | hrv-confound-analysis | figures v1.5 ✓; **100k/v1.5 run in progress** | finalize numbers when run lands |
| nights-icc | nights-icc-analysis | stale (v1.0 pilot) | convert (§4), run, rewrite |
| treatment-response | treatment-response-analysis | stale | convert (§4), run, rewrite |
| cgm-hrv-coupling | cgm-hrv-coupling-analysis | converted (blocked by §1) | fix §1, run, rewrite |
| robustness-benchmark | cohort-runner | stale | run (already worker-pool), rewrite |
| qrs-yield / rmssd-equivalence | qrs-*-analysis | stale; FULL-lane → 100k infeasible (hours) | run at feasible N, rewrite |
| odi4-ahi-bias | odi-bias-analysis | real arm OK; synth power arm uses gen | re-derive synth arm on v1.5 |
| sigma-no-reference | sigma-no-reference-analysis | REAL data, gen-independent | error/style audit only |
| synthetic-data-frontier | (perspective, no tool) | gen-independent | error/style audit only |
Journal-style rewrite is in flight for hrv-age-confound (structured abstract w/ CI + exact p, formal
Limitations, two separate hi-res figures) — use it as the template for the rest.

---
*Generated by the design agent. Source of truth for current generator behavior is `cohort-gen.js`
(VERSION string lists the fix history). Test gate: `Dex-Test-Suite.html`. Provenance: `verify-provenance.html`.*

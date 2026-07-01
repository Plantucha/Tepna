<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — Ambulatory / Activity-Aware Mode (stop scoring a walk as a sleep)

> **For an AI coder.** Read `CLAUDE.md` first (Clock Contract + the two gates), then this brief, then
> the reference node — **ECGDex** (`ecgdex-dsp.js` / `ecgdex-app.js`), which owns the mode classifier,
> the sleep stager, and the CVHR apnea screen this brief gates. Everything is decided below.
>
> This is a **correctness fix**, not polish. It comes from a live failure on 2026-06-13: an afternoon
> walk was analyzed as an overnight sleep study, and three downstream features confidently produced
> nonsense from it. The data needed to prevent this was already in the recording — it just wasn't
> wired into the mode decision.

---

## What went wrong (the afternoon-walk misfire)

A 2.4 h afternoon walk (12:14→14:41) was ingested by ECGDex and:

1. **Mode classifier called it `🌙 Overnight`** — `modeWhy: "2.4 h from 12:00"` tripped a
   duration-from-noon heuristic.
2. **Sleep staging then ran on a walk** — it published a hypnogram (~125 min "sleep", 15 REM,
   20 Deep) for someone who was walking.
3. **The CVHR apnea screen published `AHI 7 · Mild`** — exercise heart-rate dynamics read as
   cardiogenic oscillations.

All three are categorically wrong for ambulatory data. **The tell was already in the export:**
- `sleepStageConsensus` shows the **ACC channel voting "Wake (motion)"** against every HRV-derived
  stage.
- gait logged **6,091 steps, 27% brisk-walk**.

The motion channel *knew* it was a walk. The mode classifier just never asked it.

---

## Root cause (one sentence)

The mode decision is driven by **time-of-day + duration heuristics alone**; it does not consult the
**activity/gait/ACC evidence that the node already computes**, so high-motion daytime recordings fall
through to "overnight" and unlock sleep-only analyses that have no business running.

This is the same class of bug as the oximeter self-gate: *the node had the disconfirming signal in
hand and didn't use it.*

---

## The fix — activity-gated mode (decided)

### 1. Add an activity veto to the mode classifier
Compute an **activity score** from signals ECGDex already has (gait steps/min, brisk-walk %, ACC
motion fraction, the `sleepStageConsensus` ACC "Wake (motion)" vote rate). Then:

- If sustained activity is high (e.g. gait cadence present for a meaningful fraction of the record,
  or ACC-wake dominating), the recording is **`ambulatory` / `awake-active`** — the duration/time-of-
  day heuristic **cannot override this to overnight.** Activity wins.
- Keep the existing overnight/nap/short-reading classes for the low-activity cases. Only ADD the
  veto path; don't rewrite the existing thresholds.
- Record the decision transparently in `modeWhy` (e.g. `"ambulatory: gait 6091 steps, 27% brisk;
  ACC-wake 88% — overnight veto"`), the same way the current classifier explains itself.

### 2. Gate the sleep-only analyses on mode (decision: **suppress-with-reason**, not delete)
When mode is `ambulatory`/`awake-active`:
- **Sleep staging:** do not publish a hypnogram. Keep the field present but emit
  `{ suppressed:true, suppressedReason:"high-activity / ambulatory", stages:null }` rather than
  removing keys — so existing consumers (the Integrator, the UI, the test suite) never hit a missing
  field. (Back-compat per `CLAUDE.md`: new data via a new field; don't drop the old shape.)
- **CVHR apnea screen:** same — do not publish an AHI. Emit `{ reportable:false,
  suppressedReason:"ambulatory — CVHR invalid under exercise", cvhrIndex:null, estimatedAHI:null }`.
  This mirrors the existing R5 null-model pattern (an index is *withheld with a reason*, never
  fabricated).
- Anything genuinely valid for a walk (HR, HRV-under-activity caveated, gait) still computes.

### 3. Integrator side (small, additive)
The Integrator already has the activity-veto lesson half-learned (the walk's `nodesExcluded` logic).
Make sure that when a node reports `mode:"ambulatory"`, the Integrator:
- does **not** fold its (now-suppressed) sleep/apnea fields into any confirmed finding, and
- treats a suppressed-with-reason field as "absent", not as a zero. No change to the R4
  `LEAD=15/TRAIL=60` window.

---

## What NOT to do
- **Do not** silently drop the hypnogram/AHI fields (breaks consumers — suppress-with-reason instead).
- **Do not** retune the overnight duration thresholds to "fix" this — the duration heuristic isn't
  wrong, it's just not authoritative when activity contradicts it. Add the veto; leave the thresholds.
- **Do not** extract a shared mode util across nodes in passing (same discipline as `parseTimestamp`).

---

## Synthetic fixture to add (`SYNTHETIC-CORPUS-BRIEF.md` / `synth-gen.js`)
A **daytime ambulatory recording** coherent with the other nodes — the gap the corpus currently
lacks (it is overnight-biased, which is why four misfires shipped at once):
- ~2.4 h, starts ~12:00, gait cadence ~110 steps/min for sustained stretches, 27% brisk-walk,
  ACC mostly "Wake (motion)", exercise HR dynamics (a sustained climb to 90–100 bpm).
- **Expected results (the assertions):** mode = `ambulatory` (NOT overnight); hypnogram suppressed
  with reason; CVHR/AHI suppressed with reason; HR/gait still present. These guard all three misfires
  at once.

## Tests to add (`tests/dex-tests.js` — shared by Node CI + the browser suite)
1. `mode-veto`: ambulatory fixture ⇒ `mode!=='overnight'` and `modeWhy` cites activity.
2. `staging-suppressed`: ambulatory ⇒ sleep staging `suppressed:true`, `stages:null`, reason present.
3. `ahi-suppressed`: ambulatory ⇒ CVHR/AHI `reportable:false`, `estimatedAHI:null`, reason present.
4. `overnight-unaffected`: a normal overnight fixture still stages + screens as before (no regression).
5. `integrator-absent-not-zero`: Integrator treats a suppressed sleep/apnea field as absent, not 0.

## Gates (per `CLAUDE.md`)
- `Dex-Test-Suite.html` all-green after the ECGDex change AND after re-bundling ECGDex.html.
- `verify-provenance.html` no red: editing `ecgdex-*.js` is JS-only (no buildHash shift); editing
  `ECGDex.src.html` (if the mode badge surfaces in UI) shifts ECGDex's buildHash — expected, just
  confirm no committed fixture flips to an unexpected mismatch and regenerate any ECGDex export that
  legitimately needs it (drive the real bundle; never hand-edit a hash).

## Relationship to the other briefs
- Pairs naturally with `OXIMETER-SELFGATE-AND-CONSEQUENCE-COROBORATION.md` — both are "the node had
  the disconfirming signal and must use it," both add a daytime/failure fixture to the corpus.
- The suppress-with-reason pattern here is the SAME honesty principle CPAPDex's brief (§4) and
  `ARCHITECTURE-PRINCIPLES.md` (§4) require: a missing/invalid value is visible (null + reason),
  never fabricated.

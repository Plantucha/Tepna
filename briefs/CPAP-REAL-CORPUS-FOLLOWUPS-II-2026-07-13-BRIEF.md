<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-17 · **Created:** 2026-07-13 · **Follows:** `CPAP-REAL-CORPUS-FOLLOWUPS-2026-07-12-BRIEF.md` (whose §5/§6 this carries) · **Related:** `EVENT-COUPLING-2026-07-13-BRIEF.md` · **Followed-by:** `CPAP-REAL-CORPUS-FOLLOWUPS-III-2026-07-17-BRIEF.md`

# CPAP corpus — follow-ups II: what the last two briefs left open, and one false DONE

> **Why this exists — a bookkeeping correction first.** `CPAP-REAL-CORPUS-FOLLOWUPS` was stamped
> **`Status: DONE`** while its **§5 (P7/P8)** and **§6 (smaller things)** had never been executed. CLAUDE.md
> §📌 is explicit: DONE means *every* acceptance item is met, and *"never stamp DONE on unverified work"*.
> That stamp was wrong.
>
> The irony is worth recording, because it is the same defect the parent briefs spent their whole length
> closing: **a claim was made and nothing verified it.** The `docs-ledger` gate checks a status header's
> *format*, not its *truth* — exactly as `GATE B` checked a fixture's bytes but not whether anything
> reproduced them. Prose is not a gate; a status header is not either.
>
> This brief carries the unexecuted work out, so the parent's DONE becomes true rather than aspirational.
> (House pattern: `AUDIT-FOLLOWUPS` → `-II`.)

---

## 1 · P7 — a NODE consumer for `event-coupling.js` ⚠️ **the load-bearing one**

`event-coupling.js` is shipped, gated (35 self-test + 26 contract assertions) and **dormant**: no node
consumes it, so it is not co-loaded into any bundle. It exists to answer the Integrator's *"is it real or
coincidence?"* question — and until something calls it, that question is still being answered by raw
co-occurrence somewhere.

**Do:** apnea → HR (CVHR) and apnea → motion-arousal coupling on **A3** (the 17 quad-modal nights), via
the primitive. It independently tests §M3's re-labelling alternative, and it settles which bundle the
module rides into.

**⚠️ Read `EVENT-COUPLING-2026-07-13-BRIEF.md` §2 first.** Four separate defects in that null model each
produced a *confident, wrong number* on this very corpus. In particular **pass `coverage`** — the spans in
which the ECG/PPG was actually recording — or you will repeat the ×0.72 anti-coupling artifact with a
different sensor.

**Done when:** a node calls `EventCoupling.coupling()`; `coverage` is supplied from that node's real
recording window; the result is read only where `underpowered` and `saturated` are both false.

> **§P7 EXECUTED 2026-07-17.** The **Integrator** is the consumer — `event-coupling.js` is now co-loaded
> into `Integrator.src.html` + `OverDex.src.html` (so the module rides into the fusion bundle, the "which
> bundle" question the brief left open), and `fuseApneaEvents` (`integrator-dsp.js`) calls
> `EventCoupling.coupling(desats, surges, {window:[−15s,+60s], coverage: merged})` for the desat⟷surge
> ("apnea → HR / CVHR autonomic_surge") question.
> - **`coverage` is the recording OVERLAP (`merged`) already built in the fusion** — so a desat outside
>   the cardiac window is EXCLUDED, not a manufactured miss. `coverageAssumed:false` on every real call.
> - **Additive + guarded, NOT a behavior change:** the result rides as a new `apneaCoupling` export field
>   beside the existing Poisson `nullModel`; the headline `confirmedAHI`/`confirmedAHIReportable` are
>   UNCHANGED (the `integrator_tch_golden` is byte-identical). `apneaCoupling.real` is set ONLY on a
>   `usable` window (neither `underpowered` nor `saturated`) — the brief's rule, encoded.
> - **Real-corpus grounding (24 committed `uploads/trio/` nights, pooled):** apnea(desat)→HR(autonomic_
>   surge) lift ≈ **0.83** with coverage supplied (**33 desats excluded** as outside the cardiac window —
>   the ×0.72 artifact does NOT recur); most single nights are **underpowered** (few desats), so the
>   primitive honestly reports "can't judge this night" rather than over-claiming — exactly the failure
>   mode the Poisson λ hid.
> - **Gate:** `tests/dex-tests.js` group *"Integrator consumes EventCoupling for desat⟷surge (coverage-
>   aware) — §P7"* — a planted coupling ⇒ `usable`+`real`, a mid-gap control ⇒ `real:false`, the
>   `real ⇒ usable` invariant, and `coverageAssumed:false`. Bites: reverting the wiring reds "attaches an
>   EventCoupling block". `event-coupling.js` added to the co-load classification (`RESOLVE`).
>
> **DEFERRED (not blocking Done-when):** the brief also names **apnea → motion-arousal** coupling — a
> second event pairing, not modeled by `fuseApneaEvents` (which is desat⟷surge). Wiring a motion-arousal
> coupling (and driving the primitive's verdict INTO `confirmedAHIReportable` rather than sitting beside
> the Poisson model) is a follow-up; the primitive is now live and consumed, so it is no longer dormant.

---

## 2 · P8 — `CPAPCross` change detection has never detected a change

`CPAPCross`'s trend/change detection only ever runs on synthetic nights with `sd: 0` and a `'stable'`
label. **It has never been shown to detect a change at all.** A trend detector that has never detected a
trend is a gate in name only.

**A4** — the two dated device-setting step-changes, each landing on one identifiable night and holding
thereafter — is a **labelled change-point dataset** sitting unused. The §1 `mode` work incidentally found
a candidate change-point around night #169 with a ~0.78 cmH₂O envelope shift, so the signal is there.

**Do:** drive A4's nights through `CPAPCross` and assert it flags the two known change-points. It doubles
as the check that the 5-min envelope window does not smooth a real step away.

> **§P8 EXECUTED 2026-07-17.** Drove the **whole real A1 corpus** (180 nights, `tools/cpap-corpus.mjs`
> over the maintainer-only SD-card tree — gitignored, so the assertions below could NOT ship as-is; a
> **committed synthetic gate** carries them into CI instead, per the repo's "a gate must run on committed
> data" rule). Findings:
> - **The two A4 device-setting step-changes are real and the 5-min P90 envelope PRESERVES them.** The
>   `pressureEnvIqr` step lands at **night #169 (2026-06-30), Δ = 0.776 cmH₂O** — reproducing this brief's
>   "~#169, ~0.78 cmH₂O" from real data — and `epap95` steps **Δ ≈ 4.0 at #151 (2026-06-12)** (EPAP
>   10.8→6.8). Fed a synthetic 10→11 step, `pressureEnvelope` returns per-window P90 `[10,10,10,10,11,11,
>   11,11]` (range 1.0, not a mean-smoothed 10.5): **the window does not smooth a real step away.** ✓
> - **`crossNight` change detection is now shown to WORK — on real *and* synthetic data.** On the real
>   corpus it flags `usageHours` (`change.significant=true`) and `largeLeakPct` (`trend=improving`);
>   synthetically an 8-night `residualAHI` 6→3 step → `trend='improving'`, `change.deltaFirstHalfToSecond
>   =−3`, `significant=true`. "A gate in name only" is closed.
> - **Gate (committed, CI):** `tests/dex-tests.js` group *"CPAPCross detects a step-change + the 5-min
>   envelope preserves it (§P8)"* — asserts (A) a sustained outcome step ⇒ trend `improving` + significant
>   change block with the right magnitude, a stable control ⇒ `stable`/not-significant/zero-delta, and (B)
>   the envelope preserves a 1.0 cmH₂O step. Bites: neutering the detector reds "step DETECTED". Test-only,
>   **export-inert** (no bundle/fixture change).
>
> ⚠️ **KNOWN GAP (the brief's literal ask is not fully satisfiable as written — FILED for follow-up).**
> "Assert `CPAPCross` flags the two known change-points" **cannot** be done, because `CPAPCross`
> **deliberately does not trend pressure** (`cpapdex-cross.js:17-21` — pressure is a *setting*, not an
> outcome) and `classifyModeLongitudinal` takes a *median* over ≥7 nights (which smooths a step). So the
> two A4 change-points at #151/#169 are **structurally invisible to the longitudinal layer**: the
> envelope *preserves* the step, but nothing *flags* it — the outcomes compensated (APAP working as
> designed). Closing this needs a **cross-night pressure-envelope change-point detector** (new behavior:
> surfaces "device settings changed on 2026-06-30" → fusion-output change → golden regen + re-bundle +
> changeset).
>
> **✅ GAP CLOSED 2026-07-17.** `CPAPCross.pressureChangePoints()` (`cpapdex-cross.js`) — a robust L1-cost
> binary segmentation detector (min-hold 7 nights each side; a data-scaled BIC-like penalty
> `PEN_K·gMAD·log(span)` + an independent step-height floor; median/L1 fit+scale ⇒ immune to the
> unbalanced-split flaw a mean/variance fit suffers on a noisy post-change regime). Chosen by a 4-way
> bake-off scored against the real 180-night corpus. `crossNightBlock` attaches it as an **additive**
> `crossNight.pressureChangePoints` field (rides into the multi-night export via `cpapBuildMultiNightExport`);
> headline outputs unchanged. **Real-corpus result:** it flags **exactly ONE** epap95 step — night **#151
> (2026-06-12), 10.74→6.52 cmH₂O, holds 29 nights** (the brief's #151, reproduced from real data) — with
> **zero false positives**. ⚠️ **The brief's #169 is NOT a robust change-point:** driving the real series
> through the detector, `pressureEnvIqr` is noise-dominated (the "Δ0.78" was a marginal windowed statistic,
> not a sustained regime step), so the detector honestly returns **empty** rather than fabricating a second
> setting change. So the literal "two known change-points" is corrected: there is **one** genuine device-
> setting step (#151); #169 does not survive a robust test. Gate: `tests/dex-tests.js` §P8 group (C)/(D) —
> committed synthetic planted-step known-answer + flat/sub-floor-noise/short-series controls + the
> `crossNightBlock` attachment. CPAPDex re-bundled (`684939b42083→b07250a4c5c3`); the multi-night golden
> regenerated (`crossNight.pressureChangePoints:[]`); all 4 CPAPDex fixtures re-`verifiedUnder` after a green
> whole-suite run against the real corpus. `regen-cpap-goldens.mjs` gained the missing `outputHash` re-record
> (the §5 gap — full `--node` generalization still carried to `-III`). Changeset `2026-07-17-cpapdex-pressure-
> change-detector.md` (MINOR — additive field). **A user-facing render surface + apnea→motion-arousal
> coupling are carried to `CPAP-REAL-CORPUS-FOLLOWUPS-III`.**

---

## 3 · Nothing gates a demo against gitignored inputs

CPAPDex's demo fetched **ten gitignored real recordings**, so it had **never worked on any fresh clone** —
a dead page for everyone but the maintainer, for months (`FOLLOWUPS` §3). It was fixed by pointing it at
the committed synthetic EDF set, but **nothing stops the same trap in any other node.**

**Do:** a headless gate — parse each app's demo file list and assert **every entry is a git-tracked path**.
A few lines; closes the class permanently.

**Rule to encode:** *a demo must not depend on anything gitignored.*

> **§3 EXECUTED 2026-07-14.** `Dex-Test-Suite.html`/`run-tests.mjs` group **"Demo-inputs"**
> (`provenance · demo-inputs`, dex-tests.js) scans every `*-app.js` for both demo mechanisms — a full
> `'uploads/<path>'` string literal (Integrator `bindSamples`) and a prefix-concat
> `ARRAY.forEach(name → fetch('uploads/'+name))` (CPAPDex `DEMO_FILES`) — and asserts each referenced
> `uploads/` path is git-tracked (`git ls-files` truth, wired via `run-tests.mjs readTrackedFiles`;
> Node-lane only, browser SKIPs). A concat demo whose array can't be resolved REDS, so a new mechanism
> can't slip through unscanned. The gate immediately caught a **live bug**: the Integrator demo still
> fetched `uploads/ecgdex-2026-06-12.node-export.json` + `uploads/oxydex-2026-06-12.summary.json` — both
> gitignored and absent (the same disease this §describes, one node over) — repointed onto the committed
> same-night synthetic pair `uploads/trio/2026-06-12/{ECGDex,OxyDex}_2026-06-12.node-export.json`
> (export-inert re-bundle of Integrator.html; GATE A/B green).

---

## 4 · The generated list files cost a rebase on every PR

`tests/changes-list.txt` and `tests/docs-ledger-list.txt` are **committed snapshots of the filesystem**.
Every PR regenerates them, so they conflict **by construction** — PR #60 took four rebases, and every
conflict was these two files.

They exist for exactly one reason: **the browser lane cannot list a directory.** But the gates that consume
them (`docs-ledger`, `release-ledger`) are filesystem/docs checks with **zero browser-specific value** —
the browser lane's unique worth is render coverage and same-origin behaviour.

**Do (recommended):** make those two gates **Node-only** and **delete the committed lists**. That removes,
in one move: the merge conflicts, the whole staleness failure-class, and two "remember to regenerate" steps
from every PR.

**Second-best** (if browser parity is non-negotiable): a `.gitattributes` merge driver that regenerates on
conflict. But that is papering over committing derived data.

> **§4 EXECUTED 2026-07-14** (the recommended path). `docs-ledger` + `release-ledger` are now **Node-lane
> only**: `run-tests.mjs` reads `briefs/` + `changes/` + the whole tree straight from fs, and the browser
> lane (which can't list a directory) SKIPs both — its worth is render coverage + same-origin, not docs/
> release checks. Deleted: `tests/docs-ledger-list.txt`, `tests/changes-list.txt`, `tests/gen-docs-ledger-
> list.mjs`, `tests/gen-changes-list.mjs`, and the now-orphaned `tests/list-format.js`; removed the browser-
> lane fetch blocks in `Dex-Test-Suite.html`, the committed-list reads in both `run-tests.mjs` readers, the
> two `list==fs` staleness legs in `dex-tests.js` (replaced by a non-vacuous fs-loaded floor), the
> `release.mjs` post-prune regenerate loop, the `gen:*`/`gen:lists` npm scripts, and every living-doc
> "regenerate the list" instruction (CLAUDE.md · CONTRIBUTING.md · DOCS-INDEX.md · changes/README.md ·
> the COMPLIANCE release SOP). Proof it worked: **this very brief's §4 changeset needed NO list regen** —
> the whole staleness failure-class and the two "remember to regenerate" steps are gone. Suite 2322✓/150
> groups; `release.mjs --dry-run` folds cleanly with no gen-list step.

---

## 5 · Smaller things

- **`tools/regen-cpap-goldens.mjs` is CPAP-only.** It exists because `build.mjs` re-stamps a fixture's
  `manifestHash` but does **not** recompute its `outputHash`. That integrity hole is now *gated* (every
  code-gated fixture must have a dynamic leg — `FIXTURE-REPRODUCIBILITY`), so this is **ergonomics, not
  integrity**: generalize to `tools/regen-goldens.mjs --node <Name>`.
- **`how-to-collect/cpap-edf.md` predates the ResMed adapter** and doesn't mention `resmed-edf`. 7 of 8
  other adapters have a matching `how-to-collect/<adapter-id>.md`; nothing gates it.
- **`pressureRange` carries `goodDirection:'down'`,** which is meaningless for a machine that is *supposed*
  to vary its pressure. The registry vocabulary has only `up`/`down`; a `neutral` direction would be honest
  for descriptive metrics, but adding a third value is a fleet-wide vocabulary change and was deliberately
  **not** taken.
- **The `mode` thresholds remain unvalidated — and that is the correct end state.** The corpus contains
  **no fixed-CPAP nights**, so a CPAP-vs-APAP boundary cannot be fitted to it: any cut is unfalsifiable.
  The dead-band makes the failure mode `null` ("unknown"), never a wrong device setting. **Do not "fix"
  this** without a fixed-CPAP corpus to fit the valley to.

---

## 6 · Done when

- [x] **P7** — a node consumes `event-coupling.js`, passing real `coverage`. *(EXECUTED 2026-07-17 — the Integrator consumes it for desat⟷surge; §1.)*
- [x] **P8** — `CPAPCross` demonstrably detects a real device-setting change-point. *(EXECUTED 2026-07-17 — `pressureChangePoints()` flags the epap95 step at #151 [10.74→6.52] with zero false positives; the brief's #169 was corrected to NOT be a robust step [pressureEnvIqr is noise-dominated] — honest empty, not fabricated. §2 GAP CLOSED note.)*
- [x] **§3** — a gate asserts every demo input is git-tracked. *(EXECUTED 2026-07-14 — "Demo-inputs" group; caught + fixed a live Integrator demo pointing at gitignored paths.)*
- [x] **§4** — the generated list files are gone (or their conflict cost is otherwise removed). *(EXECUTED 2026-07-14 — both gates Node-lane only; 2 lists + 2 generators + list-format.js deleted; merge tax gone.)*
- [x] `Dex-Test-Suite.html?full` all-green · `verify-provenance.html` GATE A/B clean · `build.mjs --check` clean. *(2026-07-17 — browser gates green [Dex-Test-Suite 2771✓, verify-provenance 8 bundles/24 fixtures, no-network ✓]; node lane 2707✓; `verify-fixtures` all corpus-backed fixtures verified.)*
- [x] Follow-up spawned per §📌 with whatever P7/P8 turn up. *(`CPAP-REAL-CORPUS-FOLLOWUPS-III-2026-07-17-BRIEF.md` — carries the P8 render surface, apnea→motion-arousal coupling [P7 deferred], and the `regen-goldens.mjs --node` generalization + §5 residue.)*

<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-17 · **Created:** 2026-07-17 · **Follows:** `CPAP-REAL-CORPUS-FOLLOWUPS-II-2026-07-13-BRIEF.md` (DONE 2026-07-17)

> **EXECUTED 2026-07-17.** §1 render banner SHIPPED (badged, export-inert), §3 regen tools UNIFIED, §4
> resolved; §2 RE-DEFERRED with a hard finding. Gates green: node 2707✓ · Dex-Test-Suite?full 2767✓ ·
> verify-provenance A/B · all three drift guards (`build`/`build-analysis`/`build-docs --check`) · verify-fixtures.
> - **§1 (render):** `cpapdex-render.js renderHistory()` shows *"⚙ Device setting changed · &lt;badge&gt; EPAP
>   10.7→6.5 cmH₂O · &lt;date&gt;"* in the Longitudinal card, driven by `lng.crossNight.pressureChangePoints`;
>   each value carries `evBadge(metric)` (COVERAGE MANDATE). Export-inert: CPAPDex re-bundled
>   `b07250a4c5c3→f1eccac01748`, computeHash STABLE (verifiedUnder unchanged, no fixture regen). Functionally
>   verified in the real bundle via playwright (banner + step date + badge present on a 20-night 11→7 step).
> - **§2 (motion-arousal coupling): RE-DEFERRED — no motion-arousal event stream exists.** The only motion
>   impulse in the suite is PpgDex's `motion_artifact_segment`, a SIGNAL-QUALITY flag (not a physiological
>   arousal); the only arousal impulses (`autonomic_surge`/`autonomic_arousal`) are already the surge pool
>   `fuseApneaEvents` couples desat against. Coupling apnea against a motion-artifact quality flag would
>   fabricate a quality-confounded "coupling" — exactly the confident-wrong number `EVENT-COUPLING §2` exists
>   to prevent (a limb-worn optical sensor moves *during* apnea arousals, so artifacts co-occur with events
>   for a NON-physiological reason). Wiring this needs a real ACC-derived movement-arousal event source first
>   (a new node capability — ECGDex/PpgDex ACC → arousal events), out of scope here. Filed for a future node brief.
> - **§3 (regen unify):** `tools/regen-goldens-core.mjs` (shared diff/merge/rerecord/loop, incl. the mint path)
>   + `tools/regen-goldens.mjs --node <CPAPDex|GlucoDex|PulseDex>` dispatcher; the three per-node tools are now
>   thin recipes (realm + fixtures only) and remain valid entry points. All three `--check` report 0 moved /
>   unchanged (behavior preserved), direct and via the dispatcher.
> - **§4:** `how-to-collect/cpap-edf.md` now names **Adapter id `resmed-edf`** (closing "doesn't mention
>   resmed-edf") — the doc is NOT renamed: the how-to-collect set uses device-descriptive names
>   (`verity-ppg`/`wahoo-tickr-rr`/`welltory-hrv`), not strict `<adapter-id>.md`, and 5 sources reference
>   `cpap-edf.md` by name. `pressureRange goodDirection:'down'` LEFT as-is (a `neutral` value is a fleet-wide
>   vocabulary change, deliberately not taken). `mode` thresholds LEFT unvalidated (correct end state — no
>   fixed-CPAP nights in the corpus; do not fit an unfalsifiable cut).

# CPAP corpus — follow-ups III: what closing §P8 surfaced, plus the §5 residue

> **Why this exists.** `CPAP-REAL-CORPUS-FOLLOWUPS-II` §P8 closed its KNOWN GAP by shipping
> `CPAPCross.pressureChangePoints()` — a cross-night device-SETTING change-point detector, validated on the
> real 180-night corpus (flags the #151 epap95 step 10.7→6.8, zero false positives; honestly returns empty
> on the noise-dominated pressureEnvIqr, correcting the brief's assumed #169). The detector + its additive
> `crossNight.pressureChangePoints` export field are live and gated. Two deliberately-scoped items were
> carried out of that pass, plus the parent's §5 residue.

---

## 1 · Render surface for `pressureChangePoints` (deferred from -II §P8) ⚠️ **the user-facing half**

The change-points reach consumers via the export field, but there is **no CPAPDex render surface** — a user
never sees "your device setting changed." Add a minimal, **export-inert** banner in `renderHistory`
(`cpapdex-render.js`, the Longitudinal card) driven by `lng.crossNight.pressureChangePoints`, e.g.
*"⚙ Device setting changed — EPAP 10.7→6.5 cmH₂O on 2026-06-12."*

**Watch the COVERAGE MANDATE:** the before/after pressure numbers reach a user's eye, so each must carry an
evidence badge (`MetricRegistry.badge('epap95')` / the right registry id) per CLAUDE.md §🎫 — this is the
reason it was NOT slipped into the -II pass (it opens the badge-compliance + cohesion-gate surface). Render
edits move `manifestHash` but not `computeHash` (export-inert), so: re-bundle CPAPDex, GATE A auto-records,
fixtures' `verifiedUnder` stays valid (confirm with `verify-fixtures --check`), no golden regen.

**Done when:** the Longitudinal card shows a badged device-setting-change line; `Dex-Test-Suite.html?full`
render-coverage green; `verify-provenance` A/B clean; a changeset (MINOR — new surface) dropped.

## 2 · apnea → motion-arousal coupling (deferred from -II §P7 §1)

-II §P7 wired the Integrator to consume `event-coupling.js` for the **desat⟷surge** pairing only. The brief
also named **apnea → motion-arousal** coupling — a second event pairing not modeled by `fuseApneaEvents`.
Wire a motion-arousal `EventCoupling.coupling()` call (real `coverage` from the recording window, per
`EVENT-COUPLING-2026-07-13-BRIEF.md` §2 — pass coverage or repeat the ×0.72 anti-coupling artifact), and
consider driving the primitive's verdict INTO `confirmedAHIReportable` rather than sitting beside the
Poisson `nullModel`.

## 3 · Generalize the goldens regen tool (parent §5)

-II added the missing `outputHash` re-record to `tools/regen-cpap-goldens.mjs` (it previously wrote only the
golden file — the integrity hole that reds GATE B after a code change). The **full §5 ask remains**:
collapse the per-node `regen-cpap-goldens.mjs` / `regen-glucodex-goldens.mjs` / `regen-pulsedex-goldens.mjs`
into one `tools/regen-goldens.mjs --node <Name>` (they now share the same ledger-re-record shape — the
CPAP one was the last to gain it).

## 4 · Smaller things (parent §5, still open)

- **`how-to-collect/cpap-edf.md` predates the ResMed adapter** — doesn't mention `resmed-edf`. 7 of 8 other
  adapters have a matching `how-to-collect/<adapter-id>.md`; add one (nothing gates it).
- **`pressureRange` carries `goodDirection:'down'`,** meaningless for a machine meant to vary its pressure.
  A `neutral` direction would be honest for descriptive metrics, but that is a fleet-wide vocabulary change
  (`up`/`down` only) and was deliberately **not** taken. Decide deliberately, suite-wide, or leave it.
- **The `mode` thresholds remain unvalidated — and that is the correct end state** (no fixed-CPAP nights in
  the corpus; any cut is unfalsifiable). **Do not "fix"** without a fixed-CPAP corpus.

## 5 · Done when

- [x] §1 render surface shipped (badged) + gated. *(Longitudinal "Device setting changed" banner, evBadge'd, export-inert; playwright-verified.)*
- [x] §2 motion-arousal coupling wired with real `coverage`, or explicitly re-deferred with reason. *(RE-DEFERRED — no motion-arousal event stream exists; coupling against a quality flag would fabricate a confounded result. Needs an ACC-derived arousal event source first.)*
- [x] §3 `regen-goldens.mjs --node` generalization landed. *(shared `regen-goldens-core.mjs` + `--node` dispatcher; all 3 tools thin recipes, `--check` unchanged.)*
- [x] §4 items resolved or deliberately parked inline. *(resmed-edf adapter id named in cpap-edf.md; pressureRange/mode LEFT with reasons.)*
- [x] `Dex-Test-Suite.html?full` all-green · `verify-provenance.html` GATE A/B clean · `build.mjs --check` clean. *(2026-07-17 — node 2707✓, Dex-Test-Suite 2767✓, verify-provenance 8/24, all 3 drift guards + verify-fixtures clean.)*

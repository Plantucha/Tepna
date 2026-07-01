<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Brief — Follow-ups from the In-App Patient-Generator Rollout (June 2026)

> **For the next thread / an AI coder.** Read `CLAUDE.md` first (esp. THE CLOCK CONTRACT, the
> provenance gate, and the re-bundle rules). This brief captures what was built in the generator
> rollout and the **real issues found during it** — in priority order. Nothing here is urgent enough
> to block shipping, but #1 is a genuine integrity gap in the provenance gate and should be
> understood before anyone trusts `verify-provenance` as a code-provenance check.

---

## 0. What already shipped (context — do not redo)

Every single-signal app plus the Integrator now has an in-app **"Generate synthetic"** control,
all backed by one shared, patient-coherent engine:

| File | Role |
|---|---|
| `dex-patient-gen.js` (NEW) | Shared helper. `DexPatientGen.buildNights(profile, nDays)` → N consecutive nights for ONE patient via `SYNTH.masterTimeline` (gluc `flat`, night index ≥100 to skip the frozen-arc CSR/hypo/dawn specials). A slow shared **severity random-walk** ties each night's signals together (worse night → higher AHI/ODI **and** lower HRV), so multi-day records show realistic coupling. Profiles: `baseline` (untreated OSA) · `severe` · `cpap` · `healthy`. Injects the `.synth-line` CSS (mirrors the `metric-registry` pattern). Also exposes `resolve`, `fromControls`, `chip`. |
| OxyDex / PulseDex / PpgDex / HRVDex | Each `*.src.html` got a `.synth-line` control (**profile** select + **days** select 1/3/7/14) + `synth-gen.js` + `dex-patient-gen.js` includes; each `*-app.js` got a `genSyntheticPatient()` that renders N nights of ITS modality and feeds them through the **real multi-day ingest** (OxyDex `handleFiles`, PulseDex `loadRawFiles`, PpgDex `loadFiles`, HRVDex `pasteArea`+`loadPasted`). |
| Integrator | `Integrator.src.html` load view got the same control (**days 7/30/90/180**, default 90). `integrator-app.js` `genSynthetic()` builds N nights, emits **OxyDex** (ODI-4, Min SpO₂) + **ECGDex** (rMSSD, SDNN) `ganglior.crossnight` envelopes wrapped as node-exports, plus a fusable last night (OxyDex `spo2_desaturation` ⟷ ECGDex `autonomic_surge` ~5 s later), and calls `ingestJSON`. 90 days → longitudinal store fills, the **ODI-4 ⟷ rMSSD coupling reads r ≈ −0.84**, and a `confirmed_apnea_event` fusion finding appears. |

Both gates were green at hand-off: `Dex-Test-Suite` ✓ all green (622 passed), `verify-provenance`
0 mismatches. **GlucoDex and ECGDex still use their OWN older generators** (see #2).

---

## 1. ⚠️ P1 — `buildHash` never hashes the template at runtime; the provenance gate is far weaker than documented

**Symptom / evidence.** Across this rollout I edited **five** `*.src.html` files (added `.synth-line`
markup + two `<script src>` includes each) and several `*-app.js` files, re-bundled all five, and
**every app's `buildHash` stayed byte-identical** (e.g. OxyDex `10060a2b3aaa` before and after).
`verify-provenance` reported 0 mismatches throughout.

`CLAUDE.md`'s provenance section says *"a `.src.html` change (or an inliner-template change, or a
brand-new app) gives a new hash → any fixture stamped with the old hash flips to a mismatch."*
**That did not happen and, as currently built, cannot happen for most edits.**

**Root cause (confirmed).** `ganglior-provenance.js` → `buildSource()`:

```js
var tpl = document.querySelector('script[type="__bundler/template"]');
if (tpl && tpl.textContent) return tpl.textContent;   // ← intended source
// fallback: concat inline <script>(no src) + <style> text, else outerHTML
```

In a **bundled** app at runtime, `document.querySelector('script[type="__bundler/template"]')`
returns **`null`** — I verified this live (`hasTpl: false`). The `__bundler/template` script *is*
present in the `.html` file on disk (you can grep it), but the inliner's bootstrap **removes/replaces
it from the live DOM during unpack**, so by the time `buildHash()` runs the element is gone. Every
bundle therefore hashes the **fallback** — and since the app code is eval'd (not injected as inline
`<script>` elements), the fallback is essentially just the tiny bundler bootstrap + whatever `<style>`
is in the DOM at that instant. Result: `buildHash` fingerprints the **bootstrap**, not the app —
it will not move for `.src.html` markup changes, app-JS changes, or shared-module changes.

`CLAUDE.md` already notes the weaker half of this ("will NOT detect external-`*.js` drift; regenerate
fixtures whenever you change a node's code"), but the **stronger claim that a `.src.html`/template
change moves the hash is false in practice**, which makes the gate's headline promise ("an export the
current code can no longer reproduce") misleading.

**What to do (pick one, deliberately):**
1. **Fix the source so it actually fingerprints the build.** Have the inliner keep the
   `__bundler/template` script in the DOM (or stash the template string on a global the bootstrap
   sets, e.g. `window.__BUNDLER_TEMPLATE`), and point `buildSource()` at that. Then re-stamp/regen all
   `uploads/*` provenance fixtures (they will legitimately move once). After this, the documented
   behavior becomes true and the gate has teeth.
2. **Or accept it and fix the docs.** If the team is fine with `buildHash` being a coarse
   skeleton fingerprint, update `CLAUDE.md` to stop claiming a `.src.html` change moves the hash, and
   stop implying `verify-provenance` catches code changes — it does not. Lean on `Dex-Test-Suite` for
   behavior and treat provenance as "did an export come from *a* build of this app," nothing finer.

Either way, **do not** trust "0 mismatches" as evidence that committed exports match current code.

---

## 2. P2 — Two generators are not patient-coherent yet (GlucoDex, ECGDex)

> **STATUS (June 2026 — this pass).** ✅ **GlucoDex DONE** — now on the shared `DexPatientGen`
> axis (profile + days), so a GlucoDex synthetic patient is the SAME person OxyDex/HRVDex/etc.
> generate and fuses in the Integrator. Glycemic variation comes from the patient's apnea burden
> (profile→AHI→nocturnal glucose) plus an additive `cfg.glucBaseMmol` override (`renderGlucoAll`,
> default 5.4 → frozen corpus byte-identical) that the `predm` option uses for a pre-diabetic
> baseline (verified means: healthy ≈105, severe ≈106, pre-DM ≈128 mg/dL). Suite green (637).
> 🟡 **ECGDex — DECIDED: left single-recording on purpose** (rationale below; see the comment on
> `ecgdex-app.js genSynthetic`). The raw-µV multi-night lift is not worth it now.

Seven surfaces now share `DexPatientGen` (same profile+days → same seeded patient → exports fuse).
**GlucoDex and ECGDex are the exceptions** and still run independent per-node synthesizers:

- `glucodex-app.js` `genSynthetic()` → `DSP.genSynthetic({days, profile})` (own scenario select `d3/d7/d14/predm`).
- `ecgdex-app.js` `genSynthetic()` → `DSP.genSynthetic({durSec, scenario})` (single recording: `spot/hour/overnight/full/ambulatory`).

So a GlucoDex synthetic patient and an OxyDex synthetic patient are **unrelated people** — they
won't line up in the Integrator. To finish the coherence story:

- **GlucoDex** is straightforward: `SYNTH` already has `renderGlucoAll(timelines)`. Add the
  `synth-gen.js` + `dex-patient-gen.js` includes, swap the control to the shared profile+days
  `.synth-line`, and have `genSynthetic()` call `DexPatientGen.buildNights(profile, days)` →
  `SYNTH.renderGlucoAll(tls)` → existing CGM ingest. **Caveat:** the shared engine uses `gluc:'flat'`
  to dodge the date-locked hypo/dawn windows — for GlucoDex you'll *want* glycemic variation, so
  either let GlucoDex pass a glucose-profile override into a new `buildNights` option, or keep its
  `predm` path. Decide what "healthy vs pre-diabetic" means as a per-night knob.
- **ECGDex is harder and may be intentionally left alone.** `SYNTH` emits **RR**, not µV ECG; the
  RR→PQRST µV renderer lives in `cohort-full.js` (`pqrst()`), not in `SYNTH`. Coherent raw-ECG
  generation means lifting that renderer (or factoring it into `SYNTH`) — and raw ECG at 130 Hz over
  many days is large. Probably scope ECGDex to 1–3 nights even if other apps do 14. If not worth it,
  document ECGDex as deliberately single-recording and move on.

When you touch these `*-app.js` / `*-dsp.js` files, the **regression gate applies** — run
`Dex-Test-Suite.html` and confirm all green before `done`.

---

## 3. P3 — Integrator generator polish

`integrator-app.js` `genSynthetic()` works but has rough edges:

- **Evidence grades are hardcoded `'validated'`** for `odi4`/`minSpo2`/`rmssd`/`sdnn` in the emitted
  `ganglior.crossnight` envelopes. Per the **evidence-badge single-source rule** (`CLAUDE.md`), a
  metric's tier is a NODE fact from its `<node>-registry.js`. Pull the real grades from
  `OXY_REGISTRY` / `ECG_REGISTRY` (via the node resolvers) instead of hardcoding, so the longitudinal
  badges match the registries. These envelopes are runtime-only (not committed), so this is cosmetic
  correctness, not a gate failure — but it's the kind of ad-hoc re-grading the cohesion rule exists to
  prevent.
- **Verify metric-id parity with the real nodes.** The synthetic envelope uses ids `odi4`, `minSpo2`,
  `rmssd`, `sdnn`. For a synthetic 90-day record to merge on the same trend axis as a **real** node's
  `crossNight` export, those ids must match what the real OxyDex/ECGDex `crossNight` envelopes emit.
  Confirm against the nodes' actual `CrossNightEnvelope.build(... metrics:[{id:...}])` calls; rename
  if they differ.
- **`loadSamples` is fine but redundant.** Both files it fetches
  (`uploads/ecgdex-2026-06-12.node-export.json`, `uploads/oxydex-2026-06-12.summary.json`) **exist**,
  so it is not broken (the "stale" note in `Dex-Test-Suite` refers to content currency, not missing
  files). Now that there's a generator, consider repointing the button at fresher fixtures or
  removing it.
- **Longitudinal store mixes synthetic + real with no marker.** `IntegratorLong` (IndexedDB) absorbs
  generated rows alongside any real ones and persists across sessions, keyed by `node|date`.
  Regenerating piles rows up (I saw leftover CPAPDex rows from prior sessions during testing). The
  "Clear store" button in the Longitudinal view handles it, but consider tagging synthetic rows
  (e.g. a `synthetic:true` flag on the persisted record) so they can be filtered/cleared distinctly.

---

## 4. P3 — Minor

- **14-day generation is heavy** for OxyDex (full-night 1 Hz × 14) and PpgDex (176 Hz windows × 14)
  on weak devices. Acceptable, but if it drags, cap those two lower or stream.
- The shared **severity random-walk** in `dex-patient-gen.js` changed the deterministic output of
  `buildNights` (it now ties AHI↑/HRV↓ per night). No committed fixture depends on generated
  synthetic content, so this was safe — but keep that in mind if anyone ever snapshots generator
  output.

---

## 5. Conventions to honor (these bit me; the codebase already does them right)

- **Never use a bare `document.addEventListener('DOMContentLoaded', fn)` in app/component JS.** In the
  bundle, app scripts are eval'd **after** DOMContentLoaded has already fired, so a bare listener
  never runs. Always guard: `if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fn); else fn();`
  (see `hrvdex-app.js` `_hrvInit`, `integrator-app.js` init, `ganglior-provenance.js` — all correct).
  I hit this once with a generate-button handler; fixed by wiring directly.
- **Edit the `.js` + `.src.html`, re-bundle the `Foo.html` via the inliner; never edit the bundled
  `.html`.** After any `*-dsp.js`/`*-app.js`/`*-cross.js` change, run `Dex-Test-Suite.html` (must be
  all green) and, after re-bundling, open `verify-provenance.html` (read #1 above re: what it really
  proves).
- **Clock Contract:** floating `tMs` via `Date.UTC`, read back via `getUTC*` only. The generator path
  obeys this because `SYNTH` does — keep it that way.
- **Do not rename `ganglior.*` identifiers, the `ganglior.node-export` / `ganglior.crossnight`
  schemas, or the `fascia` alias.** Brand strings are `Tepna`; the bus codename `Ganglior` is FROZEN.
- Every authored file carries the SPDX header from `licensing/SPDX-HEADERS.txt`.

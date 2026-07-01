<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Brief — Generator Follow-ups, Round II (June 2026)

> **For the next thread / an AI coder.** Read `CLAUDE.md` first (THE CLOCK CONTRACT, the
> provenance gate, the re-bundle rules, the evidence-badge single-source rule). This brief
> continues `GENERATOR-FOLLOWUPS-BRIEF.md`, whose P1–P3 are now **DONE** (see "Already shipped"
> below). Three follow-ups remain, ordered **cheapest-value-first**. None block shipping.
> Honor the gates verbatim: after any `*-dsp.js`/`*-app.js`/`*-cross.js` change run
> `Dex-Test-Suite.html` (must read **all green**); after any re-bundle open `verify-provenance.html`.

---

## 0. Already shipped (context — do NOT redo)

The first follow-up brief is fully executed:

- **P1 (provenance gap) — DECIDED: Option 2 (accept + document).** Confirmed root cause: the
  inliner's loader does `document.documentElement.replaceWith(...)` during unpack, so the
  `__bundler/template` script is gone by the time `ganglior-provenance.js` (eval'd from the
  manifest) computes `buildHash` → it hashes the **fallback** (bootstrap + in-DOM `<style>`),
  a COARSE skeleton hash that does **not** move for `.src.html`/app-JS/shared-module edits.
  Docs reconciled on all four surfaces: `ganglior-provenance.js` (header + `buildSource()`),
  `CLAUDE.md` §provenance, `verify-provenance.html` prose. The real executed-code fingerprint is
  the **static `manifestHash`** already computed by `verify-provenance.html`. **#1 below is the
  optional "do it for real" path** (Option 1) — only worth it if someone wants `buildHash` to
  have teeth again.
- **P2 GlucoDex — DONE.** On the shared `DexPatientGen` axis now; `synth-gen.js renderGlucoAll`
  honors an additive optional `cfg.glucBaseMmol` (default 5.4 → frozen corpus byte-identical);
  `dex-patient-gen.js buildNights(profile, nDays, opts)` / `resolve(profile, nDays, opts)` take a
  trailing optional `opts` (`{ gluc, glucBaseMmol }`). Verified means: healthy ≈105, severe ≈106,
  pre-DM ≈128 mg/dL. **Regression coverage added** — `tests/dex-tests.js` group
  *"GlucoDex synthetic coherence"* (and `GLUDSP`+`DexPatientGen` wired into BOTH runners' `env`).
- **P2 ECGDex — DECIDED: deliberately single-recording** (comment on `ecgdex-app.js genSynthetic`).
- **P3 Integrator — DONE.** Evidence grades pulled from the node registries via a registry-aware
  `gradeFor(node,id)` resolver (fixed real mis-grades: `minSpo2` and `residualAHI` are **measured**,
  not validated); id-parity confirmed; synthetic longitudinal rows now carry `synthetic:true`
  (`integrator-app.js env()` stamps `schema.synthetic`, `integrator-longitudinal.js` persists
  `rec.synthetic`). `loadSamples` left as-is (brief said "fine but redundant"). `GlucoDex.html` and
  `Integrator.html` were re-bundled; both gates green (679 passed / 0 provenance reds).

**One observed quirk to know going in (relevant to #1):** the coarse `buildHash` fallback is
**non-deterministic across runs** — an OxyDex fixture showed a transient `verify-provenance` red on
one run that cleared on the next, because the fallback hashes whatever `<style>` nodes happen to be
in the DOM at hash time (injected badge/synth CSS races the hash). #1 fixes this class of flake too.

---

## 1. (Optional, BIG) Make `buildHash` actually fingerprint the build — Option 1

**Goal.** Restore the documented promise that `buildHash` moves when the shipped code/template
changes, and kill the transient-red flake. Today it hashes the bootstrap, not the app.

**Why it's big.** It touches the **inliner** (the tool that produces `Foo.html` from `Foo.src.html`)
and then forces a **one-time regeneration of every `uploads/*` provenance fixture**, plus a
re-bundle + re-verify of all 8 apps. High blast radius. Do it as its own deliberate package; do NOT
fold it into any other change.

**Root cause recap (verified).** In `Foo.html` the bootstrap runs
`const doc = new DOMParser().parseFromString(template, 'text/html'); document.documentElement.replaceWith(doc.documentElement);`
— this discards the original `<html>` subtree, including `<script type="__bundler/template">`. By
the time `ganglior-provenance.js` runs (it is eval'd from the manifest, AFTER the swap),
`document.querySelector('script[type="__bundler/template"]')` is `null`, so `buildSource()` falls
through to the fallback. The template string **does** exist in the file on disk; it's just gone from
the live DOM.

**Fix (pick the stash variant — least invasive).**
1. **Inliner change.** In the bootstrap, immediately after it parses the manifest/template (it
   already does `let template = JSON.parse(templateEl.textContent);`), stash the *original* template
   text on a window global BEFORE the `replaceWith`, so it survives the DOM swap:
   ```js
   window.__BUNDLER_TEMPLATE = templateEl.textContent;   // raw JSON string of the pristine template
   ```
   Put it on `window` (not the DOM) so `replaceWith` can't remove it. (If you prefer hashing the
   executed code rather than the template skeleton, stash the manifest text instead/also:
   `window.__BUNDLER_MANIFEST = manifestEl.textContent;` — that gives the runtime access to the same
   bytes `manifestHash` uses, i.e. a real executed-code hash. Recommended: stash BOTH.)
   - ⚠️ This is the bundler/inliner's bootstrap, which is **regenerated on every re-bundle**. If you
     do not own the inliner source, you cannot make this stick — confirm you can edit the inliner
     before starting. (The current bootstrap is the `super_inline_html`/`bundle_project` style: a
     `DOMContentLoaded` async IIFE that reads `__bundler/manifest` + `__bundler/template`,
     gunzips assets, `replaceWith`es the doc, and re-creates `<script>`s.)
2. **`ganglior-provenance.js buildSource()` change.** Prefer the stashed global(s) over the (now
   always-null) DOM query:
   ```js
   function buildSource(){
     try {
       if (window.__BUNDLER_MANIFEST) return window.__BUNDLER_MANIFEST;   // executed-code identity (best)
       if (window.__BUNDLER_TEMPLATE) return window.__BUNDLER_TEMPLATE;   // template skeleton (good)
       var tpl = document.querySelector('script[type="__bundler/template"]'); // unbundled dev page
       if (tpl && tpl.textContent) return tpl.textContent;
       // …existing fallback…
     } catch(e){}
   }
   ```
   Keep the existing inline-`<script>`/`<style>` fallback for the **unbundled** `.src.html` dev case.
   Decide deliberately whether `buildHash` should track the **template** (skeleton) or the
   **manifest** (executed code). If you stash the manifest and hash it, you can arguably retire the
   separate static `manifestHash` column — but keeping both is fine and cheap.
3. **Re-stamp / regenerate fixtures (the expensive part).** Every committed `uploads/*.json` carries
   `schema.provenance.buildHash` from the OLD (fallback) scheme. After the fix every app's
   `buildHash` legitimately changes **once**. Regenerate each fixture by re-running its app on the
   committed raw input and re-exporting (do NOT hand-edit the hash — that defeats the point). Then
   re-bundle all 8 apps and open `verify-provenance.html`; confirm `buildHash` now **differs**
   between two builds that differ only in `.src.html` (or in any module, if you hashed the manifest),
   and that every fixture reads `reproducible ✓`.

**Verification / acceptance.**
- Two bundles of the same app that differ only in a one-char `.src.html` body edit produce
  **different** `buildHash` (today they don't). If you hashed the manifest, an external-`*.js` edit
  also moves it.
- Re-running `verify-provenance.html` twice in a row gives the **same** `buildHash` each time (flake
  gone).
- `Dex-Test-Suite.html` still all green; `ganglior-provenance.buildHash()` resolves in every app's
  iframe (the manifest-table "provenance helper" column stays `present`).
- Update `CLAUDE.md` §provenance + `ganglior-provenance.js` header + `verify-provenance.html` prose
  back to the **strong** claim (they currently document the coarse reality — flip them once the fix
  lands). This is the inverse of the Round-I doc pass; keep the two in sync.

**Pitfalls.** `replaceWith` order — stash BEFORE it. `window.__BUNDLER_*` must be set even on the
error path so a partial unpack still yields a hash. Don't stash a blob: URL or a mutated copy — stash
the raw `textContent`. Don't re-bundle apps for the inert helper edit until you're ready to also
regenerate fixtures (a half-done pass leaves every fixture red).

---

## 2. (Small-medium) Integrator — "Clear synthetic" filter in the Longitudinal view

**Goal.** The longitudinal store (`IntegratorLong`, IndexedDB, keyed `node|date`) accumulates
generated rows across sessions and mixes them with any real ones. Round-I added the data flag
(`rec.synthetic === true` on generated rows). Now surface it: let the user **clear synthetic rows
distinctly** and/or **filter** them out of trends/correlations, without nuking real data.

**What already exists (build on it, don't re-add).**
- `integrator-app.js genSynthetic()` → `env()` stamps `schema.synthetic = true` on every generated
  `ganglior.crossnight` envelope.
- `integrator-longitudinal.js ingest()` persists `synthetic: !!(env.schema && env.schema.synthetic)`
  on each `rec` (store `STORE`, keyPath `id`).
- `IntegratorLong` already exposes `clear()` (clears ALL) and `render()`; the Longitudinal view has a
  "Clear store" button.

**Steps.**
1. **`integrator-longitudinal.js`:** add `clearSynthetic()` — delete only rows where
   `rec.synthetic`. Mirror `clear()`'s pattern (it does an IndexedDB store clear + resets the
   in-memory `_rows` mirror); here iterate `_rows`, `os.delete(id)` for synthetic ids, and prune the
   mirror. Also add an optional `includeSynthetic` arg (default `true`) to the analysis entry points
   that read `_allRows()` (`crossCorrelations`, `seriesFor`, `metricKeys`, the trend render) — when
   `false`, filter out `r.synthetic` rows. Keep all new args **last + optional** so the shared
   assertions and any caller stay byte-compatible (CLAUDE.md contract). Export `clearSynthetic` on
   `global.IntegratorLong` next to `clear`.
2. **`integrator-render.js` (or wherever the Longitudinal view renders):** add a small control row —
   a **"Synthetic: show / hide"** toggle and a **"Clear synthetic"** button — next to the existing
   "Clear store" button. Wire toggle → re-render with `includeSynthetic=false`; button →
   `IntegratorLong.clearSynthetic()` then re-render. Tag synthetic trend points/rows visually (e.g. a
   hollow marker or a "· synthetic" chip) so mixed real+synthetic series are legible. Match the
   existing view's visual vocabulary (node colors via `nodeColor`, the `.section-block`/`.long-trend-grid`
   classes already in `integrator-longitudinal.js render()`).
3. **`Integrator.src.html`:** if the toggle/button need static markup, add it to the Longitudinal
   view block; otherwise render it from JS. No new script includes needed.

**Gates.** This is an `integrator-*.js` change → **re-bundle `Integrator.html`** (inliner) and run
**both** gates. Add/extend a `tests/dex-tests.js` assertion: ingest one synthetic envelope
(`schema.synthetic:true`) + one real-shaped envelope, assert `state().nRows` counts both, then
`clearSynthetic()` leaves only the real row and `crossCorrelations`/`seriesFor` with
`includeSynthetic=false` exclude the synthetic one. (`IntegratorLong` is headless-safe? It uses
IndexedDB — guard the test to the browser runner, or factor the filter logic into a pure helper you
can unit-test in Node. Prefer the pure-helper split so Node CI covers it.)

**Pitfalls.** Don't change the persisted `id` scheme (`node|date`) — synthetic and real rows for the
same `node|date` collide by design (last-write-wins); that's acceptable, but note it in the toggle's
title. Pre-existing rows persisted before Round-I have **no** `synthetic` field → treat
`undefined` as **real** (don't hide them). Persist the toggle state in `localStorage` (never clear
keys you didn't write).

---

## 3. (BIG, maybe-not-worth-it) ECGDex raw multi-night coherence

**Status: intentionally NOT done** (see the decision comment on `ecgdex-app.js genSynthetic`). Only
pick this up if raw-µV multi-night coherence becomes a real product need. Documented here so the
decision is reversible with eyes open.

**Why it's hard.** The shared engine `SYNTH` (synth-gen.js) emits **RR intervals**, not µV ECG. The
RR→PQRST µV renderer is `cohort-full.js renderECGInt16(tl, win, SYNTH)` (which calls a local
`pqrst()`), used today only for the FULL-lane waveform-fidelity harness over a *single window*. Raw
ECG at ~130 Hz over many nights is also **large** (≈130×3600×8h×N samples), which is why every other
node caps multi-day but ECGDex stays single-recording.

**If you do it.**
1. **Factor the µV renderer into `SYNTH`.** Lift `pqrst()` + `renderECGInt16` from `cohort-full.js`
   into `synth-gen.js` as e.g. `SYNTH.renderECGInt16(tl, win)` (additive export; leave `cohort-full.js`
   delegating to it so the FULL-lane harness and its fidelity gate keep passing unchanged). Obey the
   Clock Contract — sample times are floating `tMs` off `tl.t0Ms`.
2. **Add an ECGDex shared-engine path.** Mirror what OxyDex/PpgDex did: include `synth-gen.js` +
   `dex-patient-gen.js` in `ECGDex.src.html`, swap the scenario select for the shared **profile +
   days** `.synth-line`, and have `ecgdex-app.js genSynthetic()` call
   `DexPatientGen.buildNights(profile, days)` → render each night's ECG → feed the **real streaming
   ingest** (the Web-Worker path). **Cap days to ~1–3** even if other apps offer 14 (size). Keep the
   existing scenario generator as a fallback/dev mode if useful.
3. **Coherence check.** An ECGDex synthetic patient must line up with the OxyDex/HRVDex one (same
   seed/nights) so they fuse in the Integrator — verify a generated ECGDex export and a generated
   OxyDex export for the same profile+days share nightly `t0Ms` and produce a same-night fusion
   finding.

**Gates.** `*-dsp.js`/`*-app.js` + `synth-gen.js` changes → `Dex-Test-Suite.html` all green
(watch the FULL-lane fidelity group — moving `pqrst` must not change its output) → re-bundle
`ECGDex.html` → `verify-provenance.html`. The shared-suite render-coverage group for ECGDex
(`renderCoverageECGDex`) must still populate.

**Pitfall.** Don't change `cohort-full.js`'s observable output when factoring out `pqrst` — the
waveform-fidelity gate snapshots it. Add the new `SYNTH.renderECGInt16` as a *new* export and have
the old call site delegate, rather than relocating behavior in a way that shifts bytes.

---

## 4. Conventions (same as Round I — these still bite)

- **Edit the `.js` + `.src.html`, re-bundle `Foo.html` via the inliner; never edit the bundled
  `.html`.** After any `*-dsp.js`/`*-app.js`/`*-cross.js` change: `Dex-Test-Suite.html` all green;
  after any re-bundle: `verify-provenance.html` no red verdicts (and read the **`manifestHash`**
  column for real code identity — `buildHash` is coarse until #1 lands).
- **Inert shared-module additions don't require re-bundling 8 apps** (precedent: the badge-CSS export,
  and Round-I's comment-only `ganglior-provenance.js` edit). Re-bundle only when runtime behavior
  changes.
- **New params/return fields go LAST + optional**; expose new data via NEW fields/methods — the
  shared assertions in `tests/dex-tests.js` ARE the public contract.
- **Clock Contract:** floating `tMs` via `Date.UTC`, read back via `getUTC*` only.
- **Evidence grade is a NODE fact** from `<node>-registry.js` — never invent a global grade table.
  The Integrator's `gradeFor()` MIRRORS the registries and prefers the live registry object if
  present; keep that pattern.
- **Do not rename `ganglior.*` identifiers, the `ganglior.node-export` / `ganglior.crossnight`
  schemas, or the `fascia` alias.** Brand strings are `Tepna`; the bus codename `Ganglior` is FROZEN.
- Every authored file carries the SPDX header from `licensing/SPDX-HEADERS.txt`.

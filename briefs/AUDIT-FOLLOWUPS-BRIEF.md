<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Brief — Audit follow-ups from the 6-brief execution review (2026-06-22)

> **For the next thread / an AI coder.** Read `CLAUDE.md` first (THE CLOCK CONTRACT, the two
> gates, the build-then-bundle rule, the evidence-badge single-source rule, the FROZEN `ganglior.*`
> identifiers + `fascia` alias). This brief captures everything left **open** after auditing the six
> most-recent briefs and shipping the two highest-value fixes. Honor the gates verbatim: after any
> `*-dsp.js`/`*-app.js`/`*-cross.js` change run `Dex-Test-Suite.html` (must read **all green**); after
> any re-bundle update `BUILD-MANIFEST.json` and open `verify-provenance.html` (GATE A must PASS, no
> red verdicts).

---

## 0. Already shipped this pass (context — do NOT redo)

- **PulseDex BP-from-HRV removal — DONE** (DEX-SUITE-EXTERNAL-REVIEW-v2 §🔴, the review's #1 item).
  Deleted `SBP est` / `DBP est` / `HTN Pattern` table rows + their CSV columns (`pulsedex-render.js`
  incl. the `EXTRA_COLS` header list), dropped `bpEst`/`htnScore` from `pulsedex-dsp.js`, and removed
  the `bp`/`htn` computation + `sbp`/`dbp`/`dSBP`/`htnScore` result-object fields from
  `pulsedex-app.js`. `PulseDex.html` re-bundled; `BUILD-MANIFEST.json` PulseDex updated
  (`manifestHash 17d995e209c6`). Suite **694 green**, provenance **GATE A PASS / 0 reds**.
- **OxyDex "restore last session" bundle-safety (FOLLOWUP-FINDINGS P1) — was ALREADY FIXED; no change
  needed.** The fix lives in `oxydex-app.js` `_oxyRestoreLast()` (~L313–331): it runs the restore from
  the external module (guarded `if(document.readyState!=='loading')`), with a `lastSessionChip` dedup
  guard, and **deliberately leaves** the unguarded inline `DOMContentLoaded` listener in
  `OxyDex.src.html` for the unbundled dev path. Do not "fix" the inline listener — editing the shell
  moves `buildHash` for no benefit. (An earlier audit flagged this as open; it is a false positive.)
- **OxyDex pre-existing source↔bundle drift — reconciled.** A clean re-bundle of the current,
  unmodified OxyDex source produces `buildHash 10060a2b3aaa` / `manifestHash 640b058324c8`, but
  `BUILD-MANIFEST.json` still held the older `af68bc86ad2b / 5ab136504ea8` and the committed
  `OxyDex.html` was built from older source. The committed `OxyDex_2026-06-13_1056_summary.json`
  fixture's **oximetry metrics reproduce byte-identically** on current code (verified by driving the
  rebuilt bundle on its committed inputs), so `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` were
  synced to the clean current bundle. **See §6 — this drift was almost certainly NOT OxyDex-only.**

---

## 1. (Small-medium) Integrator — "Clear synthetic" / show-hide filter — NOT BUILT

This is the one squarely-actionable item from **GENERATOR-FOLLOWUPS-II #2** that was never executed.
Round-I shipped the *data* flag (`rec.synthetic === true` on generated rows; `integrator-longitudinal.js
ingest()` persists it) but the longitudinal view still cannot filter or clear synthetic rows
distinctly. There is **no** `clearSynthetic` or `includeSynthetic` in `integrator-longitudinal.js` /
`integrator-render.js` today.

Build exactly as GENERATOR-FOLLOWUPS-II §2 specifies (read it for the full step list + pitfalls):
- `integrator-longitudinal.js`: add `clearSynthetic()` (delete only `rec.synthetic` rows, mirror
  `clear()`); add an optional **trailing** `includeSynthetic` arg (default `true`) to the read paths
  (`crossCorrelations`, `seriesFor`, `metricKeys`, trend render); export `clearSynthetic` on
  `global.IntegratorLong`. Prefer factoring the filter into a **pure helper** so Node CI covers it.
- `integrator-render.js`: add a "Synthetic: show / hide" toggle + "Clear synthetic" button next to
  "Clear store"; tag synthetic points/rows visually; persist toggle in `localStorage` (never clear
  keys you didn't write). Pre-Round-I rows have no `synthetic` field → treat `undefined` as **real**.
- Extend `tests/dex-tests.js`: ingest one synthetic + one real envelope, assert `clearSynthetic()`
  leaves only the real row and `includeSynthetic=false` excludes the synthetic one.
- **Gate:** `integrator-*.js` change → re-bundle `Integrator.html`, update `BUILD-MANIFEST.json`
  (Integrator `manifestHash`), run both gates.

---

## 2. (Contract polish) GlucoDex fusion events — add `HH:MM:SS` (tMs already done) — PARTIAL

**EXPORT-HARDENING #2** is half-done. `glucodex-app.js` (~L578–582) now emits `tMs` on each fusion
event (the important half — Clock Contract §6 "new emitters SHOULD write `tMs`" ✓), but `t` is still
minute-resolution (`t0 = DSP.hhmm(...)`). Every other node emits `t:"HH:MM:SS"`. Add a UTC
seconds-precision `hhmmss(ms)` helper (Clock Contract §5, `getUTC*`) and set `t` to it; keep `tMs`.
Also applies to the DSP event builder `glucodex-dsp.js buildEvents` (`t:hhmm(...)`). Back-compat:
**add** seconds, don't change `tMs`. Re-bundle `GlucoDex.html` + update `BUILD-MANIFEST.json` + gates.

---

## 3. (Decision) `validateNodeExport()` ships live only in the Integrator — EXPORT-HARDENING #4

`crossnight-envelope.js` exports `validateNodeExport` (tested in `tests/dex-tests.js` group 7b, and
consumed by `integrator-app.js:42`). Only `Integrator.html` carries it at runtime; the other 6 node
bundles embed the older module without the fn. Per `CLAUDE.md` this is an acceptable **inert**
shared-module addition (those nodes never call it). Decision: (a) leave as-is + a one-line note in the
module, or (b) re-bundle the 6 nodes so source == bundles (JS-only → no `buildHash` move, but **does**
move each `manifestHash` → you must update all 6 entries in `BUILD-MANIFEST.json`). (b) is tidier but
flips 6 manifest rows for an inert addition — only do it as part of the §6 sweep, not alone.

---

## 4. INTEGRATOR-EXPORT-FIX secondary list — surfaced, owner must pick (each its own package)

P1/P2 of that brief are **DONE** (`buildFusionExport` serializes `positional`/`hrvConsensus`/
`deviceScoredAHI`, `schema.version 1.2`; `findings.sort` nulls-last). The "Secondary" list was never
actioned and each needs a decision:

1. **🔴 Suite-wide blank-on-print/PDF/export.** `ans-design.css` animates `.main-content`/`.chart-card`/
   `.kpi` **from `opacity:0` with `fill:both`**, so frozen-timeline contexts (print, PDF, capture,
   throttled tab) render blank. **Only the Integrator was patched** (scoped CSS in
   `integrator-render.js`); the other six apps still blank out. Root fix = make the visible end-state
   the base in `ans-design.css` and animate from hidden only while playing. ⚠️ `ans-design.css` is
   inlined into every bundle's `__bundler/template` → editing it moves **every** app's `buildHash` →
   re-bundle all 7 + regenerate fixtures + full suite + regen `BUILD-MANIFEST.json`. Big, deliberate
   pass (fold into §6).
2. **Badge-coverage audit of the other six apps.** The 🔴 coverage mandate (every surfaced
   measurement carries an evidence badge, bottom-right corner or inline-before-label) was only made
   compliant in the Integrator. Audit OxyDex/HRVDex/PulseDex/GlucoDex/ECGDex/CPAPDex for unbadged
   surfaces. (Removing PulseDex's BP rows this pass eliminated three unbadged numbers; the rest of the
   sweep remains.)
3. **`Integrator.src.html` has 3 duplicate `<nav class="mobile-nav">` blocks** (deduped at runtime by
   `bindNav`). Cleaning the markup moves `buildHash` → flips the 3 committed
   `uploads/integrator_fusion_*.json` fixtures, whose source node-export inputs aren't in the repo →
   can't regenerate. Currently keep the runtime workaround. Decide deliberately.
4. **Fusion-finding evidence tiers are author-assigned, not test-backed** (`FINDING_EVIDENCE` in
   `integrator-render.js`). Ratify the grades (a science-governance call) and consider moving them
   into a small node-style registry so the `cohesion-badges` gate anchors them.

---

## 5. DEX-SUITE-EXTERNAL-REVIEW-v2 — remaining improvement list (mostly data/cosmetic)

With the BP leak closed, the review's top item is done. Remaining (in their order):
1. **Publish one external agreement number** — paired-PSG cohort → Bland–Altman ODI-4-vs-PSG-ODI. The
   harness already ingests it; this is the highest trust-per-effort item but **data-gated** (no PSG
   dataset committed).
2. **Kubios/NeuroKit2 cross-check** on RR the harness already re-detects (converts §B from "method
   correct" to "agrees with the reference"). Also data/tooling-gated.
3. **Sweep orphaned research-depth render rows.** PulseDex still lists `VO₂ base`/`VO₂ adj`
   (`pulsedex-render.js` ~L194–195) — these have registry entries (`vo2`/`vo2base`) so they're
   surfaceable, but confirm they resolve a badge under the coverage mandate, or demote/remove. (Fold
   into §4.2.)
4. **Rename the wellness-coded composites** (Coherence/Welfare/Energy) to neutral autonomic terms, or
   keep strictly research-depth. Cosmetic; last gimmick smell.
5. **Surface the data-quality stamp prominently** (`correctionRate`/`analyzablePct`/`motionRejectedPct`)
   so high-artifact nights are visibly caveated (WP-D open item).
6. **Tune the Core set to ~8–12 validated metrics per node** (depth defaults are right; curation isn't
   finished).

---

## 6. 🔴 NEW — likely repo-wide source↔bundle drift; run a re-bundle + manifest-regen sweep

OxyDex (§0) proved that **committed source had moved ahead of its committed bundle without a
re-bundle** — yet GATE A was *green* beforehand because the stale bundle, stale `BUILD-MANIFEST`, and
stale sidecar all agreed (a "consistent-but-stale" trap; GATE A only catches drift once you actually
re-bundle). The same may be true for **GlucoDex / PpgDex / HRVDex / ECGDex / CPAPDex / Integrator**.

**Task:** as a deliberate package, for each of the 8 apps:
1. Re-bundle `Foo.src.html → Foo.html` with the inliner (no source edit).
2. Read the fresh `manifestHash` off `verify-provenance.html`'s manifest table.
3. If it differs from the value committed in `BUILD-MANIFEST.json`, the committed bundle was stale →
   commit the fresh bundle + update that app's `BUILD-MANIFEST.json` entry.
4. For any app with committed `uploads/*.json` fixtures in `FIXTURE-PROVENANCE.json`, confirm the
   fixture still reproduces (drive the rebuilt app on its committed inputs, compare metrics with
   volatile keys stripped) and update the recorded `manifestHash`. Only OxyDex has a sidecar fixture
   today; PulseDex/Integrator fixtures are pre-R1 ("no provenance") or buildHash-legacy.
5. Re-run `Dex-Test-Suite.html` (all green) at the end.

This is the natural home for §3 (re-bundle the 6 for `validateNodeExport`) and §4.1 (the
`ans-design.css` print fix, which forces an all-8 re-bundle anyway) — do them together so the suite is
re-bundled exactly once.

---

## 7. (LOW) Minor / verify

- **HRVDex persistence quota is silent** (FOLLOWUP-FINDINGS P5.2). `persistHRVRows()` swallows
  `localStorage` quota errors in a try/catch, so a long accumulated history quietly stops persisting.
  Cap stored history (most-recent N) or surface a `setStatus` warning — match the "missing → visible,
  never fabricated" philosophy. In-memory accumulation is unaffected.
- **PpgDex epoch number precision** (EXPORT-HARDENING #5, optional). `ppgdex-app.js buildV2` epochs +
  the epochs CSV emit raw float HRV (`42.317480…`); other nodes round in-DSP. Route PpgDex epoch
  numeric fields through a `round(v,d)` helper. Cosmetic.
- **VERIFY — HRVDex profile still derives BP.** `hrvdex-profile.js` (~L85–93) computes
  `sbpEstimates`/`medSBP`/`medDBP` from HRV (a parallel of the PulseDex leak just removed), and reads
  `p.sbp`/`p.dbp` (these latter are **user-entered cuff values** for MAP/BAP, which are legitimate).
  Confirm whether `medSBP`/`medDBP` are **surfaced** anywhere; if so, it's the same HRV→BP class the
  review condemned and should be removed/demoted. If only used internally and never shown, document it
  and leave it.
- **VERIFY — PulseDex "Transit-time variability" caption.** `pulsedex-app.js:228` renders
  `pttvMs` (`√(PRV²−HRV²)`) with the note *"vascular/BP surrogate"*. This is a different, defensible
  metric (pulse-transit-time variability from the dual PRV−HRV path), NOT the discredited HRV→BP
  regression — but sanity-check the "BP surrogate" wording doesn't reintroduce a BP claim.

---

## 8. Deferred by design (do NOT pick up unless the need is real)

- **GENERATOR-FOLLOWUPS-II #1** — make `buildHash` actually fingerprint executed code (stash
  `__BUNDLER_TEMPLATE`/`__BUNDLER_MANIFEST` in the inliner bootstrap). Explicitly optional/BIG; touches
  the inliner + forces regenerating every `uploads/*` fixture + re-bundling all 8. The `manifestHash`
  column + `BUILD-MANIFEST.json` (GATE A) + `FIXTURE-PROVENANCE.json` (GATE B) already give
  executed-code teeth at the verification layer, which is why this stays deferred.
- **GENERATOR-FOLLOWUPS-II #3 / GENERATOR-FOLLOWUPS #2** — ECGDex raw-µV multi-night coherence.
  Intentionally NOT done (decision comment on `ecgdex-app.js genSynthetic`); ECGDex stays
  single-recording. Reopen only if raw-µV multi-night coherence becomes a real product need.

---

## Suggested order
§1 (Integrator synthetic filter — clean, self-contained) → §2 (GlucoDex `HH:MM:SS`) → §7 verifies
(HRVDex profile BP, PulseDex caption) → then schedule the **§6 re-bundle sweep** as one deliberate
package and fold §3, §4.1, §4.2 into it. §5 items are data/cosmetic and can trail. Run both gates
after every re-bundle; keep `BUILD-MANIFEST.json` in lockstep with the bundles (that's what gives
GATE A teeth).

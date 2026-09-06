<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED (parked 2026-09-06 — ✅ **§4.4 IS RATIFIED: the owner ratified all ten fusion `FINDING_EVIDENCE` grades AS THEY STAND, 2026-09-06**, closing the one item that was purely awaiting a word. The 2026-08-16 audit found all ten defensible with citations, and the brief's own reasoning carried the decision — unlike the OxyDex batch's 68 ungraded labels, these already carry reasoned grades, so assigning fresh tiers over them would have been the more dangerous act. **What remains is NOT owner-decision and NOT actionable:** §5.1 (no PSG set) and §5.2 (no Kubios/NeuroKit2 tooling) are data/tooling-gated, §5.4–§5.6 are cosmetic-by-design, §8 is deferred. **Owner:** none outstanding; **next step:** none schedulable — this flips to DONE when a PSG set arrives or the cosmetic items ride along with a re-bundle. Prior header, 2026-09-02: §1's body was STALE and is corrected in place — `clearSynthetic()`/`filterSynthetic()` ship at `integrator-longitudinal.js:296`/`:318`, verified, while the body still prescribed building them. §5.1/§5.2 remain data-gated, §5.4/§5.6 cosmetic-by-design — the last two *per Heron's read, not independently re-verified*. Prior: §1·§2·§3·§4.1·§4.2·§4.3·§6·§7 RESOLVED · §5.3 ANSWERED 2026-08-04 — everything still open is **owner-decision** (§4.4 ratification · §5.4–§5.6 cosmetic), **data-gated** (§5.1 no PSG set · §5.2 no Kubios/NeuroKit2 tooling) or **deferred** (§8); nothing is merely unstarted · ⚠️ **three earlier stamps here were WRONG, all corrected below**) · **Spawns:** `BLANK-ON-PRINT-FLEET-2026-08-03-BRIEF.md` · **Created:** (undated — pre-2026-07-03, grandfathered)

> **2026-08-04 backlog sweep — what is left, and why none of it is "just do it":**
> - **§4.3** — ✅ **EXECUTED**, see the §4.3 correction below. (This sweep independently reached the same
>   diagnosis — that the blocker was priced in a retired `buildHash` — and wrote it up as an owner-decision
>   still pending; a concurrent session had already *executed* it in `015dc82` (#824) while this was being
>   written. Corrected here rather than left standing: the brief moved under the sweep, which is the exact
>   failure this sweep exists to catch.)
> - **§4.4** (`FINDING_EVIDENCE`) — its "not test-backed" half is **no longer true**; a gate now anchors
>   every fusion finding type. Only owner *ratification* of the grades remains.
>   **✅ AUDITED 2026-08-16 — all ten defensible as they stand; ratification is a one-word answer.**
>   Owner directed (2026-08-16) that this fold into the OxyDex tier batch. It differs from that batch in
>   kind: those 68 labels had **no** grade and needed one assigned; these ten **already carry** grades
>   with citations, so the work was to audit them, not to write them. Assigning fresh tiers over existing
>   reasoned ones would have been the more dangerous act.
>
>   | finding | grade | audit |
>   |---|---|---|
>   | `device_ahi` | `validated` | firmware-scored AHI, AASM-style, used as the clinical reference and not re-derived. Corroborated: CPAPDex matches the device's own `STR.edf` scoring to 0.05/h |
>   | `confirmed_apnea` | `emerging` | cross-signal corroboration, explicitly *"not a scored AHI"* — see the citation note below |
>   | `hrv_consensus` | `emerging` | Task Force 1996 is a real standard; cross-device consensus, divergence flags QC |
>   | `positional_apnea` | `experimental` | its own cite says *"directional, small-n"* |
>   | `tch_error` | `experimental` | Gray & Allan 1974 three-cornered hat — published method, conservative grade for this application |
>   | `periodic_breathing` | `experimental` | node composite |
>   | `auto_glycemic` | `heuristic` | *"hypothesis-generating"*, and `dead-ends.html` records the glucose↔HRV coupling collapsing to +0.01 once a shared apnea driver is partialled out |
>   | `staging_disagreement` | `heuristic` | **the best-reasoned entry**: the tier is INHERITED, because a disagreement between two `heuristic` estimators cannot be stronger evidence than its inputs |
>   | `desat_match` | `measured` | arithmetic over counts, not an inference |
>   | `overlap_coverage` | `measured` | arithmetic over declared segment lengths |
>
>   ⚠️ **One citation worth tightening, and deliberately NOT treated as blocking.** `confirmed_apnea`
>   cites *"AASM ODI framing; Azarbarzin 2019"*, while `oxydex-registry.js` explicitly distances its own
>   hypoxic burden from that paper — *"NOT Azarbarzin 2019: that sleep-apnoea-specific hypoxic burden is
>   event/baseline-referenced"*. Azarbarzin 2019 is about the hypoxic-burden metric, not about
>   desaturation↔surge corroboration, so the reference is loose for the claim it is attached to.
>   **It is not fabricated authority**, because the grade is `emerging` rather than `validated` — the
>   citation is decorative here, not load-bearing, and §🎫's rule bites only when a citation carries an
>   upgrade. Worth a rewording on the next touch of that file; not worth a re-bundle on its own.
> - **§5.1 · §5.2** — data-gated (no PSG dataset / no Kubios-NeuroKit2 tooling committed). Not startable.
> - **§5.4 · §5.5 · §5.6** — cosmetic / curation calls.
> - ~~🔴 One NEW finding from §5.3's scan: `VO₂ GT` surfaces with no evidence badge.~~
>   **Retracted as a false positive, then RECLASSIFIED by owner decision — both on 2026-08-04. Net: the
>   badge exists, but not for the reason first claimed.** The finding was wrong: `VO₂ GT` was an explicit
>   `_META_DENY` key — *"never badge even with fallback"* — so the empty return was **intended**, not a
>   silent gap, and calling it a bug was a misreading (the probe was right; the interpretation was not).
>   The owner then judged the *classification itself* wrong and reclassified: entered-ness is not a tier,
>   provenance is, and a laboratory VO₂max is the one **directly measured** number in that table. It now
>   carries `evidence: 'measured'` via a real `PULSE_REGISTRY` entry. See §5.3 for both halves — the tell
>   that was missed, and what shipped.

> **⚠️ Correction — §1 is SHIPPED, and this header previously said it was not.**
> An earlier 2026-08-03 pass stamped §1 *"NOT BUILT: zero matches in `integrator-app.js` or
> `Integrator.src.html`"*. Both files were the wrong place to look — §1's own step list puts the feature in
> **`integrator-longitudinal.js`** (data) and the Longitudinal view's `render()` (UI), and it has been there
> since at least PR #644. What actually ships: `clearSynthetic()` · the pure Node-CI-testable
> `filterSynthetic(rows, includeSynthetic)` (with `undefined` correctly treated as a pre-Round-I **real**
> row) · a trailing optional `includeSynthetic` threaded through `_allRows`/`nodes`/`datesSorted`/
> `metricKeys`/`seriesFor`/`crossCorrelations`/`state` · `clearSynthetic`/`filterSynthetic`/`hasSynthetic`/
> `countSynthetic` all on `global.IntegratorLong` · a **Show/Hide synthetic** toggle and a **Clear
> synthetic** button in the store bar, wired at `#longSynthToggle`/`#longSynthClear` · the preference
> persisted under the module's own `localStorage` key · a synthetic count in the store bar with a `hidden`
> warning · dashed-border visual tagging (`.cg-synth`, `.ltc-synth`) · and assertions in
> `tests/dex-tests.js`. The same item is `GENERATOR-FOLLOWUPS-II-BRIEF.md` §2, corrected identically.
>
> **§6 is OBSOLETE as a task.** It asked for a one-off repo-wide source↔bundle drift sweep; that is now a
> standing gate — `node tools/build.mjs --check` (clean: 11 owned, 0 legacy), run by `npm run check` and CI.
>
> **§2 — SHIPPED (and my own first correction of it was ALSO wrong).** An earlier pass here reported "0
> matches for `HH:MM:SS` in `glucodex-dsp.js`" — but the code never contains that literal, it *produces*
> it. `glucodex-dsp.js:1063 hhmm(ms)` pads hours, minutes **and seconds** despite its name; verified by
> **execution**, not reading: `GLUDSP.hhmm(Date.UTC(2026,5,13,7,5,9,400))` → `"07:05:09"`. Both emitters
> already carry it — `buildEvents` (`:1306/:1311/:1315`) and the app-side fusion events
> (`glucodex-app.js:1169 t0`) — each with `tMs` alongside, so Clock Contract §6 is satisfied in full. The
> `.slice(0,5)` calls at `glucodex-app.js:734/746` are display truncation, which is correct.
>
> **§3 — RESOLVED BY CONSTRUCTION, no decision needed.** The brief said *"Only `Integrator.html` carries
> it at runtime."* Not any more: `validateNodeExport` is now in **six** bundles — CPAPDex · ECGDex ·
> OxyDex · PpgDex · PulseDex · Integrator — i.e. every bundle that inlines `crossnight-envelope.js`. Its
> option (b) happened naturally through ordinary re-bundles, and `build.mjs --check` (clean, 11 owned)
> now *guarantees* committed bundle ≡ build(source), so the source/bundle skew §3 worried about cannot
> recur silently.
>
> **§7 — ALL FOUR RESOLVED.** 7.1 `persistHRVRows` no longer swallows quota errors (halves the tail until
> it fits, returns `{capped,total}`) · 7.2 PpgDex epoch fields route through `_round(v,d)`
> (`ppgdex-app.js:874`, applied :883) · 7.3 **the HRV→BP derivation is gone** — removed 2026-06-22 per
> DEX-SUITE-EXTERNAL-REVIEW-v2 with the rationale in `hrvdex-profile.js:78-81`, and `sbpEstimates` /
> `medSBP` / `medDBP` return **zero matches tree-wide**; `prof_sbp`/`prof_dbp` survive only as
> user-entered cuff values, which §7 itself calls legitimate · 7.4 the PulseDex caption now reads
> *"vascular tone surrogate"* (`pulsedex-app.js:499`) — the "BP" wording §7 flagged is already gone.
>
> **⚠️ §4.1 is a LIVE 🔴 and is now its own brief** — `BLANK-ON-PRINT-FLEET-2026-08-03-BRIEF.md`.
> Re-verified: `ans-design.css` still animates `.chart-card`/`.chart-svg` from `opacity:0` with
> `fill-mode: both` (:854, :911, :1045, :1195), so a frozen timeline (print, PDF, capture, throttled tab)
> holds the hidden start state and **six apps render blank**. Neither guard covers it — the only
> substantive `@media print` rule is `#exportBar{display:none}` (:2389), and `prefers-reduced-motion`
> (:240) fires only on that user preference. The Integrator's scoped patch (`integrator-render.js:29-37`)
> is the proof of mechanism and the tested fix. Root fix is spine work (`ans-design.css` is inlined into
> every bundle) so it must be **scheduled**, not slipped in — hence its own brief.
>
> **⛔ §4.2 — RESOLVED, and it was already resolved when this brief was written.** It says the badge
> coverage mandate "was only made compliant in the Integrator" and the six-node sweep remains. Both
> halves are false: `BADGE-COVERAGE-AUDIT-BRIEF.md` — *"Evidence-Badge Coverage & Correctness Audit
> (every element, every Dex)"*, findings in `audits/BADGE-COVERAGE-AUDIT-FINDINGS.md` — landed
> **DONE 2026-06-23**, one day after this brief was written, and every node now badges through the
> mandated registry-resolved indirection (`evBadge(` → `<Node>Registry.badgeForLabel` →
> `MetricRegistry.badge`): ECGDex 22 sites, OxyDex 31, PpgDex 32, GlucoDex 26, PulseDex 22, CPAPDex 20,
> HRVDex 8, MotionDex 4. A 2026-08-04 re-run of the sweep
> (`BADGE-COVERAGE-AUDIT-2026-08-04-BRIEF.md`) took this line at face value, counted the raw
> `.badge(` engine call instead of the indirection, and "confirmed" it. **The stale prose and the
> broken instrument agreed, which is what made the false finding survive.** That re-run is kept only
> for the genuine defect it turned up on the way — `MetricRegistry.entry()` fabricating
> `evidence:'experimental'` for unknown ids, which had CPAPDex showing ECGDex's `validated` rMSSD as
> `experimental`.
>
> **✅ §4.3 — EXECUTED 2026-08-04. Its blocker was obsolete and its premise was slightly wrong.**
> The stated cost was *"cleaning the markup moves `buildHash` → flips the 3 committed
> `integrator_fusion_*.json` fixtures … can't regenerate"*. `buildHash` was RETIRED as a provenance
> signal by Phase 7 on 2026-06-30 — eight days after this brief was written — and both fusion fixtures
> (there are **2**, not 3) are `historical: true`, byte-pinned with **no `manifestHash` and no
> `inputHashes`**, so a markup change cannot flip them. Measured in `provenance/`, not assumed.
> They were also never true *duplicates*: two carried five views as `div.mobile-nav-item`, the third
> six (it has Longitudinal) as `button.mnav-item.nav-item` — and only `.mnav-item` is styled, so the
> dead pair rendered unstyled and half-overlapping until `bindNav` deleted them on every boot.
> **Decision taken: delete the two dead blocks in the shell and remove the runtime workaround**, which
> existed only to paper over them. Verified on the shipped artifact rather than argued — Chrome
> headless renders `main` and the fix to an **identical DOM** (1 rail, same buttons, same Longitudinal
> entries), so it is behaviourally inert. `computeHash` **stable at `1f053ea1052e`** ⇒ export-inert
> PROVEN; GATE A 9/9, GATE B 29/29.
>
> **Still open, deliberately not this brief's work:** **§4.4** (fusion-finding grade ratification —
> the *engineering* half is gated as of 2026-08-04; ratifying the nine tiers is a science-governance
> call) and **§5** (external-review list: three items data-gated, two cosmetic) · **§8** (deferred by
> design).
> (owner-pick lists, each explicitly "its own package") · **§8** (deferred by design).

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
distinctly. ⚠️ **CORRECTED 2026-09-02 — this paragraph was stale and its own header already said so.** Both functions SHIP: `clearSynthetic()` at `integrator-longitudinal.js:296` and `filterSynthetic()` at `:318` (plus `countSynthetic`/`hasSynthetic`). A reader entering at this body rather than the header would rebuild shipped work, which is why the header's correction was not enough on its own. The original text, for the record: there was ~~**no** `clearSynthetic` or `includeSynthetic` in `integrator-longitudinal.js`~~ /
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
`deviceScoredAHI` at `integrator-dsp.js:6060`–`:6070`; `findings.sort` nulls-last at `:5936`).
**`schema.version` now reads `'1.3'`, not the `1.2` this line originally said** — it moved again after
that bump.

> **Update 2026-08-04 (backlog sweep): items 1 and 2 are CLOSED; only 3 and 4 remain open owner
> decisions.** `INTEGRATOR-EXPORT-FIX-BRIEF.md` was stamped DONE on the strength of this. Items 1–2 are
> kept below with their resolution appended rather than deleted, so the decision history stays readable.

1. ~~**🔴 Suite-wide blank-on-print/PDF/export.**~~ ✅ **CLOSED** — fixed and gated by
   `BLANK-ON-PRINT-FLEET-2026-08-03-BRIEF.md` (DONE 2026-08-03; the guard's gate *derives* its expectation
   from `ans-design.css` and is mutant-verified ×5). **The description below is inverted and is kept only
   as history:** measured 2026-08-04, `entrance-guard.js` ships in **all 8 nodes** (src *and* bundle) and
   **not** in the Integrator, which keeps its own scoped injected CSS (`integrator-render.js:28–37`).
   `ans-design.css` was deliberately left untouched, so the "re-bundle all 7 + regenerate fixtures" cost
   priced here was never paid — and that pricing is itself stale (`buildHash` is retired; `manifestHash`
   is the identity). *Original text:* `ans-design.css` animates `.main-content`/`.chart-card`/
   `.kpi` **from `opacity:0` with `fill:both`**, so frozen-timeline contexts (print, PDF, capture,
   throttled tab) render blank. Only the Integrator was patched; the other six apps still blank out.
2. ~~**Badge-coverage audit of the other six apps.**~~ ✅ **CLOSED** — `BADGE-COVERAGE-AUDIT-BRIEF.md`,
   DONE **2026-06-23**, i.e. the sweep this item asks for had already run when the item was written.
   ⚠️ Note for anyone re-checking it: node UIs reach badges via the mandated indirection
   `evBadge(…)` → `<Node>Registry.badgeForLabel(label, fallback)` → `MetricRegistry.badge()`. Counting
   `.badge(` call sites or `class="ev ev-"` occurrences measures the wrong thing and will report
   false non-compliance (`class="ev ev-"` in a bundle is mostly **CSS rules**, not markup).
   *Original text:* the 🔴 coverage mandate was only made compliant in the Integrator; audit
   OxyDex/HRVDex/PulseDex/GlucoDex/ECGDex/CPAPDex for unbadged surfaces.
3. ~~**`Integrator.src.html` has 3 duplicate `<nav class="mobile-nav">` blocks**~~ ✅ **EXECUTED
   2026-08-04** in `015dc82` (#824) — see the detailed §4.3 correction in the header block above.
   Verified in the tree after that landed: **exactly 1** `<nav class="mobile-nav">` element remains
   (down from 3), counted as elements — note the bare string `mobile-nav` appears 22× and is mostly CSS,
   so counting occurrences measures the wrong thing.

   Its stated blocker was **obsolete**: the cost was priced in `buildHash`, which Phase 7 retired as a
   provenance signal eight days after this item was written. The two fusion fixtures (there are **2**,
   not 3) are `historical: true` — byte-pinned, no `manifestHash`, no `inputHashes` — so a markup change
   could not have flipped them. They were also never true duplicates: only `.mnav-item` is styled, so
   the dead pair rendered unstyled and half-overlapping until `bindNav` deleted them on every boot.
4. **Fusion-finding evidence tiers are author-assigned, not test-backed** (`FINDING_EVIDENCE` in
   `integrator-render.js`). ⚠️ **Premise largely OVERTAKEN 2026-08-04** — the "not test-backed" half is
   no longer true: `tests/dex-tests.js:6466`–`:6504` parses `FINDING_EVIDENCE` straight out of the
   renderer and asserts **every emitted finding type carries a grade**, with a non-vacuity assertion at
   `:6495` (it anchors on the *declaration*, not the bare name, because prose above `FINDING_EVIDENCE`
   mentions `TYPE_EV`). That gate landed with `changes/2026-08-04-fusion-finding-grades.md`, after
   `staging_disagreement` was found rendering with **no badge at all**. Tiers are no longer assigned
   locally either — `staging_disagreement`'s is documented as **INHERITED** from `ECG_REGISTRY` per
   `CLAUDE.md` §🎫 (a disagreement between two `heuristic` estimators cannot be stronger evidence than
   its inputs). **Genuinely remaining:** owner ratification of the other five grades, and confirming each
   traces to an owning node registry the way `staging_disagreement` now does. Still an owner decision —
   tier assignment is a NODE fact, never assigned in a sweep.

---

## 5. DEX-SUITE-EXTERNAL-REVIEW-v2 — remaining improvement list (mostly data/cosmetic)

With the BP leak closed, the review's top item is done. Remaining (in their order):
1. **Publish one external agreement number** — paired-PSG cohort → Bland–Altman ODI-4-vs-PSG-ODI. The
   harness already ingests it; this is the highest trust-per-effort item but **data-gated** (no PSG
   dataset committed).
2. **Kubios/NeuroKit2 cross-check** on RR the harness already re-detects (converts §B from "method
   correct" to "agrees with the reference"). Also data/tooling-gated.
3. ~~**Sweep orphaned research-depth render rows.**~~ ✅ **ANSWERED 2026-08-04 — and it turned up one
   row this item did not name.** The confirm it asks for: `VO₂ base` and `VO₂ adj` **do** resolve
   badges — both `heuristic` (*"Uth–Sørensen HR-ratio VO₂ estimate"* / *"HRV→VO₂max estimate —
   population proxy"*). No demote/remove needed.

   Measured, not read: the whole `rows` table (`pulsedex-render.js:205`–`:348`, rendered at `:351`–`:354`
   where every row does `${evBadge(m)}${m}`) was scanned by **executing** `PulseRegistry.badgeForLabel(label, true)`
   — called with the second `fallback` arg exactly as `evBadge` at `:20`–`:22` passes it, since
   `badgeForLabel(l)` alone gives a different answer. Result: **68 labels scanned, 63 badged, 5 not**
   (probe non-vacuous — 63 badges produced, so a zero result would have been a failed scan, not a clean one).

   All 5 unbadged labels are **BY DESIGN**, and the scan result is exactly the designed behaviour:
   `DateTime` · `Recording` · `Duration` · `VO₂ GT` are all verbatim keys of **`_META_DENY`** in
   `pulsedex-registry.js:231`–`:244` — *"Pure metadata / non-metric rows — never badge even with
   fallback"* — and `— ADVANCED / RESEARCH —` is a section separator, not a row. The deny list is
   consulted inside `badgeForLabel` itself (`if (fallback && !_META_DENY[_norm(label)])`), so these
   return `''` **deliberately**, not by falling through a guard. The mechanism is gate-backed:
   `tests/dex-tests.js:5608` pins it — *"metadata Date must STAY bare (a badge on a date is meaningless
   — the `_META_DENY` path)"*.

   > ⚠️ **RETRACTED 2026-08-04 — an earlier version of this item called `VO₂ GT` "a real finding" and an
   > unbadged-number bug. It is not, and no fix is owed.** The classification is coherent: `VO₂ GT` is a
   > *user-entered laboratory reference value*, not a PulseDex-computed output, so it sits with `date` /
   > `source` / `duration` / `active flags` as recording context. The §🎫 mandate covers measurements the
   > node **surfaces as its own**; a value the user types in as ground truth is an input, the same
   > reading §7 already applies to the user-entered cuff `p.sbp`/`p.dbp`. It is also **not** the
   > `staging_disagreement` class it was compared to — that one was absent from its grade map and fell
   > through a `!key` guard silently; this one is named in an explicit deny list with a comment.
   >
   > **How the false positive happened, so the next sweep doesn't repeat it:** the probe was right
   > (`badgeForLabel(label, true)`, correct second arg, non-vacuous) and the *interpretation* was wrong —
   > an empty return was read as "unbadged" without asking whether empty was **intended**. The deny list
   > is twenty lines above `badgeForLabel` in the same file. The tell was in the output and was
   > hand-waved: 4 of the 5 unbadged labels were exact `_META_DENY` keys, i.e. the scan had rediscovered
   > the deny list. **Executing the call is not the same as understanding the answer** — when a scan's
   > result matches a list the code already maintains, check for that list before reporting a bug.

   ✅ **RECLASSIFIED 2026-08-04 — the owner took exactly that option, so the deny-list state above is now
   HISTORY.** This is a deliberate re-classification, not the bug fix the retracted finding asked for, and
   the distinction is the point: nothing was broken, the tier was simply wrong.

   **The argument that carried it:** entered-ness is not a tier — *provenance* is. `VO₂ GT` is a real
   laboratory VO₂max and the only **directly measured** value in this table; the two estimates beside it
   (`vo2`, `vo2base`) are `heuristic` population proxies, and this is the CPET number they are proxies
   **for**. Denying it left the single most-evidenced number in the table as the only unbadged one, sitting
   next to two badged guesses at it. `measured` is honest precisely *because* PulseDex does not compute it.

   **What shipped:** both `'vo₂ gt'`/`'vo2 gt'` keys removed from `_META_DENY` (with a do-not-re-add note),
   a `vo2gt` entry added to `PULSE_REGISTRY` (`evidence: 'measured'`, `depth: 'research'`, cited), and the
   two label aliases. Verified by execution, not reading — the same 68-row scan now reports **64 badged, 4
   unbadged**, and the 4 are `DateTime` · `Recording` · `Duration` · the section separator, i.e. genuine
   metadata only. `VO₂ GT` resolves `id=vo2gt`, tier `measured`.

   **Gates:** PulseDex re-bundled (`manifestHash 954546478f4d → b194b9db26fb`). `computeHash` **also** moved
   (`bb8ff7dd1faf → 6ecbd5da2dc2`) — the registry sits inside the compute closure — so re-verification was
   **owed and performed**, not asserted: `DEX_UPLOADS=… node tools/verify-fixtures.mjs` re-ran the real
   corpus green and re-stamped the two corpus-backed fixtures' `verifiedUnder`. The suite passing is what
   proves the export bytes did **not** move; only the closure hash did. Full `npm run check` green — 5,650
   assertions / 373 groups, GATE A 9/9, GATE B 29 reproducible / 0 drift, `docs/` + analysis current.

   ⚠️ Also note this item's line reference was stale: the VO₂ rows are at `:258`–`:260`, not `~L194–195`.
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
  ✅ **BUILT 2026-08-08 (#1016); GENERATOR-FOLLOWUPS-II is DONE.** ⚠️ The entry that stood here was
  wrong in all three of its parts and is corrected rather than deleted, because a reader following it
  would have declined to do work that was already worth doing: (1) it cited a *"decision comment on
  `ecgdex-app.js genSynthetic`"* that **never existed** (`git log -S` empty over all branches);
  (2) ECGDex no longer "stays single-recording" — it rides the shared profile+days axis, 1–3 nights;
  and (3) the reopen condition ("only if raw-µV multi-night coherence becomes a real product need")
  rested on a false premise. It was never a product-value question: `renderECGInt16` was already
  factored out, into `cohort-full.js` — a FULL-lane-**worker** file `ECGDex.src.html` cannot load. The
  capability existed and the app could not reach it.

---

## Suggested order
§1 (Integrator synthetic filter — clean, self-contained) → §2 (GlucoDex `HH:MM:SS`) → §7 verifies
(HRVDex profile BP, PulseDex caption) → then schedule the **§6 re-bundle sweep** as one deliberate
package and fold §3, §4.1, §4.2 into it. §5 items are data/cosmetic and can trail. Run both gates
after every re-bundle; keep `BUILD-MANIFEST.json` in lockstep with the bundles (that's what gives
GATE A teeth).

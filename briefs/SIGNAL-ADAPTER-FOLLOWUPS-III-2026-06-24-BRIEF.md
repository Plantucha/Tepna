<!--
  SIGNAL-ADAPTER-FOLLOWUPS-III-2026-06-24-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-25 (§1 native Baevsky guard + §2 audit-only note + §3 all four `-II` hooks closed) · **Created:** 2026-06-24 · **Follows:** SIGNAL-ADAPTER-FOLLOWUPS-2026-06-24-BRIEF.md (§4 HRVDex leg) · **Sibling-of:** SIGNAL-ADAPTER-FOLLOWUPS-II-2026-06-24-BRIEF.md

# Signal-adapter Phase-9 — follow-ups III (what the HRVDex leg exposed)

> Round III. `-II` was written during the **PulseDex/OxyDex** legs and PRE-REGISTERED four HRVDex hooks
> (its §§6–9) with "when the HRVDex adapter lands" language. The HRVDex leg has now landed
> (`HRVDex.compute` + `adapters/welltory-summary.js` + the Baevsky guard + black-box `derived` tagging +
> `hrvHost`/`emitSummaryNodeExport`, HRVDex re-bundled manifestHash `e4771b6a6289→167894a53541`,
> Dex-Test-Suite all-green, GATE A/B clean). This file captures **TWO genuinely-new issues the landing
> exposed that `-II` did NOT anticipate** (§§1–2 below — and §1 is a REAL CORRECTNESS gap, the only item
> in either round that needs a node `*-dsp.js` edit + re-bundle), then **activates the four `-II` hooks**
> that the landing turns from "later" into "do-now" (§3). Read `CLAUDE.md` first; both gates + the Clock
> Contract still rule. Do NOT edit `-II` — it stays the home for the PulseDex/OxyDex residue (its §§1–5).

---

## 1 · 🔴 HIGHEST — the Baevsky unit guard protects ONLY the adapter path; HRVDex.html's OWN Stress Index is still unguarded (NODE fix → re-bundle + gates)

> **✅ DONE — 2026-06-25.** `computeDerived` (hrvdex-dsp.js) now computes `d_si`/`d_csi` from the SAME
> `DexUnits.guardBaevsky` / `baevskySI` the welltory-summary adapter uses — Mode/MxDMn are normalized to
> seconds (ms-band auto-detected) before the Stress Index, and the per-row `d_si_ms`/`d_si_flagged` flags
> are surfaced as a Baevsky alert in `hrvdex-render.js` (surfaced, never silently scaled). `quantity.js`
> was added to `HRVDex.src.html` (single-source of the guard; threshold read from `DexUnits.RR_MS_THRESHOLD`,
> not forked). For a SECONDS-unit file the values are byte-identical to before (no fixture drift); the fix
> bites only on ms-unit files (incl. the ECGDex-JSON ingest path `_envToSeed`). Folded the same re-bundle
> with §8 #2 (zero-seed composite gate) + §8 #5 (black-box composite lower-tier) below. New dex-tests:
> a ms-row vs seconds-row **d_si parity** known-answer + the ms row flagged (BOTH runners, functional via
> `DexUnits`), plus source-mirror locks on the computeDerived wiring + the zero-seed gates. HRVDex
> re-bundled manifestHash `b06db90abaa7→dd380264fcef` (buildHash `de20db283366` UNCHANGED — no inline
> script/style edit; `BUILD-MANIFEST.json` GATE A updated). HRVDex still has NO code-gated fixtures
> (uploads/* pre-R1 'no provenance' — confirmed, GATE B unaffected). Dex-Test-Suite all-green (950/64);
> verify-provenance GATE A PASS (8/8) + GATE B clean.

**What surfaced — a correctness ASYMMETRY, not a cosmetic.** The HRVDex leg added
`DexUnits.guardBaevsky`/`baevskySI` at the **adapter ingest boundary** in `adapters/welltory-summary.js`,
so a Welltory summary CSV dropped into the **Data Unifier / OverDex** gets `Mode`/`MxDMn` normalized to
seconds and a unit-safe Stress Index per row. **But HRVDex.html's own direct-load path does NOT go
through the adapter** — it runs `parseCSV → commitRows → computeDerived`, and `computeDerived` computes
the Baevsky SI itself, UNGUARDED:

```js
// hrvdex-dsp.js  (computeDerived, ~line 341)
r.d_si = (r._amo50 && r._mode && r._mxdmn) ? r._amo50 / (2 * r._mode * r._mxdmn) : NaN;   // raw _mode/_mxdmn — no guard
// …and the CSI right below it (~line 378) hard-ASSUMES seconds:
r.d_csi = meanRR_s > 0 ? r._mxdmn / meanRR_s : NaN;                                       // "assumes _mxdmn is in SECONDS (as exported by Welltory)"
```

So the **same recording** yields a guarded SI through the orchestrator and an **unguarded SI in
HRVDex.html** — and `quantity.js`'s own header is explicit that a **milliseconds** `Mode`/`MxDMn` export
mis-scales `d_si` "by up to 10⁶×" and `d_csi` "by ~10³×" ("plausible but wrong"). The guard exists
*precisely because ms-unit files occur in the wild*; leaving the native path unguarded means HRVDex.html
mis-reports SI/CSI on exactly the files the guard was built for. The leg fixed the new path and left the
**oldest, most-used path (the app itself) carrying the original bug.** This is the one open item in
rounds II/III that is a genuine wrong-number risk rather than a doc/test/decision.

**Do.** Make `computeDerived` consume the SAME guard the adapter uses, so there is ONE unit-safe SI/CSI
math the whole suite shares (mirrors the "one shared builder" principle the leg already applied to the
export):
- Have `computeDerived` (or the row-seed step that feeds it) call `DexUnits.guardBaevsky(_mode,_mxdmn)`
  → `{modeS, mxdmnS, assumedMs, flagged}` and compute `d_si`/`d_csi` from the **normalized seconds**
  values, surfacing `flagged` rows in the UI instead of silently scaling (same contract as the adapter).
- Keep it back-compat: HRVDex's bundle does **not** currently load `quantity.js`, so either add
  `quantity.js` to `HRVDex.src.html` (preferred — single source of the guard) OR, if you want zero new
  bundle deps, mirror the tiny `guardBaevsky` locally with a comment pointing at `DexUnits` as canonical.
  Do NOT fork the threshold constant — read `DexUnits.RR_MS_THRESHOLD`.
- Add a `dex-tests.js` known-answer: a row with **ms** `Mode`/`MxDMn` and a row with **seconds** must
  produce the SAME `d_si` after the guard (parity), and the ms row must be `flagged`/normalized.

**Done when.** `computeDerived`'s SI/CSI are guard-normalized; native-path and adapter-path SI agree on a
ms-unit fixture; the parity test is green in BOTH runners. **Gate cost — REAL:** this edits
`hrvdex-dsp.js` (a node DSP) → **re-bundle HRVDex.html**, update its `manifestHash` in
`BUILD-MANIFEST.json` (GATE A), and if it loads `quantity.js` confirm `buildHash` movement expectations.
Because it changes a *computed metric value*, **regenerate any HRVDex code-gated fixture** (re-run +
re-export, re-record `manifestHash` in `FIXTURE-PROVENANCE.json`, GATE B) — though as of the leg HRVDex
has no code-gated fixtures (pre-R1 'no provenance'), so confirm that still holds before relying on it.
Run `Dex-Test-Suite.html` all-green + `verify-provenance.html` GATE A/B clean before stamping.

## 2 · ✅ DONE (2026-06-25, cheap doc-note taken) — the black-box `meta.derived` tag is AUDIT-ONLY today, now stated as such

**What surfaced.** The leg tags the `stress_high` event `meta.derived:true` at the `'heuristic'` tier
(and `provenance.derived:true` on the frame) so "the Integrator never treats a vendor composite as a
measured fact" (the comment's words). But auditing `integrator-dsp.js` shows the fusion side **does not
read event `meta.derived` or `meta.evidence` at all**: `effConf()` attenuates a surge's `conf` by its
local `sqi` only, and the evidence-grade system (`GRADE_MIRROR`/`gradeFor`) is keyed on **metric
id↔node↔registry**, for *display badges*, not on per-event `meta`. So right now a derived
vendor-composite `stress_high` event fuses with the **same weight** as a measured event — the tag is
provenance-honest for the export audit trail, but has **zero effect on fusion**. The leg's stated intent
("never treats a composite as measured") is therefore **not yet enforced anywhere**.

**Do (decision + small wire-up).** Pick one and record it:
> **✅ RESOLVED 2026-06-25 — cheap doc-note taken (the recommended option).** An explicit
> "audit-only / not yet consumed by fusion" note now sits BOTH at the emit site
> (`adapters/welltory-summary.js`, beside the `provenance.derived` stamp) AND in
> `integrator-dsp.js` (on `effConf`'s header) so the next coder doesn't assume `meta.derived`
> is load-bearing in the posterior. The real fusion-side down-weight (wiring `effConf` to
> attenuate `meta.derived` events + a posterior-ordering test) is scheduled for the next
> Integrator pass — NOT folded here (it's a separate Integrator re-bundle). Comment-only edits
> → no re-bundle, both gates untouched (the `integrator-dsp.js` source comment is documentation
> for the next reader; the shipped bundle is unchanged so GATE A/B stay green).
- **(preferred) Wire it:** have `effConf()` (or the noisy-OR likelihood step) down-weight events carrying
  `meta.derived === true` (e.g. an extra attenuation factor, or floor their `conf` to the heuristic
  tier's ceiling), so a derived composite genuinely contributes less evidence than a measured surge. Add
  a `dex-tests.js` assertion that a `derived` event fuses to a strictly lower posterior than an identical
  non-derived one. This is an `integrator-dsp.js` edit → **re-bundle the Integrator + GATE A/B**, so size
  it as its own pass (don't fold into §1's HRVDex re-bundle).
- **(cheaper) Document it:** if fusion-side down-weighting is out of scope now, add a one-line note at the
  HRVDex emit site AND in `integrator-dsp.js` that `meta.derived` is currently **audit-only / not yet
  consumed by fusion**, so the next coder doesn't assume the tag is load-bearing. Zero gate cost.

**Done when.** Either `effConf`/fusion provably down-weights `meta.derived` events (tested), or both the
emitter and the Integrator carry an explicit "audit-only, not fused" note. **Recommendation:** do the
cheap doc-note now (so the intent isn't silently false), and schedule the real wire-up with the next
Integrator pass.

## 3 · ✅ DONE (2026-06-25) — the four `-II` hooks the HRVDex landing activated are CLOSED (in `-II`)

The landing flips four pre-registered `-II` items from "when it lands" to actionable. They are NOT
re-described here — execute them in `-II` and flip its checkboxes; this section is the trigger record:
- **`-II` §7** — write `how-to-collect/welltory-hrv.md` (the adapter has landed): export steps, the
  `detect()` rule (Welltory mark / `Stress(HRV)`+`ANS balance` header → 0.95; generic rMSSD+SDNN+Mode →
  0.85), and the **Welltory DMY-default** + **Baevsky ms-vs-s** Clock-Contract caveats. Pairs with the
  still-owed `oxydex-spo2.md`. *Zero gate cost.*
- **`-II` §8** — add the `SignalSpec.hrv.dsp` resolver-identity assertion (the leg wired
  `{parse, rows, compute}` but nothing locks it to `HRVDex.parseRows`/`.compute`; a rename silently
  no-ops routing). Browser-rig only (bare globals). *Zero gate cost.*
- **`-II` §4** — `signal-orchestrate.js` now hosts a THIRD signal (HRV) yet still self-titles "RR
  orchestration"; re-title the header (comment-only, no re-bundle) and consider collapsing
  `emitRR/emitSpO2/emitSummaryNodeExport` into one `signalType`-dispatched `emitNodeExport(frame)`.
- **`-II` §5** — the per-node display one-liner is now branched in THREE places (OverDex `_computedDetail`,
  Unifier `_emitNote`, both now carry an `hrv` branch); fold into one `nodeExportSummary(exp)` keyed on
  `exp.schema.node`. *Zero gate cost (unbundled tools).*
- **`-II` §9** — refresh the DSP-purity allow-list reason for `hrvdex-dsp.js` (its reading+compute path is
  now pure; the residual DOM/`localStorage` is the intentional `commitRows`/`persistHRVRows` app-commit
  path, NOT a migrate-TODO). *Zero gate cost.*

And one **reinforcement, not a new task:** `-II` §1 (an automated `compute() ≡ app-export` equivalence
gate) explicitly wanted to land **before** the 3rd node so it could catch app-vs-compute drift
automatically. HRVDex landed **without** it — so HRVDex's `compute()` ≡ `exportGanglior` equivalence is,
for a THIRD time, guaranteed only by-construction (one shared `hrvBuildNodeExport`) + a one-time sandbox
check run during the leg. `-II` §1 is now the highest-value test-only item across both rounds; do it
next and include HRVDex in the equivalence rig.

---

### Gate posture for this brief
- **§1 is the only item across rounds II+III that requires a node re-bundle** (`hrvdex-dsp.js` →
  HRVDex.html → GATE A manifestHash + GATE B if a code-gated fixture appears). Treat it as a real,
  gated pass, not a drive-by.
- **§2** is either an Integrator re-bundle (if wired) or a zero-cost doc note (if deferred) — do NOT fold
  the wired version into §1's HRVDex re-bundle; they are different bundles.
- **§3** is all `-II` execution (mostly zero gate cost; re-run `Dex-Test-Suite.html` green).
Stamp `Status: DONE` in this header only once the items you executed meet their "Done when" AND
`Dex-Test-Suite.html` is all-green + `verify-provenance.html` GATE A/B is clean. Index in `DOCS-INDEX.md`
and flip the matching `-II` checkboxes for any §3 hook you close.

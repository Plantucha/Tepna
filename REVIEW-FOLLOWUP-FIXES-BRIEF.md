<!--
  REVIEW-FOLLOWUP-FIXES-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# Build Brief — External-Review Follow-up Fixes

> **For a fresh AI coder.** Read `CLAUDE.md` first (the two gates, the Clock Contract, the
> build-then-bundle rule, the frozen `Ganglior` codename). Then skim `DEX-SUITE-REVIEW-RESPONSE.md`
> (what the review pass already did — all 10 items closed) and the three audit docs it produced
> (`DEX-DSP-AUDIT-FREQ-HRV.md`, `DEX-DSP-AUDIT-BEATS-ARTIFACT.md`, `DEX-VALIDATION-STATUS.md`). This
> brief is the **loose-ends list** discovered *during* that pass — things deliberately not fixed then,
> ordered by impact. Each item: what's wrong · where · why it matters · the fix · the gate.

**Status:** DONE — 2026-06-23 · **Created:** 2026-06-21 · **Author of brief:** review-pass agent
**Standing rules for every item:** edit the `.js` / `.src.html`, never the bundled `.html`; re-bundle
after changes via the inliner; run `Dex-Test-Suite.html` (must stay all-green) and, after any
re-bundle, `verify-provenance.html` (no red verdicts). Keep node-export back-compat (add params LAST +
optional; new return data via NEW fields).

<!-- VERIFICATION LOG (2026-06-23) — re-verify pass; every substantive P0–P3 item confirmed shipped in
     the live source, gates green. No new code change was needed (the fixes landed across prior sessions;
     this pass only verified + flipped the header). Evidence:
     • P0  BUILD-MANIFEST.json present + verify-provenance GATE A asserts current manifestHash == committed
           for all 8 bundles (exercised live this session — GATE A PASS, GATE B "reproducible ✓ code-gated").
           The fuller buildHash/manifestHash provenance reality is now documented in CLAUDE.md.
     • P1a ecgdex-dsp.js defines the full parseTimestamp mirror (L51) + exports ECGDSP.parseTimestamp
           (L1705); tests/dex-tests.js WP-G "parseTimestamp per-node conformance" group runs the shared
           truth table against it. Hot path keeps the parseTSfloat epoch fast-path (documented).
     • P1b uploads/ holds ZERO *.js / *.mjs source duplicates (only genuine data exports remain).
     • P2  computeBPProjection REMOVED (oxydex-dsp.js, no caller); oxyAnsAgeProxy()/oxyProjAgeCard()
           deleted (oxydex-fusion.js); renderANSAgeCard() is a no-op tolerating the deleted #ansAgeCard/
           #ansAgeProjGrid DOM; the hrvdex-render if(false) BP-chart block is gone (no source hits).
           WP-D2 "Optical beat detector — known-answer" group present (PPGDSP.detectBeats/buildPPI/correctRR).
     • P3a tests/dex-tests.js "Null personalization fields tolerated end-to-end" pins ansAge/metabolicAge/
           bpProj = null through adaptEnvelopeNode → runFusion (no throw, findings array returned).
     GATES this session: Dex-Test-Suite.html ALL GREEN (827 passed / 53 groups, 0 failing — needs ~165 s
     to fully settle); verify-provenance.html GATE A + B clean.

     DISCOVERED (recorded here in lieu of an empty follow-up brief — both minor/by-design):
     1. GlucoDex #metAgeCard "Projected Metabolic Age" is NOT a stale label as P2 assumed — it is a LIVE,
        heuristic-badged CGM metric (mean-glucose + CV + TIR composite vs age; glucodex-profile.js §9),
        distinct from the retired HRV-derived ANS-age cluster. Correctly left in place. P2's stale-label
        concern applied only to the HRV/ECG/PPG ANS-age DOM, which IS deleted.
     2. P3 "(Optional) cross-node spectral-grid unification" is explicitly cosmetic (band integrals are
        robust to the differing LS grids; detrend + Parseval already consistent) and is deliberately NOT
        done. Reopen only if identical cross-node frequency resolution is ever wanted. -->


---

## P0 — `buildHash` doesn't fingerprint code, and the fixture gate trusts it

**What's wrong.** `ganglior-provenance.js` `buildSource()` is *supposed* to hash the immutable
`<script type="__bundler/template">`. But at **runtime the inliner's loader strips the manifest AND
template from the live DOM** (it `replaceWith`s the unpacked document). By the time
`ganglior-provenance.js` runs (it's a template script), neither exists — so `buildSource()` silently
falls through to **concatenated inline `<script>/<style>` text only**. Proven this pass: editing
`OxyDex.src.html`'s body (the disclaimer) and re-bundling left the runtime `buildHash`
**unchanged** (`10060a2b3aaa`). Consequences:
- `buildHash` does **not** move when you change any external `*.js`, nor on body-HTML edits — it
  tracks roughly the inline CSS/JS only. It barely fingerprints anything.
- `verify-provenance.html` **GATE B** (fixture reproducibility) compares each committed
  `uploads/*.json`'s stamped `buildHash` against the current runtime `buildHash`. Because the latter
  is near-static, **GATE B can report "reproducible ✓" for an export whose real code changed.** The
  WP-F `manifestHash` column already exposes the true drift (it moved `52eed3a0…`→`04f7275f…` on that
  same OxyDex edit) but **nothing gates on it yet.**

**Why it matters.** This is the actual "provenance hole" the external review (#7) was pointing at,
deeper than its "template-only" framing. Right now build-provenance is largely decorative.

**The fix (recommended, lowest-risk — build-manifest gate):**
1. Add a committed **`BUILD-MANIFEST.json`** = `{ "OxyDex.html": {buildHash, manifestHash}, … }` for
   all 8 bundles (compute `manifestHash` exactly as `verify-provenance.html`'s `manifestHashOf()`
   does — SHA-256[0:12] of the file's `__bundler/manifest`).
2. Make `verify-provenance.html` **GATE A** assert each bundle's *current* `manifestHash` equals the
   committed one → forces a re-bundle whenever ANY module changes (closes the drift hole at build
   time). Keep `buildHash` in the table for continuity but stop treating it as the code fingerprint.
3. Leave GATE B (export attribution) keyed on `buildHash` only if you also do the stretch goal;
   otherwise note in the page that GATE A (manifestHash) is the authoritative code-drift check.

**The fix (stretch — runtime code hash in exports):** make the executed code self-fingerprint so
*exports* carry it. The loader (generated by the inliner) is the only place with the manifest text
before it's stripped — either (a) have the bootstrap stash `window.__bundlerManifestText` /
its hash before `replaceWith`, then `ganglior-provenance.js` reads it into a real `codeHash` stamped
into `provenance`; or (b) on `window.load`, fetch every `<script src=blob:>` body and hash the
concatenation. (a) is cleaner but touches the inliner template; (b) is self-contained but fiddly
(async, blob lifetime). Only then can GATE B verify code, not skeleton.

**Gate.** `verify-provenance.html` green with the new GATE A; re-bundle nothing for the page edit
(it's a tool). If you do the stretch runtime hash, re-bundle all 8 + regenerate the manifest.

---

## P1 — ECGDex has no `parseTimestamp` copy; Clock-Contract coverage gap

**What's wrong.** All other nodes define `parseTimestamp` in their `*-dsp.js`
(pulsedex/oxydex/hrvdex/integrator/glucodex/cpapdex/ppgdex). **`ecgdex-dsp.js` has none.** ECGDex
ingests Polar Sensor Logger ECG (`…;timestamp [ms];ecg [uV]`, ~130 Hz) and per CLAUDE.md must honor
the Clock Contract, so its parser lives somewhere else (likely `ecgdex-cross.js`, `ecgdex-app.js`,
or a worker). The WP-G conformance group (`tests/dex-tests.js`, group `WP-G`) could not reach or
static-check it.

**Why it matters.** ECGDex is the node whose capture provenance the Clock Contract section calls out
explicitly (Polar Sensor Logger stamps). If its time parsing diverges from the canonical resolution
order, cross-node sync (the whole point of floating `tMs`) breaks for ECG.

**The fix.**
1. Locate ECGDex's stamp parsing (`grep -n "Date.UTC\|parseTimestamp\|getUTC" ecgdex-*.js`). Confirm
   it: floating wall-clock `tMs` via `Date.UTC`, the vendor-format regexes, **never** `new Date(str)`
   /`Date.parse` on vendor strings, `null` on miss (never `now()`).
2. If it's a full mirror, **expose it** on a namespace the test can reach (e.g. `ECGDSP.parseTimestamp`
   or `ECGCross.parseTimestamp` — additive export) and add it to the WP-G group's live truth-table
   loop + the static-source list. If ECGDex relies on a *different* parser shape, document why and
   bring it under the same truth table.

**Gate.** `Dex-Test-Suite.html` WP-G group green with the ECG copy included; `node
tests/run-tests.mjs` parity. If the export was additive-only, no re-bundle needed; if you touched
`ecgdex-dsp.js` behavior, re-bundle ECGDex.

---

## P1 — Stale duplicate source files in `uploads/`

**What's wrong.** `uploads/` holds **stale copies of shipped source**, e.g. `uploads/ppgdex-dsp.js`
(still the pre-parity mean-only `lombScargle` — before the WP-C fix), `uploads/ecgdex-dsp.js`,
`uploads/derive-sigma-window.mjs`. They shadow the real files in greps and invite editing the wrong
copy.

**Why it matters.** `uploads/` is gitignored so nothing ships, but it's a live footgun: a future
agent grepping `lombScargle` gets two hits with different code. One already diverged this pass.

**The fix.** Delete the source/script duplicates under `uploads/` (`*.js`, `*.mjs` that mirror a
root file). Keep genuine data exports (`*.json`, `*.csv`, Polar `*.txt`). Confirm nothing references
the `uploads/` copies (`grep -rn "uploads/.*\.js"`). Low risk.

**Gate.** None (gitignored, non-shipping); just re-run `Dex-Test-Suite.html` to confirm the real
sources are still the ones loaded.

---

## P2 — Dead code left from metric removal (WP-A intentionally disabled, didn't delete)

**What's wrong.** To keep WP-A JS-only/hash-safe, removed metrics were **neutered, not deleted**:
- `oxydex-fusion.js`: `oxyProjAgeCard()` returns `''` then has a dead body; `oxyAnsAgeProxy()` now
  unused.
- `hrvdex-render.js`: the BP chart block is wrapped in `if (false) { … }` (six `ch_sbp_*`/`ch_bp_*`
  builders).
- `*-profile.js` (hrv/ecg/ppg) + `pulsedex-overview.js`: `renderAnsAge`/`renderMetAge` early-return
  with dead bodies.
- DSP: `computeBPProjection` (oxydex-dsp) is no longer called (`bpProj` set to `null`); ANS-age
  compute helpers may be dead.
- `*.src.html`: the now-empty BP **chart canvases** (`ch_sbp_trend`, `ch_bp_components`, etc.) and the
  ANS/Metabolic-age **card DOM** (`#ansAgeCard`, `#metAgeCard`, …) still exist, just hidden.

**Why it matters.** Pure tech debt + confusion; the hidden DOM also still carries stale labels (the
GlucoDex `#metAgeCard` literally says "Projected Metabolic Age").

**The fix.** Delete the inert bodies and the orphaned DOM. **Note:** removing canvases/cards from
`*.src.html` MOVES the static `manifestHash` (and may move `buildHash` only if you touch inline
script/style) — so do all of a node's deletions in ONE pass and re-bundle once. Per the P0 finding,
a body/DOM-only deletion will NOT move the runtime `buildHash`, so the committed fixtures stay
`reproducible ✓` (verified this pass) — but re-check `verify-provenance.html` anyway.

**Gate.** `Dex-Test-Suite.html` green (esp. `cohesion-badges` — confirm no orphaned grade after DOM
deletion); re-bundle each touched app; `verify-provenance.html` no red.

---

## P2 — Beat-detection test coverage is uneven (optical detector unguarded)

**What's wrong.** The WP-D known-answer test only reaches `ECGDSP.buildNN` (the one exported cleaner).
**Not** covered: PulseDex `artifactClean`, PpgDex `buildPPI`, and especially PpgDex `detectBeats`
(the autocorrelation-primed optical peak detector) — the noisiest, least-validated estimator in the
suite, with no known-answer test for peak placement.

**Why it matters.** Per the review, "HRV is dominated by beat-detection." ECG is guarded; the optical
path is not.

**The fix.**
1. Additively export `detectBeats` (already on PPGDSP) usage + `buildPPI` on PPGDSP, and
   `artifactClean` on a PulseDex namespace (PulseDex DSP isn't currently loaded into the test ctx —
   either load `pulsedex-dsp.js` in `run-tests.mjs`'s setup + `Dex-Test-Suite.html`, or static-check
   only).
2. Add a `WP-D2` group: synth a clean PPG (use `CohortFull`/`SYNTH.renderPPG` or a simple sinusoid at
   a known rate) → `PPGDSP.detectBeats` recovers the expected beat **count ± tolerance** and median
   PPI ≈ the planted rate; inject an ectopic into `buildPPI` and assert correction + `nCorr`
   (mirroring WP-D's `buildNN` test).

**Gate.** `Dex-Test-Suite.html` + `node tests/run-tests.mjs` green. Test-only; no re-bundle.

---

## P3 — Confirm consumers tolerate the nulled export fields (likely fine)

**What's wrong / unverified.** WP-A set `personalization.ansAge` / `bpProj` / `metabolicAge` to
`null` in node exports for back-compat. Consumers — `integrator-dsp.js` (`runFusion`),
`cpapdex-coimport.js`, `oxydex-fusion.js` — read these and guard with `!= null`, and the full suite
(incl. Integrator) passed. But no **fusion fixture with a nulled field** was run end-to-end this pass.

**The fix.** Add/realize a fixture: a node export with `ansAge:null` (etc.) → run through
`IntegratorDSP.normalizeFile → runFusion` and `CpapFusion` coimport → assert no throw, sane output.
Fold a one-line assertion into the existing Integrator test group.

**Gate.** `Dex-Test-Suite.html` green.

---

## P3 — (Optional) cross-node spectral-grid unification

Documented in `DEX-DSP-AUDIT-FREQ-HRV.md`: the three Lomb–Scargle copies use different frequency
grids (ECG `nf=300`, Pulse `nf=512`, PPG fixed `df=0.002`). Band integrals are robust to this, so
it's cosmetic — unify only if you want identical resolution across nodes. Detrend + Parseval are now
consistent (PpgDex parity landed this pass).

---

## Suggested order
P0 (provenance gate — highest leverage, mostly tool-side) → P1 (ECGDex clock copy; uploads cleanup —
both cheap) → P2 (dead-code deletion per node + re-bundle; optical-detector test) → P3 (null-consumer
assertion; optional grid unification). P0 and the P2 dead-code deletion are the two that materially
improve the codebase; the rest are hygiene.

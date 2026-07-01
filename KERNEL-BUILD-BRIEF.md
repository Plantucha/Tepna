<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# KERNEL-BUILD-BRIEF.md — Physiology Kernel + Cross-Deployment Hash

**Status:** DONE — 2026-06-23. This is the structural close of **P8 (semantic/constant drift)** and the
capstone of the cross-fleet debugging arc (P1–P12, all else closed — see `AUDIT.md` / test suite).
All 5 steps verified implemented end-to-end: `kernel-constants.js` (Step 1) loads first in every
`*.src.html` + both test runners; constants migrated to `DexKernel.K.*` across all cross/app/dsp/
integrator sites (Step 2); all 8 node exports stamp `kernel:{version,hash}` (Step 3); the Integrator
audits node hashes (`auditNodeKernels` → `fusion.kernelAudit`) and surfaces a visible mismatch banner
in `integrator-app.js` (Step 4); the `Physiology kernel (P8)` suite group asserts hash determinism,
no stray inlined literals, and the behavioral banner (Step 5). **Gates green 2026-06-23:**
`Dex-Test-Suite.html` all-green (792 passed / 49 groups), `verify-provenance.html` GATE A PASS
(8/8 bundles match committed `manifestHash`, no red fixtures). No follow-up brief: nothing surfaced
during execution — the work was already fully landed and bundled; this pass only verified + stamped.

---

## Why (the one paragraph that matters)
The P12 drift-guard in `tests/dex-tests.js` catches divergent constants **within one source tree at
test time**. It CANNOT catch divergence **across deployments**: an OxyDex bundle built last week with
`Z_HEADLINE=1.5` fused with a fresh ECGDex built with `1.2` will "agree with itself" while silently
running two rulebooks. A versioned, content-hashed kernel stamped into every export makes that
mismatch **visible at fusion time** — the only real fix. It also finishes the P8 "physiology kernel":
one source of truth for every threshold, so a refactor can't desync detector vs. classifier.

## Scope — do these in order, re-run `Dex-Test-Suite.html` green after EACH step

### Step 1 — `kernel-constants.js` (new file, plain global, no build step, no TS, no CDN)
Frozen object + version + synchronous content hash. Use a 32-bit FNV-1a (NOT sha256 — offline, and a
content hash detects drift just as well; sha256 isn't worth a dependency). Shape:
```js
(function(g){
  var K = Object.freeze({
    SIGNIF_P:0.10, SIGNIF_TAU:0.15,        // cross-night Mann-Kendall significance
    Z_HEADLINE:1.2, Z_WARN:1, Z_BAD:2,     // baseline z-score thresholds
    ODI_DROP:4, ODI_HYST:2,                // SpO2 desat drop + hysteresis
    MOS_SHORT:5, MOS_LONG:15,              // motion/oscillation windows
    QFLOOR:50                              // HRV consensus quality floor (%)
  });
  function fnv1a(s){ var h=0x811c9dc5; for(var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=(h+((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)))>>>0; } return ('00000000'+h.toString(16)).slice(-8); }
  var KERNEL_VERSION = '1.0.0';
  var KERNEL_HASH = fnv1a(KERNEL_VERSION + '|' + JSON.stringify(K));
  g.DexKernel = { K:K, VERSION:KERNEL_VERSION, HASH:KERNEL_HASH };
})(typeof window!=='undefined'?window:globalThis);
```
Load it FIRST in every `*.src.html` (before the dsp/cross/app scripts) and as the first `loadInto`
in `tests/run-tests.mjs` + first `<script>` in `Dex-Test-Suite.html`.

### Step 2 — migrate constants node-by-node (one node per checkpoint)
Replace each inlined literal with `DexKernel.K.<NAME>`. Known sites (from the P8/P12 audit):
- **Significance** `mk.p<0.10 && Math.abs(mk.tau||0)>0.15` — all 4 cross-modules
  (`ecgdex/oxydex/pulsedex/ppgdex-cross.js`). → `SIGNIF_P`, `SIGNIF_TAU`.
- **Headline z** `Math.abs(z|zLatest)>=1.2` — `ecgdex-app.js`, `ppgdex-app.js`, `pulsedex-app.js`,
  `oxydex-render.js` (this one was the P12 bug, already fixed 1.5→1.2), `crossnight-envelope.js`. → `Z_HEADLINE`.
- **z color** `>=2 bad / >=1 warn` — render sites. → `Z_BAD`, `Z_WARN`.
- **ODI drop / hysteresis** `4` / `2` — `oxydex-dsp.js` desat detector + event detector + MOS. → `ODI_DROP`, `ODI_HYST`.
- **MOS windows** `5` / `15` — `oxydex-dsp.js`. → `MOS_SHORT`, `MOS_LONG`.
- **HRV quality floor** `50` — `integrator-dsp.js` `fuseHRVConsensus`. → `QFLOOR`.
> ⚠️ Mind the Clock Contract files — do NOT touch `parseTimestamp` mirrors or time math. Constants only.
> Re-bundle each app after its node is migrated (edit `.js`+`.src.html`, never the bundled `.html`).

### Step 3 — stamp exports
Every node export writes `kernel:{ version:DexKernel.VERSION, hash:DexKernel.HASH }` in the envelope
(alongside `schema`). Additive — consumers tolerate its absence (legacy exports).

### Step 4 — Integrator mismatch banner (the payoff)
In `integrator-dsp.js` ingest: collect each node's `kernel.hash`. If any node's hash ≠ the
Integrator's own `DexKernel.HASH` (or is missing), surface a visible warning in the fusion output
("⚠ Node X built against kernel <hash>, expected <hash> — thresholds may differ"). This is what makes
"falsely agreeing with itself" impossible to miss.

### Step 5 — suite group "Physiology kernel (P8)" in `tests/dex-tests.js`
- `DexKernel.HASH` is stable / deterministic across two computations.
- No source reintroduces a stray inlined `0.10` / `0.15` / `1.2` / `>=1.5` / bare ODI/MOS literal in
  the migrated sites (static scan, like the existing P12 group — extend it).
- A node export carrying a mismatched `kernel.hash` triggers the Integrator banner (behavioral).
- All migrated modules reference `DexKernel.K` (grep each source has `DexKernel.K.`).

## Done = 
All ~19 suite groups green in BOTH runners (`node tests/run-tests.mjs` + `Dex-Test-Suite.html`),
every app re-bundled, exports carry `kernel{}`, Integrator warns on hash mismatch.

## After the kernel (next frontier, NOT this brief)
**Cross-Dex contradiction modeling** — surface when signals DISAGREE (OxyDex desat with no ECG surge;
PPG-HRV diverging from ECG-HRV beyond quality tolerance), not only when they confirm. Trustworthy
*only because* the kernel guarantees the disagreement is real, not a threshold artifact.

## Pointers
- Test suite: `Dex-Test-Suite.html` (browser) + `tests/run-tests.mjs` (Node CI) share
  `tests/dex-tests.js`. Currently **162 assertions / 18 groups, all green**.
- Bundling: `super_inline_html(<app>.src.html → <app>.html)`. Edit `.js` + `.src.html` only.
- Clock Contract is frozen — see `CLAUDE.md`. Constants migration must not perturb time logic.

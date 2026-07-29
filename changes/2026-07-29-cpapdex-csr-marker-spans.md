<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [CPAPDex]
brief: MULTINIGHT-CORPUS-FINDINGS-2026-07-29-BRIEF.md
---
CPAPDex now measures periodic breathing on the encoding a real device writes. It had reported **`0.00` on all 197 nights of the reference corpus**, including 15 the machine itself scored as Cheyne-Stokes.

**The defect.** `periodicBreathingSec` matched `class === 'Cheyne-Stokes' || 'PeriodicBreathing'` and summed `durSec`. A ResMed AirSense 11 does not write PB that way: it writes a **marker pair** into `*_CSL.edf` — `CSR Start` … `CSR End`, `durSec` **0** on both. `classifyAnnotation` maps both markers to `Cheyne-Stokes` (correct as a class — and the reason the label test alone looked fine), but that collapse erases the only thing that makes the pair a span, and summing `durSec` over two zero-duration markers yields exactly 0. The caller's `durSec > 0 ? … : null` guard could not rescue it: it guards *recording length*, not source presence, so `DEEP-AUDIT-2026-07-14 §7`'s "null on absence, not a measured-looking 0" never fired.

**Why every gate stayed green.** The committed synthetic twin `uploads/20260613_231433_CSL.edf` encodes `+3000 [dur 180] "Cheyne-Stokes"` — one TAL, with a duration, i.e. **exactly the shape the parser expects** — and `cpapdex_synthetic_golden` duly asserts `periodicBreathingPct: 20`. The gate was not lying; it was faithfully proving that the code implements its own assumption. The two committed *real* nights pin `0`, and that 0 is genuinely correct — neither has a CSR span. So the fixture set held one input that could only confirm the bug and two that could not see it. **A synthetic input written from the code under test is a mirror, not a test:** the twin must be adversarial against the *device's* encoding.

**The fix.** `cpapdex-edf.js` gains `annotationBoundary(text) → 'start'|'end'|null`, stamped onto each annotation as an **additive `boundary` field** — `class` is untouched, so every existing reader is unaffected. `periodicBreathingSpans(annotations, sessionDurSec)` pairs the markers in **onset order** and returns `{sec, spans, unpairedStart, unpairedEnd}`; `periodicBreathingSec` keeps its old signature and delegates (`sessionDurSec` added LAST and optional). Both encodings are handled because both are real — a duration-carrying TAL is its own span, a zero-duration marker opens or closes one, and they may coexist in one file. Unpaired edges are resolved rather than dropped: a `Start` still open at end-of-file closes at the session end (real time in PB — discarding it would under-report exactly the worst nights), an `End` with no `Start` is discarded rather than back-dated to zero (which would fabricate an episode reaching to lights-out), repeated `Start`s do not nest, and both counts are surfaced.

Also fixes a grouping defect in `tools/cpap-corpus.mjs` that this exposed: session clustering took the **first** eligible cluster within ±60 s rather than the **nearest**, so on 2026-04-21 (CSL/EVE at 20:56:15 and 20:56:28, waveforms at 20:56:33 — 18 s from the first, 5 s from the second) the waveforms joined the wrong session, leaving the one holding that night's CSR pair with no duration to report against. It was also silently losing scored events.

**Validated against the device's own scoring** (`STR.edf`, whose `CSR` channel is in **minutes**, not percent — reading it as a percentage makes the two sources look 4× apart). Over 197 nights:

| | before | after |
|---|---|---|
| CSR agreement within 1 min | **0 / 15** | **15 / 15** |
| `residualAHI` max \|Δ\| vs device | 4.60 /h | **0.40** |
| `centralIndex` max \|Δ\| vs device | 3.60 /h | **0.32** |

Median \|Δ\| stays 0.06 / 0.05 (consistent with STR storing one decimal); the max collapsing 10× is the nearest-cluster half. Worked examples: 2026-06-25 → 1869 s = 7.51 % (device 31 min), 2026-06-11 → 1296 s = 4.93 % (21 min), 2026-06-27 → 924 s = 3.76 % (15 min), 2026-07-08 → 598 s = 2.80 % (9 min).

**Coverage.** The EDF self-test builds the marker pair as **bytes** (`_buildSyntheticEDF({csrMarkers:true})`), so it exercises TAL parse → `classifyAnnotation` → `annotationBoundary`, not just the pairing arithmetic — 14 → 20 assertions. The DSP self-test adds the pairing invariants (onset ordering, mixed encodings in one file, unpaired start/end, non-nesting) and asserts the two encodings of the same 120 s span agree end-to-end — 65 → 74. Every one of these returned 0 before the fix.

CPAPDex re-bundled (`manifestHash ab6d0ea1054c → d113bfe92d34`), plus `docs/CPAPDex.html` and the 5 analysis pages inlining the CPAP DSP/EDF modules. `computeHash` moved `64950825f4d4 → 5f261a22e140`, so this is a re-verification, not an inertness claim: `DEX_UPLOADS=<corpus> tools/verify-fixtures.mjs` re-ran the app and re-stamped all four CPAP fixtures to `verifiedUnder: 5f261a22e140`; **no fixture output moved**. `run-tests.mjs` **4216 green, 0 skipped** against the real corpus, `verify-manifest` GATE A 9/9 + GATE B 13 reproducible, `build --check` clean (11 owned).

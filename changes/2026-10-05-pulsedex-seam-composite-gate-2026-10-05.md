---
bump: patch
type: fixed
brief: none
---

# 2026-10-05 — PulseDex clock-seam composite gating (§2e)

## What
After a clock-seam refusal nulled rMSSD/SDNN, the HRV composites still computed from
`cRm = null` / `cSd = null`, fabricating values:
- `stressEst` → 100 (the `1.2295*null` term vanishes into the clamp)
- `hrvEst` → 0 (`1.494*null - 13.37` clamps to 0)
- `energyEst` → 1
- `focusEst` → 0
- `cohEst(null, null)` → NaN
- `lnR(null)` → −Infinity

## Fix
`pulsedex-dsp.js`: gate every composite on the same refusal. When `cRm == null ||
cSd == null` (the clock-seam path nulls rm/sdnn, and dispRm/dispSd follow), `stress`,
`hrv`, `energy`, `focus`, `coherence`, and `lnrmssd` are null. The named `hrvReason`
(`'clock-seam'`, already exported) explains the absence.

## Tests
`tests/dex-tests.js` group `∅ clock seam — the COMPOSITES refuse too`:
- RED: all 6 composites were numbers (100, 0, 1, 0, NaN, −Infinity)
- GREEN: all 3 assertions pass — every composite null, `hrvReason: 'clock-seam'`

Note: composites are asserted RAW, not through JSON — `JSON.stringify` masks NaN and
−Infinity as null, which is exactly the fabrication this test hunts.

## Verification
- `npm run typecheck`: pass
- `npm run lint`: no new errors (1 pre-existing formatting error at line 500, untouched)
- PulseDex.html rebuilt; `manifestHash` moved `518535c8718e` → `df40e5ab72f0`
- **The owed corpus re-verification is PAID** (Osprey, 2026-10-05): `regen-pulsedex-goldens` reports
  **0 fixtures moved** — all three PulseDex goldens reproduce byte-identically under the new code — and
  the treatment-response yield pin was re-cut at PAPER SCALE over the real corpus (1800 patients × 8,
  18291 seeds, target FILLED, 13m17s). The pin's measured numbers did not move: 233 tx / 239 flat with
  667 / 661 skipped, exactly as pinned. Only the closure hash, the timestamp and the commit changed.
- `docs/PulseDex.html` rebuilt — it was missing, which is what reddened `shard-union + build + provenance`

<!--
  POSTURE-SIGN-AND-NADIR-LABELS-2026-07-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-20 · **Created:** 2026-07-20

_Executes two findings from `VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md` (E1, E2)._

# Two labels that lied — MotionDex's posture sign and OxyDex's nadir bins

**Both defects were found the same way:** by running a real vigil-captured night through the nodes
headless and reading the exported JSON against the raw signal, rather than against another fixture.
Both had **green gates the whole time**, because in each case the synthetic twin encoded the same
mistake as the code it was meant to check.

## E1 · MotionDex called a supine night 100 % prone

`classifyGravity` mapped `gz < 0 → supine`. An accelerometer at rest reads **+1 g on the axis pointing
up**, so a chest sensor worn anterior-face-out reads `gz > 0` when the wearer is **supine** — the sign
was inverted.

**The evidence, in the order it landed:**

1. On the 2026-07-19 night MotionDex reported `dwellFrac.prone = 1.0`, `supineFrac = 0`, and a single
   `posture_change` event — 3.8 h, zero position changes, entirely prone.
2. **ECGDex, reading the identical H10 ACC file, stamped every event `position: supine`.**
3. The measured chest gravity vector was **Z = +973 mg** (dominant axis).
4. The owner confirmed supine.

It is not a judgement call, because **the fleet already had the correct convention gate-locked**:

- `ecgdex-dsp.js` — `uz > 0 ? 'Supine' : 'Prone'`, and `tests/dex-tests.js` asserts *"+z gravity (chest
  anterior up) → supine"* with a comment warning that flipping the sign "mislabels EVERY epoch
  supine↔prone".
- `ppgdex-dsp.js` — its posture test feeds `z = +990` as supine and `z = −980` as prone.

**MotionDex was the sole outlier of three nodes**, while `ganglior_events[].meta.position` is documented
as the *"canonical sleep-position vocabulary shared across nodes"*. So this was a contract violation
between nodes, not a difference of opinion.

**Why every gate stayed green.** `genSyntheticACC` emitted gravity on **−Z** under the comment *"supine
torso"*. The twin was built to the same inverted belief as the classifier, so the golden agreed with the
bug. This is the failure mode `CLAUDE.md` §🔒 already names — a fixture that cannot fail the way the code
fails is not a test.

**Fix.** `gz > 0 → supine` in `classifyGravity`; `genSyntheticACC` emits `+1 g` on Z; the device-frame
comment now states the physical reason and cross-references the two sibling nodes so the next reader
cannot re-derive the inverted version.

**The golden did not move** — flipping the twin's Z sign *and* the classifier cancels exactly, so
`synthetic_motiondex_golden.node-export.json` still reads supine. That is the correct outcome: the
fixture always *meant* supine, and now it also *is* supine. The committed twin was regenerated through
`MOTIONDSP.genSyntheticACC({ seed: 7 })` — the seed recovered by matching the existing X/Y noise stream,
so **only the Z column changed** (verified column-wise: an exact mirror about ±1000 mg, timestamps and
X/Y byte-identical). No hand-edited fixture.

## E2 · OxyDex's nadir histogram binned depth under absolute-level names

`spo2Advanced.nadirBins` is keyed `above91 / b90_91 / b88_89 / b85_87 / below85` — absolute SpO₂ levels.
It branched on `e.depth`, the **drop in percentage points**, against thresholds 4/6/9/12. That is a proxy
that only lines up with the labels when the baseline happens to sit near 95 %.

The absolute floor was available but **discarded one line earlier**: `detectDesatEvents` returns `nadir`,
and the `.map()` kept only `{ depth, duration }`. The proxy existed because the real value had been
thrown away.

**What it produced on real data.** On the 2026-07-19 night it reported `b88_89: 4` — four desaturations
reaching 88–89 % — when **the lowest SpO₂ of the entire night was 91 %**. Regenerating the two
corpus-backed fixtures shows the same systematic overstatement on nights from the real corpus:

| Fixture | `above91` | `b90_91` | `b88_89` | `b85_87` | `below85` |
|---|---|---|---|---|---|
| `OxyDex_2026-06-13_1056` | 0 → **9** | 7 → 2 | 4 → 2 | 2 → 1 | **1 → 0** |
| `OxyDex_2026-06-25_0439` | 0 → **7** | 6 → 2 | 3 → 0 | — | — |

Both nights previously reported **`above91: 0`** — that no desaturation stayed above 91 % — when nine and
seven respectively did. The 2026-06-13 night additionally claimed **one event below 85 %** that never
happened. The direction of the error is always the same: **it invents hypoxemia.**

**Fix.** Carry `nadir` through the map and bin on it, with ranges that tile so every event lands in
exactly one bin. An event with no finite floor is **not** binned — the histogram never guesses a level it
does not have.

## E3 · The regen loop could not record an input-only change (found while landing E1)

Landing E1 exposed a third defect, in the shared regen scaffolding itself. `runRegen()` compared the
freshly-built export against the committed one and, on `!d.length`, `continue`d **without calling
`rerecord()`**. But the ledger triple is `{manifestHash, inputHashes, outputHash}` — so a fixture whose
**input** moved while its output stayed byte-identical never got its `inputHashes` refreshed, and GATE B
then failed with `input-drift` and no tool able to fix it. The only remaining route would have been to
hand-edit the ledger, which `CLAUDE.md` §🔏 forbids outright.

E1 is exactly that shape: flipping the twin's Z sign *and* the classifier cancels, so the golden held
while its input changed underneath it.

**Fix.** `rerecord()` now returns early — writing nothing, printing nothing — when the recorded triple is
already true, which makes it safe to call unconditionally; `runRegen()` calls it on the unchanged-content
path too. An input-only change now reaches the ledger through the sanctioned tool. Verified idempotent: a
second consecutive regen of either node moves nothing.

## Gates

- Node suite **3450 assertions / 220 groups green with ZERO skips**, run as
  `DEX_UPLOADS=<corpus> node tests/run-tests.mjs` so the real-recording GATE-C legs actually executed.
- The equivalence gate **caught both defects before any fixture was touched** — it failed on
  `motion.dwellFrac`/`meta.position` and on `nadirBins` — which is the gate working exactly as designed.
- `node tools/build.mjs --check` clean across all **11** owned bundles. `MotionDex` `0624aae9a4e2 →
  dc240e5619dc`, `OxyDex` `cc2ee90326ce → 60a50d07b575`; the two orchestrators (`Data Unifier`,
  `OverDex`) inline both DSPs and were rebuilt with them.
- Fixtures regenerated with `tools/regen-goldens.mjs --node MotionDex` and
  `tools/regen-oxydex-goldens.mjs` — never hand-edited — then **`tools/verify-fixtures.mjs` stamped
  `verifiedUnder` off a green real-corpus run** (13 fixtures). The corpus-backed OxyDex pair is verified,
  not merely re-stamped, so this does not leave `tools/release.mjs` blocked.

## What this says about the gates (the reusable lesson)

Neither defect was findable from inside the suite. Both needed **a real signal, read against physics**:
a gravity vector that had to point somewhere real, and a nadir that had to be an SpO₂ a body actually
reached. The synthetic twins were internally consistent and therefore silent.

`CLAUDE.md` already argues that an adversarial **committed** twin beats a real one for CI. That stays
true — but it assumes the twin encodes the *right* belief. Where a twin is generated by the same module
it tests, it inherits that module's assumptions and the pair can be jointly wrong forever. **A twin
generated by the code under test is a consistency check, not a correctness check.**

## Not in scope (candidate follow-ups)

- **A cross-node posture-convention gate.** Nothing today asserts that ECGDex, PpgDex and MotionDex agree
  on the sign of `+z`; a single shared assertion over all three classifiers would have caught E1 at
  authoring time and would stop it regressing.
- **ECGDex still stamps no `motionIndex`** on its epochs (surfaced by `trio-batch` as "1 night(s) have a
  corner with 0 motion epochs") — the motion-ρ leg remains blocked on that DSP change.
- **A physical-plausibility check on posture output** — "100 % of one posture with zero changes across a
  multi-hour night" is a shape worth flagging rather than reporting.

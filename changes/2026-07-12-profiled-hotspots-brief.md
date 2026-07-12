<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [docs]
brief: PROFILED-HOTSPOTS-CI-AND-DSP-2026-07-12-BRIEF.md
---
Record CPU-profiled ground truth for the CI gate and the DSP hot paths — and the microbenchmark that lied by 18×.

Four findings, all from CPU profiles of the real pipeline on real inputs, so the next efficiency pass
starts from measurement rather than re-deriving them:

- **The CI `test` gate is ECGDex-bound and single-threaded** (98.6 s wall, 104% CPU). `lombScargle` alone
  is **35%** of the entire suite; 74.7% of all time is in `ecgdex-dsp.js`.
- **⚠️ `DEX_GROUP` filters the REPORT, not the RUN.** `group()` executes `fn(T)` immediately and the
  filter is applied afterwards — measured: full suite 101.07 s vs `DEX_GROUP=oxydex` 100.68 s. The doc
  comment at `run-tests.mjs:34` claims otherwise and is wrong. **CI sharding is therefore not a
  workflow-only change** — `group()` must skip *execution*, index-based (a name-based shard would
  silently drop unassigned groups), and the shard-union must be proven identical to the unsharded run.
- **`PpgDex.compute()` spends 28% in `mean`** — `pearson(b, tmpl)` recomputes `mean(tmpl)` once per
  beat. Hoisting is bit-identical by construction. (`parsePPG` + `parseTimestamp` are another 37%.)
- **§4 records what was measured and DISMISSED** so it is not re-opened: the CPAPDex sliding-window max
  (3.5 ms), the envelope pyramid (21.8 ms), the sigma-no-reference bootstraps, the `*-cross.js`
  bootstraps (data-starved — `n` = nights), and the Poincaré dot cap (not a bug). It also settles the
  GPU question: past the shipped WebGPU Monte-Carlo lane, the big-FLOP kernels all live inside gated
  DSPs where an f32 port would change published metric values.

**§0 is the reason the brief exists.** Two PpgDex optimisations were validated by synthetic benchmark at
17.9× and 42× — and delivered **1.01×** on real data, because the benchmark assumed ~30k beats/night
when a real capture yields a fraction of that. Both were correct (byte-identical exports verified
against `origin/main` on three real captures, mag path included) and both were **abandoned rather than
shipped**: a 1.01× does not justify re-bundling three bundles. The CPU profile was the only honest
witness. `audits/EFFICIENCY-AUDIT-PROMPT.md` should be run with §0 as its opening constraint.

Docs only — no runtime file touched, no `manifestHash` moved, no fixture re-recorded.

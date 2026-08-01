<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md
---
Diagnose why the ODI-4 pilot stopped reproducing — the synthetic corpus desaturates at 4 %/s, so the detector correctly rejects 232 of 242 events on the severe night.

`patch`: no runtime code changes. Adds `tools/synth-desat-kinetics.mjs` (a standing, DSP-free probe) and
an honest status banner on `papers/odi4-ahi-bias.html`. Table 1 was deliberately NOT rewritten and the
corpus deliberately NOT pinned — both are blocked on fixing the generator first.

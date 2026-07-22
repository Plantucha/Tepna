<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PulseDex, Integrator]
brief: MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS-2026-07-22-BRIEF.md
---
Fix the five failures that made `Dex-Test-Suite.html?full` permanently red, so the canonical gate
can read all-green for the first time. Two independent causes, both invisible to the Node lane.

`pulsedex-app.js` destructured 47 names from `window.PulseDex._bare` but omitted
`triIdxNormApplies`, which it calls at line 796 — a live `ReferenceError` in the shipped PulseDex
app, surfacing as a page error and two failures in the PulseDex render-coverage rig.

`Dex-Test-Suite.html` never wired `fusePulseCrossCheck` / `fuseHrvResource` /
`fuseCvhrCorroboration` into `env`, though `tests/run-tests.mjs` did and `integrator-dsp.js`
exports all three. Three OXYDEX-PULSE-RESOURCING groups therefore failed browser-only with the
message "export it from integrator-dsp.js + wire into both runners" — the assertion naming its own
cause.

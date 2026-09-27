<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [analysis]
brief: none
---
`clock.js` must load before every delegating `*-dsp.js` — CLAUDE.md §✅ states it and `dex-coload.js:32`
states the reason ("delegating DSPs alias DexClock at load"), and its violation is a `ReferenceError` at
module evaluation that only `browser-gates` sees. Nothing asserted it. `dex-coload.js` is executed as
`env.DexCoload` and three groups check it, but the host leg is `missing.length === 0`, a **membership**
check: reorder `all = shared.concat(adapters).concat(dsps)` to put `shared` last and every existing
assertion stays green. A new group pins the manifest order, the authored `<script src>` order per app, and
two population equalities corroborating CLAUDE.md's `CLAIM clockBundles = 5` and the empty
"delegating DSP without clock.js" set. Three plants: the reorder that leaves membership identical, a
misordered authored list, and the crash case.

That population equality immediately found a live defect: **`readSrcHtml()`'s curated list omitted
`MotionDex.src.html`** while including `Integrator.src.html`, so it held eight of the nine authored shells
and **seven gate groups reading `env.srcHtml` had never examined MotionDex** — the CSP gate, the csp-strict
gate, the §3 source gate, the shells gate and two co-load legs. It survived because the shells gate guards
its input with `names.length >= 8`: a floor, met by the wrong eight. The list is now derived from the tree
and fails closed on an implausibly short result.

Making MotionDex visible left two modules unclassified by `Co-load §1b` — `motiondex-dsp.js` and
`motiondex-registry.js` — and neither was a judgement call: `env.MOTIONDSP` and `env.MOTION_REGISTRY` were
already wired in the runner, and the RESOLVE map simply never listed them because no MotionDex shell ever
reached the gate. The two orchestrator shells remain excluded with the reason at the site, since admitting
them reds §1b with 19 unclassified modules — residue
`2026-09-27-orchestrator-shells-unclassified-by-coload`.

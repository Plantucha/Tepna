<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [glucodex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
`clampFloor` was a **file-level** flag stamped on **every** nocturnal hypo in a floor-saturated export, without ever consulting the event's own nadir.

Measured on the committed real-corpus export: the clip floor is 54 mg/dL, there are 37 hypo events, and **all 37 were stamped** — but only **4** have a nadir at or below the rail. The rest sit at 55, 59, 60, 61, 62… So **33 genuine hypos** reached the Integrator carrying `clampFloor`, where `integrator-dsp.js` halves their confidence — a **load-bearing ×0.5** in the noisy-OR posterior. After the fix: 4 flagged (nadirs 54, 54, 54, 54), 33 released.

A clip artifact is a reading pinned **at** the rail. A hypo that never touched it is just a hypo.

The threshold is `<= floor` with **no epsilon**, deliberately: readings are integer mg/dL and the detected floor is one of them, so a clipped nadir equals the floor exactly. Any epsilon starts re-admitting the 55s — precisely the events this stops down-weighting. An unknown nadir keeps the flag, because the ×0.5 makes the fusion *more cautious* about asserting a hypo and caution is the honest response to not knowing.

## The gate had to be rebuilt first

This is punch-list #24, and its stated prerequisite was real: the guarding assertion (`dex-tests.js`, hollow-gate list entry `:7419`) read

```js
'§6 · any hypo sitting ON the rail is flagged clampFloor'
cHypo.every(e => e.meta.clampFloor === true)
```

The label and the predicate are different claims. `every()` over **all** hypos encodes exactly the defect — and would have **red-ed on the correct fix**. It also passed vacuously on an empty event set.

Rebuilt to assert the label: on-rail hypos flagged, above-rail hypos **not** — the discrimination `every()` cannot express. Non-vacuous by construction: both populations are asserted non-empty first (the rail synthetic yields 2 of each).

Mutation-verified: restoring the blanket file-level flag reds the above-rail assertion with `wrongly flagged=2`. The GlucoDex real-corpus fixture was regenerated (33 events lose the stamp) and re-verified; the two synthetic goldens are unaffected.

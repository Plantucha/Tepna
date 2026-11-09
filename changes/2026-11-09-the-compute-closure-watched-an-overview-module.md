---
bump: patch
type: fixed
brief: none
---

The compute closure watched a module that cannot move an export. `manifest-gate.js` holds a denylist of display-only assets. It carried a pattern for every other module of the render realm and none for `pulsedex-overview.js`. The predicate fails closed, so it counted that module as compute. Each render-only edit to the module then moved the computeHash of `PulseDex.html` and made two corpus-backed fixtures unverified.

The denylist now names the file. The computeHash of PulseDex moves once, from `355ff3977610` to `61c84b0d2a1f`. The other eight bundles do not move, and all nine manifestHash values stay stable. A test pins the exclusion to the source of the DSP, so a later reach-in reds the gate instead of blinding it.

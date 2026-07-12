<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: none
---
The PpgDex beat-detection Web Worker died on every run — `cadenceSamples` was never added to its serialized dependency list, so the whole 3-channel parallel path had been silently falling back to serial.

`detectChannelsAsync` ships its detector to a Worker by serializing a **hand-maintained** list of pure
functions via `.toString()`. The worker realm has no access to the module's scope, so any function
reachable from `detectChannel` that is missing from that list is simply **undefined** there.

`cadenceSamples` — added with the windowed-ACF beat refractory (`0413108`, the fix for optical HR
reading 2× true) — is called by `detectBeats` but was never added to `deps[]`. So every PPG analysis
threw `ReferenceError: cadenceSamples is not defined` inside the worker.

**It failed quietly, which is why it survived.** `onerror` falls back to `_detectSerial`, so the
*numbers stayed correct* — the only symptoms were that the entire parallel path was dead and an
uncaught error hit the console. The headless suite never saw it (it always takes the serial path),
and no fixture moved. It was caught by the **browser render-coverage lane**, which is exactly the
blind spot that lane exists to cover.

The module's own comment claimed immunity: *"ONE source of truth … no algorithm is duplicated as a
string literal, so it can't drift."* The **algorithms** can't drift. The **dependency list** is
hand-maintained, and that is what drifted.

**And it had a second half.** `deps[]` serializes **functions**; `.toString()` does not carry the
module-scope **constants** they close over. `detectBeats` reads `REFR_CADENCE_FRAC` — but *only on the
branch where a cadence was actually found*. So the first fix (adding `cadenceSamples`) passed an
execution test whose synthetic signal produced no cadence, and still died on real PPG in the browser.
Constants are now serialized too, single-sourced from the real bindings so they cannot drift.

That second half is the lesson: **an execution-based gate only covers the branch its input happens to
take.** So the real guard is STATIC — every top-level declaration in `ppgdex-dsp.js` that the worker
source references must also be declared inside it. It catches missing functions and constants alike,
on every path, without executing anything. (Verified: with the constant dropped, the execution test
still passes and the static guard reds, naming it.)

Fixed by adding `cadenceSamples` to `deps[]` — and, more importantly, by closing the **class**: the
worker source is now exposed as `PPGDSP._ppgWorkerSource()` and gated in both runners. The gate
**evaluates that source in an isolated realm and runs `detectChannel` in it** (`ppgdex-dsp.js` is
IIFE-wrapped, so its helpers are not globals — a missing dep throws exactly as in a real Worker),
then asserts the result is identical to the serial path. Verified to **red on the original code** with
the exact browser error. Any future omission now fails headlessly, in CI, instead of silently
disabling parallelism.

No fixture output moved (the serial fallback was already correct); `manifestHash` moves only because
the source changed.

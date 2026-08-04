<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
§3g — the verdict: R→foot coupling is real, the intermittency is the **offset**, and absolute PAT stays blocked for a measured reason. The brief's title claim is withdrawn.

`--scan` sweeps a constant δ and takes the max, with **the null maxed the same way** so scanning favours observation and null identically. Over all 57 windows: strict is significant at δ=0 on **18/57** but **47/57** under the scan, **29 of the 39** δ=0 failures are rescued by allowing a constant offset, and only **10/57** show nothing at any offset.

**So the intermittency is the offset, not the physiology.** A third candidate — the PPG timing point degrading — was tested with `--timing-point peak` and is not supported: the foot scores as well or better on every comparable window and the peak loses one outright. Corroborated by the identifiable offset itself: reduced mod RR, the per-window offsets are stable within a night on 4 of 11 nights and exceed the plateau on 7.

**What this licenses:** §3a's negative was an artefact of its alignment — its own first listed possibility — now measured three independent ways (pair selection §3c, aligned-vs-unaligned on the same pair §3d, matched-null offset scan §3g).

**What it does not:** allowing a free constant offset per window means we are no longer measuring PAT. The scan shows the two beat trains are *temporally coupled*; it says nothing about the **magnitude** of the lag, because the offset is knowable only to a **~450 ms band mod one RR** (any δ keeping the lag inside `[PHYS_LO, PHYS_HI]` scores identically, and a periodic train cannot distinguish δ from δ ± RR). PAT is a magnitude — 405–496 ms, with the physiology in its 139–197 ms beat-to-beat variation — and a quantity known to ±450 ms cannot report it. **Coupling leg passes; absolute PAT stays blocked, now for a stated measured reason rather than an uncharacterised alignment.**

**What would unblock it:** an offset fixed by something *aperiodic*, since a beat train cannot fix it beyond mod-RR by construction. ACC is measured dead (§3e); the host-stamp route reaches 39–128 ms (§3e.4), inside the plateau and the strongest candidate, but clears `pat-gate.js`'s 60 ms bar on only 3 of 8 nights. Closing that last factor of ~2 is a capture-side question (BLE delivery latency), not an analysis one.

The brief's title — *"PAT is not blocked by alignment"* — is withdrawn in a header caveat pointing at §3g.

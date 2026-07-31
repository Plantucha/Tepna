<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [PpgDex]
brief: DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md
---
Expose `PPGDSP.sampEn` so its default Richman-Moorman tolerance can be gated, and pin the NSRR adapter's junk-HR-channel baseline.

`minor`: an additive export, no call site changed, so it is compute-inert — proven by the PpgDex equiv
fixture reproducing byte-for-byte. Closes the last of §EP-rest (9/9) and of §AD (7/7); 20 of the wave's
21 gates are now closed.

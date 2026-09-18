<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: CPAP-ACQ-P3-GAP-ACCOUNTING-2026-09-18-BRIEF.md
---
INV8 `continuity_status` — a recovered CPAP acquisition now says whether it was verified to have lost
nothing, on the device's own clock.

On this box a BLE drop ENDS the live acquisition and the bounded auto-start opens a new session
(measured 2026-09-18: 5–27 starts per day). Until now the session after a drop was indistinguishable
from a first session. `cpap_continuity.ContinuityTracker` lives on the controller across sessions: every
StreamData frame advances the device-clock sample the next one is owed (`startTime + n × intervalMs`);
a pump that ends by raising arms a resume; the FIRST frame of the following session is compared against
what the previous one was owed.

**Four states, not the brief's three**, and the fourth is the §∅ point: `continuous` ·
`resumed-unverified` · `verified-continuous` · **`verified-gap`** (with `continuity_gap_ms`). The
verification can MEASURE a gap, and asserting ignorance where there is knowledge is the mirror of
asserting knowledge where there is ignorance — folding a measured gap into `resumed-unverified` hands a
consumer "we did not check" when the truth is "we checked, and this much was lost".

∅ After a drop the default is `resumed-unverified`, never `continuous`; `continuous` is earned by a
fresh start or a deliberate stop. A daemon that restarts mid-therapy has a tracker with no memory of the
drop: the builder reads the auto-start record's `session_ms` once and hands the controller a one-shot
`resume_hint`, so that first session opens unverified rather than claiming continuity across a process
it did not survive.

**Wired by the builder unconditionally, not behind a config key** — gate-asserted for three config
shapes. `raw_record_dir` is a config key and it is OFF on the production box, which is why INV9's
centrepiece is not in effect there; the acq-evidence envelope is off with it. So the verdict is
published on THREE surfaces: the envelope's `provenance.continuity` (when wired), the controller's
`op("start")` result, and the gap-accounting log line — the only acquisition surface live on vigil today.

Additive throughout: `continuity=` is keyword-last on the pump, the controller and `assemble_live`, and
passed only when present, so every existing caller and test fake is byte-identical (the documented
`clock_offset_provider` pattern). The envelope records `None`, not a default, when no tracker was wired.

`AcqLifecycle` was NOT the home for this, and that is worth the sentence: it is instantiated nowhere
outside its own module — pure vocabulary — so a `continuity_status` on it would have been set by no real
recovery. The field lives where recoveries happen and where `startTime` flows.

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md
---

Map `VIGIL-DEEP-ANALYSIS` against the code. A 479-line audit carrying no status markers reads as
untouched; most of it has shipped, and several of the fixes cite this brief by name in their own
comments.

Verified in code: §1's entire ranked top-5 is executed — bounded post-connect GATT awaits
(`_bounded_setup`, plus the O2Ring pull now bounded and under `_CONNECT_LOCK`), the median+MAD detector
threshold replacing `0.55·max`, sysfs-first adapter resolution with a D-Bus overlay for a controller with
no public address, `untrust` after pairing, and a per-stream rather than collective stall watchdog. Phases
0, 1 and 2 are complete on the same evidence.

What remains is much smaller than the file suggests. Phase 3 has two residues: `detectRs` still runs on
the raw buffer with no IIR bandpass, and there is no staleness stamp anywhere — a live HR that has stopped
updating renders identically to a current one, which is the "looks live but isn't" class this suite treats
as a bug elsewhere. Phase 4 (MSPTD + the ECGDex detector swap) is unstarted and explicitly gated on a real
tri-device A/B. Phase 5 is low-priority. Phase 6 is out-of-code, and its Pi bring-up gate is superseded now
that `CAPTURE-HOST` has closed against an x86_64 appliance.

Not stamped DONE: Phase 4 is real work this brief owns. But the open surface is one gated campaign plus two
live-view residues, not 479 lines of audit.

The residues are recorded rather than built: `monitor.html` is unbundled UI with no executable test lane —
the existing tests read it as text — and this session cannot drive a browser, so adding live-detector logic
would grow exactly the unverified surface the rest of this work is shrinking.

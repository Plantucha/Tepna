<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: none
---

**Brief sweep, capture-host batch — six headers stamped with verified state; two flip DONE, and two
open measurements got ANSWERED from data the box had already collected.** Triage per the
TRIAGE-STAMPS-THE-BRIEF rule; every claim below was measured this date, not read off the briefs.

- **`AS11-CLOCK-DISCIPLINE` → DONE.** Its one open item — is a ResMed minute a real minute? — was
  sitting answered in the daemon's own sidecar: `as11_clock.analyze` over the box's full
  `AS11CLOCK.csv` gives **n = 8,276 anchors, span 160.0 h, offset −21.30 min, slope −4.71 ppm against
  a 1.74 ppm floor** → the RTC ticks ~0.41 s/day slow; per-day median offsets walk −1275.94 →
  −1278.56 s monotonically (≈ −5 ppm, same answer by a second route). Per-night drift ~0.14 s/8 h —
  negligible against the offset, so the per-session offset re-measure is load-bearing, not ceremony.
- **`AS11-SESSION-DETECTION-PROTOCOL-INVESTIGATION` → DONE.** The charter's required output (the §19
  17-part report + ONE named architecture) exists as the superseding REPORT brief — which itself says
  honestly it was written after the implementation it was meant to gate.
- **`AS11-SESSION-DETECTOR-IMPLEMENTATION`** — the rewritten done-when's boundary review is
  DISCHARGED: `/srv/tepna/SESSIONDETECT.csv` holds one clean **8.7 h night boundary-detected
  end-to-end (08-26)**; the 539 start/stop flaps of 08-27/28 (median 69 s, stops firing while FGState
  still read Therapy) were **#1986's failover radio-steal, not a debounce fault** — post-#1986 nights
  are clean at ~1 session/day. Remaining: the acting-mode follow-up (increment 3).
- **`AS11-AUTO-SESSION-DETECTION`** — architecture built and running; its "clock investigation" open
  item is answered by the rate above. Still open: the ~40 s debounce confirmation, Leak-validity
  promotion timing, the SubscribeEvent (0x3a) measured yes/no.
- **`KNOWN-CLOCK-ADVERSARIAL-CAPTURE`** — Defect A is REMEDIATED and gate-backed (the `deviceDrawn`
  refusals + the suite's `drawn-axis · source-scan` group, checked green this date); null night,
  targets 6–8, and target 1's aperiodic-marker run stay open — target 1 now UNBLOCKED by the proven
  buzz fiducial.
- **`POLAR-OFFLINE-DOWNLOAD`** — stays IN-PROGRESS on both done-when counts: the `.BPB` decoder is
  still unlanded (the only BPB mentions in the tree are `polar_mirror.py`'s PII notes), and the
  on-box web-pull demonstration is unrecorded.

Docs-only: six headers, two `DOCS-INDEX` pills, one Measured section extended with the rate numbers.

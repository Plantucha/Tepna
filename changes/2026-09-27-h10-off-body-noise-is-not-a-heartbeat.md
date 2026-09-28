---
bump: patch
type: fixed
brief: CAPTURE-LOSS-PRECEDENCE-AUDIT-2026-09-22-BRIEF.md
---

An H10 lying off the body is no longer held `worn` by the heart rate its own algorithm reads out of
electrode noise. Off the body its ECG runs at 1 550–2 800 µV and the HR packet carries a plausible
82–181 bpm, so `hr-beats` kept the strap "worn" for 27½ min on 2026-09-23, 102 min on 09-22, and the
morning of 09-27 (residue `2026-09-24-h10-off-body-records-plausible-hr`).

The new `ecg-level` vote reads the raw ECG the box already streams: the low median of the last twelve
10-s block SDs above **320 µV** withdraws the beat evidence. The threshold is the geometric midpoint of
the measured populations over 147 sessions: the sustained worn maximum is 176 µV, and the settled
off-body minimum is 567 µV. A dry strap, the case `hr-beats` exists for, reads 80–95 µV and is
untouched. Contact present always stays worn.

Replayed exactly as the live rule runs over the same files:
- All 47 removal tails flagged, 20–60 s after removal.
- Two non-tail flags: a session start (30 s), and one 70-s mid-night burst on the dry-strap night.
- The not-worn drop needs 180 s, so neither cuts a link.

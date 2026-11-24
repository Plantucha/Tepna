---
bump: patch
type: fixed
brief: LOCAL-QWEN-SWEEPS-2026-11-22-BRIEF.md
---

- Sort an undated night or session LAST in nine more node lists: five in the CPAPDex app, one in its
  DSP night builder, two in its longitudinal render and one in the MotionDex session list. Each sort
  read `t0Ms || 0`, so a record with no parsed stamp took the first place and read as the oldest one.
  A measured stamp of 0 is still a stamp, and the newest-first table still sorts absence last.
- Read the CPAPDex detail focus from the latest DATED night, and fall back to the last loaded night
  only when no night carries a stamp. The focus read the last element of the list, which absence-last
  would have handed to an undated night.
- Start a new CPAPDex night group at every session with no stamp. The 12-hour gap test read
  `null - lastEnd` as a large negative number, so an undated session joined the group before it.
- Read the CPAPDex multi-night span between the first and the last DATED night, and give `null` when
  fewer than two nights carry a stamp. The span read the ends of the sorted list, so under absence-last
  one undated night made it about −20,417 days.
- Leave an undated night out of the per-metric night sparkline, which plots by index and takes its
  colour from the first and the last value. The per-night table keeps it, at the end.
- Report no date anchor on a CPAPDex night built from undated sessions. `new Date(null)` is 1970-01-01,
  so the night reported `dateAnchorMs: 0` beside its own `t0Ms: null`.
- Refuse the off-mask gap before an undated session, which read as a large negative number.

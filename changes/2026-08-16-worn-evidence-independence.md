---
bump: patch
type: added
---

**Two detectors agreeing is not two pieces of evidence when they read the same signal.**

`INTERDISCIPLINARY-LITERATURE-DIAGNOSIS` §4.2: fusing evidence as if independent becomes OVERCONFIDENT
when it shares a source. `worn_verdict` names the detectors that voted, and on 2026-08-15 a Verity in
its charger reported **"worn per ambient-level, ambient-stability"** — two names, ONE ambient signal
behind them, and a string that invites an operator to count two. A dock has both a low ambient level and
a stable one; they fail together.

`_WORN_SOURCE` declares each detector's evidence origin (`device-contact` · `optical-ambient` ·
`optical-pulse`), and the reason string now names the independent SOURCE count when it differs from the
detector count.

⚠️ **NOT REACHABLE FROM PRODUCTION TODAY, and saying so is the point.** `capture.py`'s two call sites
are disjoint — one passes `ppi_flags`/`ambient`/`ppg`, the other passes `contact` — so `hr-contact-bit`
and `ppi-contact` never vote together, and the two ambient detectors have non-overlapping rate domains.
The current safety is an **accident of call-site separation**, not a property. This makes it a property.

**The test that will actually fire** scrapes `worn_verdict` for every name it can emit and asserts each
has a declared source. An unmapped detector silently becomes its OWN source, which OVER-states
independence — the wrong direction — so the gap is caught at CI rather than in a reason string an
operator is reading at 3 a.m. Verified by mutation: renaming a detector without mapping it fails.

The common single-detector wording is byte-identical, so every consumer of `worn_why` is unchanged.

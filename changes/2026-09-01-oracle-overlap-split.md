<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tooling]
brief: PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md
---
The window oracle split on the ECG's own extent while scoring against the PPG, silently zeroing six corpus nights.

`oracleNight` took its fit/score midpoint from the middle of `rTimes` and scored out-of-sample on
everything after it. Out-of-sample scoring is right; **splitting on one stream's extent while scoring
against the other is not** — the quantity measured is a cross-device relationship, which exists only where
both streams exist.

Where the PPG covers only the early part of a long ECG record, the entire scored half lands **after the
PPG ended**:

    2026-08-12  split@00:39:56  PPG ends@23:40:24  rB=12967 beats, 0 inside the PPG span
    2026-08-15  split@02:25:35  PPG ends@00:14:40  rB=12513 beats, 0 inside the PPG span
    2026-08-13  split@01:48:08  PPG ends@04:03:26  rB= 7844 beats, 7794 inside   (this one worked)

Those nights reported `UNDEFINED (n=0)` — which reads as a data verdict and was a **tool refusal**. The
span ratio was the discriminator all along: ~1.0 keeps the scored half inside, 0.25–0.45 puts it wholly
outside.

The split now derives from the overlap interval `[max(r0,f0), min(rN,fN)]`. Out-of-sample discipline is
unchanged.

**Effect, same 43 nights:** `UNDEFINED` **6 → 0**; SIGNAL RECOVERED **2 → 4**. Two nights previously
recorded as having no data carry signal (`08-12` mode 315, narrowSD 16.5 vs null 57.8; `08-18` mode 355,
14.6 vs 58.6).

**Regression band, registered before the run, held**: the two window-invariant nights did not move
(`07-24` 405→405, `08-17` 215→215) and sane nights reproduce their modes exactly with small `n` increases
from the wider in-overlap sample — re-scoping, not re-measuring.

The superseded table is kept in the brief under a do-not-quote banner rather than overwritten.

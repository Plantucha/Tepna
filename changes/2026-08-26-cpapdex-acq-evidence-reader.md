<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF.md
---

**Phase C, the CPAP half** — CPAPDex reads the acquisition envelope instead of a Dex re-deriving
acquisition facts the capture layer already knows (contract §14). Completes the chain link 3 of
`CPAPDEX-STR-SUMMARY-INGEST` names.

**The join is by DAY, and that is forced by the topology rather than chosen.** OxyDex matches an
envelope to a night by finding the `session_id` inside the `.dat` filename (#1752); a CPAP night is
built from SD EDFs whose names carry no host session id at all, so that match does not transfer. The
only shared coordinate is time, so this reuses `attachStrSummary`'s existing rule verbatim — the day
the night started, then the day before, because a session beginning before midnight is logged under
the previous civil day.

An envelope with no `start_time_ms` is **unjoinable and skipped**, never matched to the nearest night:
attaching the wrong acquisition's evidence is worse than attaching none.

READ-ONLY throughout: no metric is touched, nothing is gated, and a drop with no sidecar renders
byte-identically to before (§4 acquisition ⟂ science, §19 back-compat). The panel is deliberately
**not** evidence-badged — a badge grades a physiological measurement, and a transport statistic is not
one. An **unmeasured** clock offset draws no chip at all, because a "0 s" chip would claim an
agreement nobody checked; gap categories are shown even at zero, since a measured zero is a result and
collapsing it away would make it indistinguishable from UNKNOWN.

Three planted controls, each verified to fail when the invariant is relaxed. Two are worth recording
because they did NOT fail on the first attempt, for reasons that were mine rather than the code's:

* the day-before fallback control **silently matched nothing** — Biome had collapsed the ternary onto
  one line, so the control text found no target and its "pass" meant only that the patch never applied;
* the null-start control **passed for the wrong reason**: `Math.floor(null / 86400000)` is `0`, so such
  an envelope lands on day 0 where no realistic night collides, and the assertion held whether or not
  the guard existed. The case that actually exercises the guard is a night whose day IS 0, and that one
  reds when the guard is removed. Both lines are kept, with a comment saying why the first is not
  sufficient alone.

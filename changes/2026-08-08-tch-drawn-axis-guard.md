<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator, suite]
brief: TCH-PAT-DRAWN-AXIS-GUARD-2026-08-08-BRIEF.md
---
The shipped three-cornered hat spent a drawn-axis leg as a clock corner — and the field it should have guarded on was never plumbed.

ppgdex-dsp.js:442 warns in-code that "closure, three-cornered hat and PAT all silently accept" a
drawn-axis leg. Since then closure (fitClockClosure) got the §F3 guard and the offline TCH tools learnt
the rule — but two things were still broken in the SHIPPED runtime, proven 2026-08-08 with a runtime
repro against the real modules:

1. fitClockClosure is TOOL-ONLY (exported, never called inside the app). The app runs
   fuseHRVConsensus → _tchHat, which had NO timingSource filter — a `timingSource:'none'` PpgDex (drawn
   axis, no host anchors) was spent as a full TCH corner.
2. Worse: `timingSource` was never plumbed onto the fusion rec. ppgdex exports it top-level, but
   adaptEnvelopeNode never read it, so even closure's §F3 filter read `undefined` and kept every leg.
   The guard was dead in production, not merely absent from _tchHat.

Fix: adaptEnvelopeNode now carries `timingSource` onto the rec (from the export top-level, or hostAxis
for a raw export), and _tchHat excludes `timingSource:'none'` legs before the hat, mirroring §F3 and
surfacing an `excluded` list. null/omitted stays usable, so every existing fixture is byte-unchanged
(GATE B: integrator_tch_golden still reproducible; no fixture output moved).

pat-gate.js needs no change (it verdicts on already-computed summaries and has a shared-clock leg).
pat-feasibility-worker.js IS vulnerable (reads no timingSource; its sharedClock test only checks t0 +
beat-count agreement, which a drawn axis passes) — but its functions are loaded in NO test lane, so a
guard there would be untested. Documented as a scoped follow-up rather than shipping an untested guard.

Re-bundled Integrator.html + OverDex.html (both inline integrator-dsp.js) + docs/Integrator.html.
Full node suite 6021 assertions green; GATE A/B pass; the new test bites (fails against the unfixed code).

---
bump: patch
type: fixed
brief: none
---

Brief drain round 2, DSP/node lane: four briefs re-checked against landings in the files they NAME.

  MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS   43 landings   16 files
  PPG-FOOT-PLACEMENT-FOLLOWUPS           13            2 files
  AUDIT-FOLLOWUPS                        37            28 files
  MULTI-SENSOR-DERIVATIONS-FOLLOWUPS     24            11 files

🔴 A FIRST PASS REPORTED TWO ZEROS AND BOTH WERE WRONG. It derived each surface from the brief's
SUBJECT rather than from the files the brief names — `FINDING_EVIDENCE` resolved to
`integrator-render.js`, `rrMaskOn`/`tvMaskOn` to `cpapdex-dsp.js`, ONE file each. Neither file is
named anywhere in its brief. A one-file surface produces a CONFIDENT zero, which is the worst shape a
negative can take. Re-extracted from the named families with globs resolved: 28 files / 37 landings
and 11 files / 24 landings.

That is a different error from a thin extraction and worth separating: a thin extraction takes the
right kind of thing and too little of it; this took the wrong thing entirely and would not have been
caught by resolving globs alone.

EVERY NEGATIVE AND EVERY COUNT NOW CARRIES ITS FILE COUNT, so a reader can weigh it without
re-deriving the surface. PPG-FOOT-PLACEMENT's 2-file surface is stated as thin rather than presented
as equivalent to the 28-file one.

PPG-FOOT-PLACEMENT WAS CHECKED FOR A SPECIFIC HAZARD AND IT IS NOT PRESENT. A finger-off capture
distinguishes `absence` (value 100) from `in-wear-rail` (0/199) — zero is NOT absence for this device,
zeros occur only while worn — so a claim treating a PPG zero as a gap would be refutable. This brief
makes no such claim: its `zero` references are §∅ denominator language and anchor-set arithmetic.

⚠️ AND THAT VOCABULARY IS STILL NOT ON MAIN. #2675 was described to this session as landed, twice; it
was re-checked both times and is state OPEN, with `in-wear-rail` returning nothing from origin/main.
The hazard is recorded as WATCHED, not cleared — clearing it against an unmerged measurement would be
verifying against something that does not exist yet.

`Affects:` was checked UNANCHORED on all four; none declares one, so every surface is derived from the
files the brief names and every stamp says so.

No done-when is ticked anywhere. AUDIT-FOLLOWUPS has an undated pre-standard filename and is
grandfathered; no `Created:` was fabricated.

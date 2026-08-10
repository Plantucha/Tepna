<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PulseDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
A pulsedex battery — 19 classifications, the fleet's lowest measured rate, and a THIRD zero-kill function confirming the bootstrap problem is a class.

Full sweep: 568 tested, 144 killed, 3 invalid, 421 survivors → 25.5 % (canary NONE). That is the
LOWEST measured rate in the fleet, and the map had it at 42 % — the second of two sampling failures.

Sound families:

  lombScargle        12/12 controls   24 survivors → 15 distinguishable,  9 recorded
  classifyRecording   7/7  controls   23 survivors → 13 distinguishable, 10 recorded

⚠️ TWO MORE ZERO-KILL FUNCTIONS, WHICH MAKES IT A CLASS RATHER THAN A GLUCODEX QUIRK:

  glucodex  genSynthetic           90 survivors, 0 kills   (bootstrapped in #1125)
  pulsedex  compareIntervalSeries  54 survivors, 0 kills
  pulsedex  fragmentation          19 survivors, 0 kills
                                  ---
                                  163 survivors unclassifiable until one test per function

The prober needs a positive control from the same function — a mutant the suite killed, replayed to
prove reach. With zero kills there is nothing to replay, so every verdict is withheld no matter how
good the battery is. 163 of the fleet's mapped survivors are in that state, and no amount of probing
moves them; each function needs ONE test first.

That reframes the remaining work. The programme has been treating "write a battery" as the unit, and
for these three the unit is "write a test, THEN a battery". `compareIntervalSeries` is the largest
single cluster in pulsedex and is the two-signal agreement path — the code that decides whether a
Verity and an H10 agree — so it is worth the test on its own merits, not just to unlock classification.

Still blind, diagnosed: parseRRInput 10/12 — the header-line identity check (L731) and the
intervalCol bound (L742) are unexercised; both need a delimited file whose header is re-encountered
mid-stream and one whose interval column index exceeds the row width.

Every contract was read from source: compareIntervalSeries takes `{vals, tsMs?}` and needs ≥5 CLEAN
intervals after artifactClean; parseRRInput's delimited branch needs ≥2 lines carrying BOTH a `;`/TAB
and a clock-or-ISO stamp; `preferDMY` defaults true and only `=== false` disables it.

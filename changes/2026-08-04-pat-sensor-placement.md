---
bump: patch
type: fixed
brief: PAT-SENSOR-PLACEMENT-CORRECTION-2026-08-04-BRIEF.md
---

The Verity has always been on the **left ankle** (wearer-confirmed, constant across the corpus), the
O2Ring on the right index finger, the H10 on the chest. No brief recorded it; several inferred an
armband from the product name and then used an **arm/wrist PAT band as a plausibility test**.

That test has been applied in both directions: `PAT-NO-VALID-ANCHOR` rejected 406–498 ms lags as
"not physiological for an arm site" (plausible for chest→ankle) and validated other results by their
landing in the 200–250 ms arm band (too short for an ankle). `PAT-VERDICT-CONSOLIDATED` §4.2's premise
that the corpus lacks a long path is also wrong — chest→ankle is the longest available.

Corrects the premise only; the re-analysis of results judged against the wrong anatomy is owed.

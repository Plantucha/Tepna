<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [GlucoDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Bootstrap GlucoDex locateColumns — the sixth zero-kill function, and the band score only becomes testable when two numeric columns compete.

30 survivors, no kills. Internal, but reachable through the exported `parseCSV`, so it needed a test
rather than an export.

It exists because CGM exports do not agree on column order: it scores every column over the first 60
rows — date-likeness picks the timestamp, "mostly numeric AND mostly in a physiologic band" picks
glucose, and the glucose score deliberately subtracts date hits so a numeric-looking date column
cannot win.

The assertions drive the SAME readings through three layouts (time-first, glucose-first, junk column
in front). A fixture with one fixed layout exercises the scoring loop once and cannot tell a working
scorer from a hardcoded `cells[1]` — which is how 30 survivors accumulate here.

⚠️ THE BAND PREDICATE SURVIVED THE FIRST PASS, and the reason generalises: with only ONE numeric
column the scorer picks it whatever the band test says, so `(2–30) || (30–600)` never has to choose.
Putting an out-of-band device counter beside the glucose column makes it load-bearing — measured, the
real code takes 100 while a mutant that ANDs the two bands (in-band true only at exactly 30) takes
900000, reporting a device serial as blood glucose.

That is the same shape as motiondex's `inferAccUnit`: a discriminator is only tested when something
has to be discriminated. One valid input proves the function runs, never that it chooses correctly.

Also pinned: mmol/L detection CONVERTS rather than relabels (5.0 mmol × 18.018 = 90.09 mg/dL — a unit
assertion alone would pass a mutant that detected mmol and forgot to multiply), an out-of-band numeric
column is still chosen because the band score ranks rather than vetoes, and the too-few-readings
refusal names the two columns it wanted.

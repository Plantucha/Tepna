<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the analysis check reads the artifact (Magpie)

**Unit:** residue row `2026-09-28-generator-compared-to-itself-examines-no-artifact`.
**Doc-search query that found the prior work:** `the analysis tool check compares the generator to
itself and examines no artifact` → `briefs/INTEGRATOR-SURFACE-2026-10-11-BRIEF.md:53-70` ·
`tests/dex-tests.js:17136-17149 · runDexTests` · `tests/run-tests.mjs:953-972 ·
readInlineParseCensus`.

## Where this stopped (2026-10-20 08:40Z)

Shipped as **DRAFT #3755** — `claude/anlchk-mg` @ `ba98583f3`, worktree
`~/wt-anlchk-mg`, board entry #453.

- `npm run check` → 39/39 EXIT=0.
- `node tools/build-analysis.mjs --selftest` → 21/21.
- `node tools/verdict-adoption.mjs --check` → green, 274 enumerated and binned, 123 adopted.

## What the unit is

`verify:analysis` re-bundled each served page and byte-compared it with the tree. That is a
generator compared to itself, and the splice that shipped four pages with an unclosed `var __WSRC`
literal passed it: a re-bundle of the same source reproduces the same broken bytes.

`--check` now also audits the committed bytes over three legs that know nothing about the builder —
self-document, size band, worker map. `--selftest` plants each defect in a synthetic page, so every CI
run exercises the detector against the defect. The writer refuses to write a page that fails its own audit.

## Carry these forward

**The row's prior half was already built and the search found it.** `readInlineParseCensus`
(`tests/run-tests.mjs:953-972`) parses 481 inline blocks of the app bundles. Parse is weaker than
content: a block that parses can still be the wrong bytes. The two halves now sit in different
lanes — the census on the app bundles, this audit on the analysis pages.

**The pre-compaction measurement of the size band was wrong, and re-measuring caught it.** A note I
carried said the ratios ran 0.809–0.986, every one below 1. Measured against the raw source bytes
they run 0.9999–1.0013 over 69 blocks: classicify strips almost nothing from these files, and the
two wrapper newlines are what pushes a small file past 1.0. Had I pre-stated a band from the
remembered figure, the gate would have reded on its first run. **Re-measure a figure you are about
to pre-state as a threshold.**

**The band's asymmetry is a measurement, not caution.** Upward the only legal slack is the two
wrapper newlines, so 1.02 holds for any source of 100 bytes or more. Downward classicify strips an
unbounded amount, so the lower bound only has to catch a truncation. A splice is orders of
magnitude, not percent.

**The negative control is the real defect, re-armed.** Putting the replacement string back in
`bundle()` still reproduces the splice on 4 of the 14 pages — the same 4 the 2026-09-28 measurement
named. That is worth more than a planted fixture, because it proves the defect is still reachable
from today's sources. `oxydex-dsp.js:725` still carries the `` $` `` prose that triggers it.

**A new `decides` producer needs its row the same day.** The adoption gate names an unbinned
producer by file (`UNBINNED producer: tools/build-analysis.mjs prints a verdict word`), and a
`decides` row must be GATED — a `--selftest` handler satisfies that by itself. The manifest is
`JSON.stringify(obj, null, 1) + '\n'`: round-trip it before inserting a key, or the diff is the
whole file.

## Owed, not done here

The residue row keeps its OPEN cell. Every PR appends to the end of `RESIDUE.md`, so the closure
rides the next RESIDUE-only PR along with the four rows already queued in
`handoffs/magpie-pulsedex-zero-helpers.md`.

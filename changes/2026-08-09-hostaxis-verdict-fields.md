<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Close parsePPG's three host-axis verdict gaps — reaching them at all needs a file 4x larger than any other case in the group.

`hostAxis` publishes `independent` / `spreadMs` / `inertReason` precisely so a consumer can SEE the
verdict rather than infer it from a ~0 ppm (CLAUDE.md §7). Three mutants survived on those lines.

The reason none of the group's 54 existing cases could reach them: an anchor is sampled on 1 row in
`PPG_AXIS_EVERY = 500`, and `hostAxis` refuses below THREE anchors, so ≥1001 rows are needed before
those lines execute at all. The largest existing case was 400 rows — one anchor, `ok:false`, and a
different branch entirely.

Two 1600-row files on opposite sides of §7's 2 ms independence bound:

  host = device + ~40 ms jitter   spread 58 ms    independent TRUE   inertReason null
  host = device stamp rounded     spread 0.65 ms  independent FALSE  inertReason set

which is the phone-vs-box discriminator itself (0.13–1.00 ms vs 101.89–5124 ms).

Each killed and verified by re-applying its own mutant:

  L677  hostAx.independent !== undefined   RED (2 failing)
  L678  hostAx.spreadMs   !== undefined    RED (2 failing)
  L679  hostAx.inertReason && null         RED (1 failing)
  source restored                          18/18 GREEN, tree clean

`=== undefined ? null : value` mutated to `!== undefined` returns null whenever the value EXISTS, so
asserting the value is STRICTLY the boolean rather than merely truthy is what separates them. And
`inertReason || null` → `&& null` is null always, so only the case that HAS a reason can see it — the
independent file's null reason proves nothing, and both sides are asserted for that reason.

10 of ppgdex-dsp.js's 15 known real gaps now closed.

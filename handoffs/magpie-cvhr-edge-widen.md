<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — CVHR hole-edge exclusion, measured (Magpie)

**Unit:** residue row `2026-10-19-a-cvhr-hole-edge-adds-events-on-covered-seconds`, board #314.
**Doc-search query that found the prior work:** `cvhr event exclusion widened by the detector decision
window rebound search hole edge` → `ecgdex-dsp.js:2530-2609 · surgeConf` · `ppgdex-dsp.js [chunk
213/259]` · `tests/dex-tests.js:57082-57105`.

## Where this stopped (2026-10-20 02:55Z)

Branch `claude/cvhredge-mg` in `~/wt-cvhredge-mg`, two commits on `e77c13040`.
The measurement is complete and the verdict validates.

- `tools/cvhr-edge-widen.mjs` — the deliverable. Four candidate windows, two nodes, a planted phase
  grid and a real-night pass. 17 selftests; registered in `tools/verdict-adoption.json` as `decides`.
- `briefs/CVHR-HOLE-EDGE-EXCLUSION-2026-10-19-BRIEF.md` — PROPOSED, the repair it supports.
- The residue row points at that brief; a new OPEN row logs the mask defect below.

The headline: the shipped rule still adds up to 2 events per hole, the whole decision window removes
the term, and it costs **0.008 events per hole** over 350 measured nights against a pre-stated ceiling
of 2.

## Carry these forward

1. **The exclusion window is the MIRROR of the support window** — 72 s BEFORE a hole, 37 s after. I
   wrote it backwards first and the planted grid still looked plausible.
2. **A planter that oscillates on absolute time shifts the phase of every beat after a splice.** Far
   from the hole a near/far split removes it; near the hole nothing can, and near the hole is the only
   place the edge term lives. The control is a period that DIVIDES the hole. It reversed my
   conclusion from "no window neutralises" to "only the widest does".
3. **A tool with no main-module guard runs its battery on import.** Importing `survivors` from a probe
   ran the whole 2137-stream pass. Both `cvhr-*.mjs` tools now carry the `isMain` idiom.
4. **`--from <saved.json>`, so arithmetic never re-reads the corpus.** The 50-minute pass writes
   `{verdict, rows, refused}` to `.cache/`; every later aggregation reads that.
5. **The mean hid the tail.** 27 of 350 nights lose every event they carry — short fragments with one
   or two events. That is why the brief's acceptance list includes the index DENOMINATOR.

## Next step

The brief's §5 is unbuilt: both nodes take one constant pair, `cvhrIndex` loses the excluded seconds
from its denominator, and a record left with no resolvable span refuses by name. It moves both bundles,
`manifestHash` and `computeHash`, and reds GATE B and GATE C by design — so it owes
`tools/regen-ppgdex-goldens.mjs` and `tools/regen-ecgdex-goldens.mjs`, then a corpus lap through
`tools/verify-fixtures.mjs`. One PATCH bump, one changeset. Do not start it in the same worktree as
any other PpgDex or ECGDex unit: all six PpgDex fixtures and both bundles collide.

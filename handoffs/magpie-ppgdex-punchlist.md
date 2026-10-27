<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — PpgDex algorithm punch-list (Magpie)

**Unit:** `briefs/PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md`, landing order
`4 ✅ → 12 ✅ → 8 ✅ → 1 → 6 → 7 → 2 → 10 → 5 → 11 → [9 experiment]`.
**Doc-search query that found the prior work:** `median pulse foot detector rise time ppgdex morphology
template width` → `ppgdex-morph.js` [chunk 1/4] · `PpgDex Reference.html:497-513` ·
`briefs/PPGDex-BUILD-BRIEF.md:340-360`.

## Where this stopped (2026-10-19 07:15Z)

Item 8 shipped as **DRAFT #3673** — `claude/morphfoot-mg` @ `21f3b2b25`, worktree
`~/wt-morphfoot-mg`, board entry #189. At 07:14Z its checks read 21 pass / 3 pending /
2 skipping. Kestrel's walker undrafts in queue order.

- `npm run check` → all 39 steps passed on the rebased head.
- Browser lane → all green, 11524 passed over 807 groups, with the new label named as run.
- Corpus lap → `PpgDex_2026-06-27_equiv.node-export.json verifiedUnder a48ff5c3263e`.

## Next step

**Item 1 — odd-reflected padding in `filtfilt` (`ppgdex-dsp.js:142-144`) plus a record-median
subtraction.** It waits for #3673 to merge. Both units touch `PpgDex.html`, `provenance/PpgDex.json`
and all six fixtures, so running them in parallel buys a certain conflict. When #3673 lands:
`node tools/wt-done.mjs ~/wt-morphfoot-mg`, then a fresh worktree off `origin/main`.

Item 1 moves fixture OUTPUTS and reds the `env.equiv` PPG leg by design, so it owes
`tools/regen-ppgdex-goldens.mjs` (run `node tools/build.mjs --app PpgDex` FIRST — the regen tool drives
the bundle, not the raw modules) and then the corpus lap.

## Carry this warning forward

The item-8 row claimed "every exported morphology value moves". That holds for the UI and fails for the
export: **morphology never enters `ganglior.node-export`**, so all six fixtures moved hash-only and both
GATE B and GATE C were blind to the defect and to its repair. Items 1, 6, 7 and 10 share the assumption.
Check which values actually leave the node before costing a fixture regen as evidence — item 1's own
"moves every fixture" claim is the next one to test, and `filtfilt` sits upstream of the exported RR
spine, so there it is probably true.

I owe a residue row for that gate blindness and have not logged it: no PpgDex fixture carries a single
morphology value. It waits for the ledger slot (Heron holds it per board #188).

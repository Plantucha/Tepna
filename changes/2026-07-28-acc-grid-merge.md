<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
---
The chest-ACC leg now uses **every** concurrent session instead of only the longest, so ECGDex's per-epoch `motionIndex` covers **100 % of the corpus (was 64 %)**.

**The defect.** `tools/trio-batch.mjs` took the LONGEST H10 ACC session on the reasoning that it "covers essentially the whole sleep window anyway". Measured over 2026-07-16..26 it does not: ECGDex motion coverage ran **39–98 %** of epochs while PpgDex and OxyDex were 100 % on every night. 2026-07-25 lost a contiguous **26-epoch (~130 min) block at the START** — ECG and ACC spanned the same 7.7 h, but the earlier ACC fragments (22:34→23:00, four of them) were discarded. So the correlated-TCH's motion-ρ **third corner saw less of the night than the other two** — the very leg PR #483 added.

**Why it was not simply merged, and what changed.** `accExtras`/`epochMotion` index `deviceACC` as UNIFORMLY sampled from `[0].tsMs`, so a plain concat would time-shift every sample after the first gap. A wrong alignment IS worse than partial coverage, and that reasoning was right — it just left the coverage on the table. The fix keeps the invariant instead of breaking it:

- **The tool** places every session at its TRUE index on one grid at the first session's rate, and fills never-written slots with non-finite samples. Alignment holds **by construction** — an index is a time. Falls back to the longest single session if the grid would be implausibly large (>36 h at 200 Hz), so one wild stamp degrades to today's behaviour instead of allocating a night-sized array.
- **The DSP** treats a non-finite sample as a **HOLE, not a reading**: it lowers coverage `c` and never enters the mean. One NaN would otherwise make a whole epoch's activity NaN. Both epoch accumulators (`epochMotion` and the `accExtras` sibling) get the guard, so a gap epoch still reports `null` — never a fabricated stillness, which is the rule this leg exists to honour.

The DSP half is **inert for every existing caller**: `parseDeviceACC` already drops non-finite rows, so a single continuous session can contain no holes. Confirmed by the gates — no fixture output moved.

**Measured, 2026-07-16..26:** ECGDex motion coverage **648/1020 → 1016/1020 epochs (64 % → 100 %)**, every night 98–100 %; 2026-07-25 78/104 → 103/104; 2026-07-24 35/91 → 90/91. Downstream, `tch-multinight` gains a usable night (**7 of 11 estimated, was 6**), median culprit σ **4.45 → 3.37 bpm**, median σ[ECGDex] 1.98 → 1.38, and 2026-07-24 flips from `correlated` to `correlated-external` — the ρ method now engages where the sparse corner had prevented it.

ECGDex re-bundled (`manifestHash aba9a79e21ac → 854abad30baa`) plus the two orchestrators inlining `ecgdex-dsp.js` and the analysis/docs mirrors. `computeHash` moved, so `DEX_UPLOADS=<corpus> tools/verify-fixtures.mjs` re-ran the app and re-stamped `ECGDex_2026-06-27_equiv` → `verifiedUnder: 207f9b177eaa`; no fixture output moved. `run-tests.mjs` **4194 green, 0 skipped** against the real corpus, `verify-manifest` GATE A 9/9 + GATE B 13 reproducible, `build --check` clean (11 owned).

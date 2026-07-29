<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [PpgDex]
---
`ppgdex-dsp.js sampEn` counts the same pairs **7.8–8.7× faster**, by an EXACT prune — not an approximation, and not a threading change.

**Found by profiling, not by guessing.** A CPU profile of one real night through `tools/trio-batch.mjs` (2026-07-27, 2.86 M PPG samples) put **76.7 % of the entire PpgDex runtime inside a single function** — `phi`, the Sample-Entropy pair counter — at **45.8 s of 59.7 s**. Its own comment called the overnight case a "FUTURE caller that hands SampEn a full overnight `*_PPG.txt`"; that future had arrived, and the MAXN=20 000 cap still leaves ~10⁹ comparisons.

**Two exact prunings, same integers out:**

- **Sort-prune.** A Chebyshev match needs every k within `tol`, so `|nn[i] − nn[j]| <= tol` at k=0 is a NECESSARY condition. Walking indices ordered by `nn[index]` makes i's only possible partners a contiguous run, so the scan `break`s at the first j beyond `tol` — every skipped pair provably fails. On a physiological interval series with `tol = 0.2·SD` the overwhelming majority of pairs fail exactly there, which is the whole win.
- **One pass for both m and m+1.** A pair matching at m+1 necessarily matches at m, and m+1's index range is a subset of m's, so A is counted as a refinement of B rather than walking every pair twice. The single index valid for B but not A is counted in its own small pass.

**Verified equal, not assumed equal.** Against the shipped nested-loop form on 18 966 real H10 RR intervals at N = 2 000 / 6 000 / 12 000 / 18 966: **identical B and A at every size**. End-to-end, all three of last night's PpgDex exports (arm + finger + second segment) are **identical excluding the volatile keys the equiv gate already excludes** (`generated`/`provenance`/`kernel`/`file`).

**Measured:** PpgDex over one night **59.7 s → 16.9 s** (3.5×); the function itself 45.8 s → 4.5 s (10×). After the change no single hotspot dominates — `countPairs` 27 %, `lombScargle` 27 %, `parsePPG` 20 %.

`pulsedex-dsp.js sampEn` already folds A and B into one pass and is not in the hot path (PulseDex runs a night in ~1.5 s), so it is deliberately untouched; the sort-prune would suit it if it ever becomes one.

PpgDex re-bundled (`manifestHash 90efe3dcdf33 → 18c9ac94a725`) plus the two orchestrators inlining `ppgdex-dsp.js` (Data Unifier, OverDex) and the analysis/docs mirrors. **Not export-inert** — `computeHash` moved `31740454decf → b41769f94249`, so `DEX_UPLOADS=<corpus> tools/verify-fixtures.mjs` re-ran the app and re-stamped `PpgDex_2026-06-27_equiv` → `verifiedUnder: b41769f94249`. No fixture output moved, so nothing was regenerated. `run-tests.mjs` **4148 green, 0 skipped** against the real corpus (the equiv/GATE-C legs ran), `verify-manifest` GATE A 9/9 + GATE B 12 reproducible, `build --check` clean (11 owned).

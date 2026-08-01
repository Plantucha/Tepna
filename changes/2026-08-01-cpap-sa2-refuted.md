<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [CPAPDex]
brief: CPAP-SA2-OXIMETRY-SOURCE-2026-08-01-BRIEF.md
---
`CPAP-SA2-OXIMETRY-SOURCE` proposed cross-validating OxyDex's ODI-4 against the CPAP's wired oximeter, on the strength of `SA2.edf` existing across **194 nights at a median 6.83 h**. Executing it refuted the premise.

The ResMed writes `SA2.edf` on every therapy night **whether or not the optional oximeter accessory is attached**, filling both channels with the physical value **−1** when it is not. **193 of 194 nights are entirely that fill.** The accessory was attached exactly once — 2026-06-13, for 2.50 h — which is the corpus total. Every number in the brief's premise is accurate; it measured the presence of a *file* and reported it as the presence of *data*, and a full-length, well-formed, perfectly readable 7.2 h session containing no measurement still reads as 7.2 h of coverage.

**Nothing is broken.** `CpapDsp.oximetryLane` has always required 50–100 % and returns `reason: 'oximeter-not-connected'`, so no sentinel ever entered a computation and no published number is affected — the refutation was already in the codebase under that branch name.

Adds `tools/cpap-sa2-agreement.mjs`: coverage measured as data rather than duration, plus the full comparison (lag-sweep alignment, then Bland–Altman + ODI-4 + nadir/T90 — never Pearson) for the day the accessory is plugged in. Its `--selftest` sharpens the brief's own statistical warning: r isn't *pessimistic* about agreement, it is **uninformative** — it swings 0.99 → 0.01 with the planted bias unchanged, while Bland–Altman returns 1.80 % every time.

---
bump: patch
type: fixed
brief: EDGE-SETTLE-FLOOR-2026-10-18-BRIEF.md
---

- `tools/edge-settle.mjs` reads each night's `.trio-stamp` and measures the nights the fold folded. It walked every directory under `uploads/trio` before. A night the fold REJECTS keeps the exports of whenever it last passed, so the walk pooled two code eras.
- The population was 147 nights, 57 of which the fold rejects. It is now the 90 folded nights. Two of the six proposed floors move. PPG start p95 is 270 s, not 280 s. O2Ring end p95 is 50 s, not 40 s.
- `--all-nights` restores the old walk and reproduces the 2026-10-18 numbers byte for byte. The report names the split either way, so neither population can be read as the other.
- The verdict counts what it did not measure. `checked + excluded = eligible` still describes the whole tree, at two legs per excluded sensor row.
- A root where no night carries a stamp refuses with exit 2 and names `--all-nights`. Measuring nothing is not the same as measuring a clean tree.
- `tools/tch-multinight.mjs` already read this stamp for this reason. The brief's §4.4 caveat claimed the floors came from the nights the hat analyses, and that was false until now.

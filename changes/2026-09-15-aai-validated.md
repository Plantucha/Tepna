---
bump: minor
type: added
brief: none
---

`tools/nsrr-aai-validate.mjs` — a POOL SCORER (not a standalone tool) that validates OxyDex's
`heuristic`-tier Autonomic Arousal Index against SHHS1's expert-scored arousals.

Result, 60 records through `nsrr-score-pool.mjs` at 20 workers in 0.5 min: **median AAI / expert
arousal index 0.2364 ±0.0851** (n=57), expert median 21.3/h against AAI's 5.1/h. AAI under-counts
expert arousals by roughly 4×.

It exports `makeRealm` / `poolScoreRecord` / `liveStat`, so it inherits the pool's parallelism,
checkpoint/resume, SIGKILL-survivability and heartbeat rather than reimplementing them — §2.9 of the
tool-build standard applied to its own author, after a first attempt as a standalone single-threaded
script cost half an hour of looking hung.

⚠️ Records that `edfToOxyRows` returns `{ rows, … }` and not an array. Reading `.length` on it is
`undefined`, so a guard written as `if (!conv.length) continue` skips every record while looking like
a validity check — which produced a fabricated "146 s/record" from a runaway loop. The real cost is
4.1 s.

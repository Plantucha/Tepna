---
bump: patch
type: fixed
brief: none
---

**OxyDex's primary stats builder counted a dropout as a reading.** `computeStats` mapped every row's
SpO₂ and HR into its arrays *including* `null`, and three things then happened to each null: `avg`
summed it as 0 and divided by all rows (a night with 20 % dropouts under-read its mean SpO₂ by 20 %);
`null < 95` is true, so every absent second counted as a desaturated one and T95/T90 were inflated by
the dropout fraction; `Math.min/max.apply` read it as 0. A night with no valid samples at all reported
mean 0, max 0, T95 100 % — the primary-builder half of residue
`2026-09-13-oxydex-stats-block-absence-to-number`, which #2538 had left open after converting the
self-ingest copies and the render.

The blast radius is specific. `parseCSV` drops invalid rows, so the shipped O2Ring path never carried a
null here and the committed fixtures do not move. The **NSRR adapter path does** (`to1Hz` → null), and
its `stats.t90pct` is what the SHHS lane reports — so every published SHHS T90 counted dropouts as
desaturated seconds, and #2725's status masking, which turns flagged samples into nulls, widened that
by exactly the flagged fraction. Filed as its own row.

`computeStats` now builds its arrays from measured samples only; every mean, extreme and rate divides
by the measured count and reports `null` when there is none; `spo2Std` needs two. The row count still
carries the duration. Gated by a `processNight`-driven group with a control: an unmeasured night is
null on all nine scalars, a **half**-measured night reads mean 92 not 46 and T95 over measured seconds,
and a measured night still reads numbers. OxyDex, both orchestrators and six analysis tools rebuilt.

Fleet-Session: Magpie

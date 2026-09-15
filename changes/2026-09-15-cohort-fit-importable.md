---
bump: patch
type: fixed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`tools/cohort-fit.mjs` ran its CLI on **import**, so the one reusable thing in it was unreachable.

Its last two lines called `process.exit(main(...))` unconditionally. Any `import` of `loadCohortGen`
— the module's only library-shaped export — printed the usage banner and killed the importing
process. Measured 2026-09-15: a `cohort-gen` 1.9-vs-2.0 comparison that imported it died with the
tool's own usage text and nothing else, which reads as *the caller* being wrong. **A library
function is not importable if reaching it runs a CLI.**

Fixed with the standard `IS_CLI` entry-point guard. The CLI is unchanged.

The new assertion **spawns a subprocess**, because importability cannot be observed from inside the
module — by the time a selftest runs, the entry-point decision has already been made. Verified
discriminating rather than assumed: putting the bare `process.exit(main(...))` back reds it with
`exit 2` and the usage banner, and restoring the guard greens it.

Filed alongside `briefs/COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md`, which records the owner's
decision to re-cut all six cohort-gen-pinned papers under 2.0 and the prerequisite measurement that
makes the rerun verifiable: **2.0 moves the severe stratum and only the severe stratum** — 12,706 of
12,790 severe profiles differ, against **0 of 37,210** non-severe. That prediction is what each
re-cut number is checked against, so a cohort-wide statistic that moves is a defect in the rerun
rather than a finding about the generator.

⚠️ The brief also records the trap that produced a wrong number on the way: every profile embeds its
own `version` string, so a naive whole-object comparison reports **100 % differing** while measuring
the version stamp rather than the data.

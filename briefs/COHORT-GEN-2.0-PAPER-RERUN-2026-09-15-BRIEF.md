<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS · **Created:** 2026-09-15

# Re-cut the six cohort-gen-pinned papers under `cohort-gen/2.0`

**Owner decision, 2026-09-15:** regenerate all six, rather than staying pinned at 1.9 or
regenerating only where a claim moves.

## Why this exists

`cohort-gen.js` reached **2.0** in #2485, which fitted the severe stratum's shape to real PSG. Every
analysis tool inlines the generator, so the *tools* have carried 2.0 since that merge; it is the
**papers' text** that still cites `synth-gen 2.1 / cohort-gen 1.9`. Nothing is wrong today — the
papers' numbers are the numbers 1.9 produced, honestly labelled — but the label and the shipped
generator have diverged, and a reader re-running a tool would not reproduce the paper.

## The prerequisite measurement — what 2.0 can and cannot move

Measured 2026-09-15 over 50,000 seeds, comparing `sampleProfile(i)` under both versions with the
embedded `version` key excluded from the comparison:

| | 1.9 | 2.0 |
|---|---|---|
| profiles differing | **25.412 %** (12,706 / 50,000) | |
| — of the **severe** stratum | **99.3 %** (12,706 / 12,790) | |
| — of **non-severe** | **0 / 37,210** | |
| `baseAHI` median | 17.40 | 17.40 |
| `baseAHI` p99 | 78.1 | **108.5** |
| `baseAHI` max | 80.0 | **300.0** |
| **severe** `baseAHI` median | 55.10 | **50.80** |

**2.0 touches the severe stratum and nothing else.** That is the prediction every re-cut number must
be checked against, and it is what makes the rerun verifiable rather than merely done: a
severity-dependent statistic should move, a cohort-wide one should not, and a cohort-wide statistic
that *does* move is a defect in the rerun, not a finding about 2.0.

⚠️ **Exclude the `version` key before comparing profiles.** Every profile embeds
`version: "cohort-gen/2.0"`, so a naive `JSON.stringify` comparison reports **100 % differing** and
is measuring the version stamp rather than the data. That wrong number was produced and believed for
several minutes on 2026-09-15 before the profile was printed.

## Scope — the six, verified by call site, not by prose

Nine papers mention `cohort-gen 1.9`. `papers.html` is the index (it restates the others'
provenance) and `dead-ends.html` / `robustness-benchmark.html` mention it narratively. The six with
their own generative tool, each **confirmed to call `CohortGen` at runtime** rather than merely to
cite it:

| paper | analysis tool | `CohortGen.` call sites | severity-dependent? |
|---|---|---|---|
| `nights-icc.html` | `nights-icc-analysis.html` | 4 | cohort-wide — expect NO change |
| `hrv-age-confound.html` | `hrv-confound-analysis.html` | 3 | cohort-wide — expect NO change |
| `rmssd-equivalence.html` | `qrs-equiv-analysis.html` | 1 | cohort-wide — expect NO change |
| `qrs-yield.html` | `qrs-yield-analysis.html` | 1 | cohort-wide — expect NO change |
| `cgm-hrv-coupling.html` | `cgm-hrv-coupling-analysis.html` | 4 | partly — AHI-burden legs |
| `treatment-response.html` | `treatment-response-analysis.html` | 4 | **yes** |
| *(also)* `odi4-ahi-bias.html` | `odi-bias-analysis.html` | 2 | **yes** — §3.2 is real-PSG and unaffected; Tables 1–2 are the synthetic pilot |

Expectations are stated **before** the runs, so a surprise is a finding rather than a rationalisation.

## Driving the tools — constraints already paid for

The tools are browser pages, and two constraints are inherited from
`tools/trio-power-headless.mjs`, whose header records them:

- **Use the RUN BUTTON, not any sync fallback.** The fallback path runs serial and reports a
  different lane.
- **Poll with `page.evaluate()`, never `waitForFunction`.** The pages ship a CSP that refuses
  `waitForFunction`'s string evaluation outright.
- `file://` navigation works (`page.goto('file://' + PAGE)`); no server is needed.
- ⚠️ **These tools expose NO `window.__*` result surface** — unlike the trio page, which publishes
  `__trioResult`. Results are rendered to the DOM only, and each tool's layout differs, so a driver
  must scrape per tool. **This is the bulk of the remaining work and the reason the rerun is not a
  one-liner.** Adding a small result-object surface to each tool is likely cheaper and more durable
  than six scrapers, and would make the numbers machine-checkable against the table above.

## Done when

1. Each of the six tools has been run under 2.0 and its output captured.
2. Every number and figure in each paper is re-cut from that run, or **confirmed identical**.
3. Each paper's `generator` line reads `cohort-gen 2.0`, and `papers.html`'s provenance rows match.
4. Where a figure changed, **both old and current values are stated in-text** — the existing
   convention, recorded at `papers/dead-ends.html` §"Generator provenance", not a new rule.
5. The cohort-wide four are confirmed to have moved NOTHING, which is a result worth publishing
   rather than an absence worth omitting.
6. `npm run check` green; `docs/` rebuilt (papers have served twins).

## Not in scope

Deleting `odi4-ahi-bias.html`'s §0 draft banner. That is a separate owner decision and is tracked on
that paper's own "Remaining before submission" list.

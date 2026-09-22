<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-09-22 (Osprey: the sixth and last, `treatment-response`, re-cut at the yielded n per the 2026-09-21 ruling; `qrs-yield` stands as decided-not-re-cut) · was IN-PROGRESS (re-verified against the tree 2026-09-21, Osprey: FOUR of six re-cut — `rmssd-equivalence` landed in #2584 after the table below was stamped; `qrs-yield` decided not-re-cut; `treatment-response` is an OWNER DECISION on which of three cohort sizes to publish, not a measurement — the only open item, and not executable by a session) · **Created:** 2026-09-15

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

| paper | analysis tool | state (2026-09-17) |
|---|---|---|
| `nights-icc.html` | `nights-icc-analysis.html` | **RE-CUT** #2557, **attribution corrected** #2578 — the 0.75→0.92 reversal is TOOL DRIFT; generator's share 0.0010 |
| `hrv-age-confound.html` | `hrv-confound-analysis.html` | **RE-CUT** #2562 — every headline quantity unchanged; no causal claim, so no A/B owed |
| `cgm-hrv-coupling.html` | `cgm-hrv-coupling-analysis.html` | **RE-CUT** #2563 — unchanged but for glucose↔AHI +0.42→+0.427; Figure 1 deliberately NOT regenerated (composite, layout unrecorded) |
| `qrs-yield.html` | `qrs-yield-analysis.html` | **NOT re-cut** — A/B shows its divergence is tool drift (#2575, #2577). Re-cutting would blame the generator for a sign flip it did not cause |
| `rmssd-equivalence.html` | `qrs-equiv-analysis.html` | **RE-CUT** #2584 (2026-09-16, after this table was stamped — verified in the paper 2026-09-21): harness repaired #2582 on top of #2572's refusal; 240 patients / 220 windows reproduce the published count; electrical equivalence reproduces (−0.011 ms, r 0.9998), the optical figures do NOT — and the 1.9 A/B puts that drift at a FIXED generator (1.9: 7.46 %/0.839; 2.0: +0.3 pp/−0.02), so it is tool drift, not 2.0. Figure 1 not regenerated (composite, layout unrecorded); the "collapses to ≈+1 %" claim retracted as current |
| `treatment-response.html` | `treatment-response-analysis.html` | **RE-CUT 2026-09-22 (Osprey): Table 1 restated at the yielded n — 233 / 239 at ≥ 10 nights on the current tree (the 269 / 317 of 2026-09-17 had moved again; OxyDex #2610/#2745 named as candidates, unverified) — every cell a sourced CLAIM against `analysis/published-numbers/treatment-response-2026-09-22.json`, Wilson / Hanley–McNeil 95 % intervals; the revision note's ODI-4-vs-rMSSD reversal does not hold and is withdrawn.** Was: OWNER RULED 2026-09-21: re-cut at what the generator yields — 269/317 per arm — headline restated at that n with the CI it actually supports. Was: OWNER DECISION, not a measurement (verified 2026-09-21 against residue `2026-09-17-treatment-response-gap-is-not-the-generator` + `…-three-cohort-sizes`): the 1.9 A/B returns 269/317 byte-identical to 2.0, so the generator moves the count by 0; three artifacts claim three cohort sizes (1830 published · 882 in an untracked local CSV with every `nNights` = 12 · 586 at the stated `nSubj: 900`) and the config is not recoverable from the repository. Options and their costs are in the second row; nothing here can be run until one is chosen |

⚠️ **The `expect` column this table used to carry is gone, and deliberately.** It predicted
"no change — cohort-wide" for `nights-icc` and was refuted on the first test; the split it encoded
(cohort-wide vs severity-dependent) is not the one that governs. What governs is the KIND OF
STATISTIC: a variance ratio moves with the severe tail, full-cohort slopes, correlations and rates do
not. And even that only predicts the GENERATOR's share — tool drift is a separate term and is
frequently the larger one, which is what §⛔ above exists to separate.

Expectations are stated **before** the runs, so a surprise is a finding rather than a rationalisation.

## Driving the tools — constraints already paid for

The tools are browser pages, and two constraints are inherited from
`tools/trio-power-headless.mjs`, whose header records them:

- **Use the RUN BUTTON, not any sync fallback.** The fallback path runs serial and reports a
  different lane.
- **Poll with `page.evaluate()`, never `waitForFunction`.** The pages ship a CSP that refuses
  `waitForFunction`'s string evaluation outright.
- `file://` navigation works (`page.goto('file://' + PAGE)`); no server is needed.
- ✅ **FIVE OF THE SIX ALREADY PUBLISH A MACHINE-READABLE RESULT OBJECT.** Corrected 2026-09-15,
  same day, before any work was done on the wrong premise:

  | tool | result global | assigned |
  |---|---|---|
  | `nights-icc-analysis.html` | `window.NIGHTS_ICC` | end of `analyze()` |
  | `cgm-hrv-coupling-analysis.html` | `window.CGM_HRV_COUPLING` | ✓ |
  | `qrs-equiv-analysis.html` | `window.QRS_EQUIV` | ✓ |
  | `qrs-yield-analysis.html` | `window.QRS_YIELD` | ✓ |
  | `treatment-response-analysis.html` | `window.TREATMENT_RESPONSE` | ✓ |
  | **`hrv-confound-analysis.html`** | **none — the only one that needs a surface added** | — |

  So the driver reads one global per tool; it does not scrape the DOM, and five tools need no source
  change at all. That makes the numbers machine-checkable against the delta table above by
  construction.

  ⚠️ **THIS PARAGRAPH PREVIOUSLY ASSERTED THE OPPOSITE — "these tools expose NO `window.__*` result
  surface … a driver must scrape per tool … this is the bulk of the remaining work" — and it was
  WRONG in the way this repo keeps being wrong.** The grep behind it was
  `grep -oE "window\.__[A-Za-z]+"`, which tests a **naming convention** (a leading double
  underscore, copied from `__trioResult`) and not the **capability**. Every real surface here is
  `window.SHOUTY_CASE`, so the query could not have found one however many existed, and its empty
  result was read as absence. Same shape as §4b's *"reported success about something it never
  examined"*, and as the `clock.js` "every bundle" claim in CLAUDE.md §✅. **When a query returns
  nothing, check that it could have returned something** — here, one `grep -oE 'window\.[A-Z][A-Z0-9_]{2,}'`
  would have. Cost of the error: a landed brief that instructed the next session to build six
  scrapers it does not need.

## ⛔ REQUIRED BEFORE ANY DELTA IS ATTRIBUTED TO THE GENERATOR — run the 1.9 A/B

**A re-cut that reports a change "under cohort-gen 2.0" credits the generator with everything the
TOOL has changed since the paper was published.** That is not hypothetical; it has now happened twice,
and once in this brief's own output.

```sh
node tools/analysis-rerun.mjs --paper-scale --only <tool> --cohort-gen <1.9 copy> --out old.json
node tools/analysis-rerun.mjs --paper-scale --only <tool>                          --out new.json
#   old-vs-published = tool drift since publication
#   new-vs-old       = the generator, and only the generator
```

`git show 5c36ff59^:cohort-gen.js` recovers 1.9 (the commit that introduced 2.0). The swap is on-disk
plus a rebuild — the tools inline the generator into their blob workers, so a runtime override cannot
reach cohort generation — and it refuses on a dirty tree.

**What the A/B has established so far:**

| tool | published | @1.9 | @2.0 | generator's share |
|---|---|---|---|---|
| `qrs-yield` precision | 88.8 % | 98.79 % | 98.80 % | **0.01 pp of a 10 pp move** |
| `qrs-yield` rMSSD bias | +83.0 % | −10.4 % | −10.4 % | **none — the sign flip is pre-generator** |
| `nights-icc` ODI-4 ICC₁ | 0.75 | 0.9228 | 0.9238 | **0.0010 of a 0.17 move** |

⚠️ **`nights-icc` was re-cut (#2557) attributing its reversal to 2.0's AHI ceiling, and that was
WRONG** — corrected in #2578. The reasoning had a mechanism, a citation in the paper's own revision
note, and passing controls (rMSSD and CGM-CV did not move, exactly as predicted). It was false anyway.
**Confirming evidence that is real does not make the inference sound**; only running the old generator
separates the two causes, and it costs one run.

⚠️ A positive control comes free and must be read: at 1.9 the structural counts should reproduce the
paper's. They do — `qrs-yield` trueBeats 189,179 exactly, `nights-icc` subjects 5,394 exactly. If they
do not, the swap or the configuration is wrong and nothing downstream is interpretable.

## Done when

0. **For any paper whose numbers MOVED: the 1.9 A/B above has been run, and the text attributes only
   the 1.9→2.0 difference to the generator.** A paper reporting unchanged values carries no causal
   claim and does not need it.
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

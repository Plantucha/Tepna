<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [pulsedex, motiondex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Three defects with one shape: a claim surfaced past the conditions that license it.

## §3.4 — Tri Index graded against a 24 h norm at any duration

`triIdx` was compared to `≥15` — the Task Force 1996 **24 h Holter** cutoff — on every recording, at three
render sites that each replicated the cut-points independently.

The audit's stated mechanism ("scales with recording length by construction") is **wrong**, and it matters:
`N / modalBinCount` is asymptotically `1/p(modal bin)`, so it does *not* scale with N. Measured instead on
four real overnight Polar H10 records:

| window | triIdx (mean) | across windows of one night |
|---|---|---|
| 5 min | 11.20 | **6.49 – 18.46** |
| 30 min | 13.94 | 9.35 – 19.20 |
| 2 h | 15.04 | 12.63 – 19.20 |
| 8 h (whole) | 16.42 | — |

Small-sample bias plus excluded circadian range, saturating near 4 h. The damning figure is the scatter: within
a **single night**, 5-minute windows read 6.46–25.44 across the four records — spanning `bad` **and** `warn`
**and** `ok` on *every one*. Each of those printed a confident grade. Whole-record grades likewise track
duration rather than physiology (6.0 h → `warn`, 1.4 h → `ok`).

The value is still reported at every duration; the **norm comparison** is withheld below Task Force 1996's own
stated ≥20 min precondition for geometric methods. No duration-corrected threshold was invented — there is no
citable one, and fabricating it is the failure mode being fixed. An **unknown** span is ungraded too, matching
the rule set for GlucoDex `clampFloor`: we cannot assert a norm holds for a length we cannot measure.

The three replicated cut-points collapse into one owner, `PulseDSP.triIdxGrade(v, spanMin)`, so the norm can no
longer be applied on one surface and withheld on another. The overview surface spells the OK band `good`; it
adapts that vocabulary rather than re-deriving the cuts.

## §7.7 — a coverage percentage under an amplitude label

Two consecutive MotionDex rows both read **"Effort amplitude"**; the second rendered effort-*present* %, under
the first's `RMS, 0.1–0.6 Hz band` unit context. Distinct quantity, so it gets its own registry id
(`effortPresent`, unit `%`) rather than a relabel. Found by the verification pass, not listed in the brief.

## §7.8 — the fleet's only fail-OPEN badge helper

`motiondex-render.js` called `badgeForLabel(label, false)`; all six siblings pass `fallback !== false`. With
`false`, an unresolved label returns `''` and **the number renders unbadged** — what CLAUDE.md rates as severe
as a wrong unit. Latent only while every label happened to resolve, and §7.7's row was exactly the one that
would not have.

Layering worth recording, established by executing the modules: the **registry's** own default is fail-open in
*every* node (`badgeForLabel(label)` with no 2nd arg returns `''`). The fail-closed contract lives one layer up,
in each render helper. So this is a render-layer defect, gated at that layer. Making the registry default
fail-closed is the stronger fix but touches all 8 registries and re-bundles the fleet — **follow-up, not
smuggled in here**.

MotionDex's helper was also the fleet's only one named `badge()` rather than `evBadge()`, which is why the
badge-by-construction guard never recognised its tiles as badged; renamed, and the file joins `BADGE_ENFORCED`.

## Gates

21 new assertions, mutation-verified in **both** directions — reverting the fix reds the withheld-grade legs,
and over-applying it (never grade) reds the still-graded legs, so the gate cannot be satisfied by simply
refusing to judge anything. Floor boundary pinned on both sides.

`MotionRegistry` was reachable from **neither** test lane; wired into both. §7.8's fleet-invariant leg checks
*every* render surface for a hardcoded `false`, not just the one that broke — the defect's real shape was one
file diverging from six.

`BADGE_ENFORCED`'s self-assert read `Array.isArray(BADGE_ENFORCED)` — vacuously true for any list, which is how
a shipped render file sat outside the set unnoticed. Replaced with an accounting ratchet: every render surface
must be classified as enforced **or** named as unmigrated, so a new one cannot slip through. Verified by
removing MotionDex from the set — the old assert passed, the new one reds.

`ans-design.css` was reverted after measurement: it is inlined into **9 bundles**, so a one-line cosmetic rule
there would move nine `manifestHash`es and force nine re-stamps plus corpus re-verification. PulseDex carries
its own copy and is the only user, so the rule lives there.

`computeHash` moved for both bundles (a DSP change and a registry change are both inside the closure), so
export-inertness is **not** claimed. The corpus run settles it: 3275 passing, **zero skips**, every equiv leg
green — the new fields are render-side and no export moved. Fixtures re-verified with `tools/verify-fixtures.mjs`
against the real corpus.

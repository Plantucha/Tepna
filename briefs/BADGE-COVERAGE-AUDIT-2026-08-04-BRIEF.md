<!--
  BADGE-COVERAGE-AUDIT-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-04 · **Executes:** `AUDIT-FOLLOWUPS-BRIEF.md` §4.2 (the audit half — the remediation is scoped here, not done) · **Affects:** the six node UI layers · **⚠️ Remediation is a fleet re-bundle and must be scheduled**

# Five of eight node apps emit no evidence badge at all — 233 registry metrics behind zero call sites

## 1 · The mandate, and what was actually measured

`CLAUDE.md` §🎫 is unambiguous: *every* surfaced measurement carries an evidence badge — KPI, metric
card, hero number, chart series, table row, chip — in one of exactly two placements (`.ev-corner`
pinned bottom-right, or `.ev` inline before the label). *"A number that reaches a user's eye unbadged
is a **bug**, same severity as a wrong unit."* `AUDIT-FOLLOWUPS` §4.2 recorded that only the Integrator
was ever made compliant and that the six-node sweep was never run. This is that sweep.

**Measured 2026-08-04**, counting `.badge(` call sites in each node's OWN UI layer
(`<node>-render.js` · `-app.js` · `-fusion.js` · `-overview.js` · `-chartbadges.js`), against the
metric roster its registry declares:

| node | registry metrics | `.badge(` in the shipped bundle | of which node-UI | |
|---|---|---|---|---|
| PpgDex | 65 | 7 | **2** | has badging |
| OxyDex | 62 | 5 | **1** | has badging |
| HRVDex | 34 | 5 | **1** | has badging (a loop — see §2) |
| **PulseDex** | **68** | 4 | **0** | ⛔ none |
| **ECGDex** | **77** | 4 | **0** | ⛔ none |
| **GlucoDex** | **42** | 4 | **0** | ⛔ none |
| **CPAPDex** | **38** | 4 | **0** | ⛔ none |
| **MotionDex** | **10** | 3 | **0** | ⛔ none |

**Five of eight nodes, 235 declared metrics, zero per-metric badge emission.** ECGDex is the worst
single case: 77 metrics, no call site anywhere in its UI.

The baseline 3–4 calls present in *every* bundle are shared-module machinery, not badging:
`metric-registry.js`'s own `badge()`/`legend()` definitions plus `dex-profile.js`'s `_badge()` for the
profile panel. Every bundle therefore ships the **engine and the legend strip** while surfacing
unbadged numbers underneath them — which is worse than shipping neither, because the legend advertises
a ladder the view does not use.

## 2 · Two honest limits on this measurement

- **A call site is not a badge count.** `hrvdex-chartbadges.js` badges *every* `.chart-card > h4` from
  ONE call inside a `querySelectorAll` loop, so HRVDex's "1" covers many surfaces. Call-count measures
  *mechanism presence*, not coverage. It is a **lower bound** — which is exactly why the five zeros are
  the load-bearing result: zero call sites cannot badge anything, under any loop.
- **It does not prove the three non-zero nodes are compliant.** OxyDex at 1 call site against 62
  registry metrics is almost certainly partial too. Establishing *their* true coverage needs
  surface-level enumeration, not this scan.

A correction worth recording, since it nearly became the headline: a first pass counted
`class="ev ev-|ev-corner` in the bundles and read 6–8 per app, which looks like partial compliance. Six
of those are `ev-corner` **CSS rules** in the inlined stylesheet and one is `dex-profile.js`'s fallback
template string. Actual per-metric badge emissions in ECGDex.html: **zero**. Count call sites, not
class-name occurrences — the class name appears wherever the styling is defined, not where a badge is
rendered.

## 3 · Why this is not a cosmetic gap

The badge is the only thing distinguishing a `measured` raw sensor value from a `heuristic` one on
screen. Unbadged, ECGDex's staging minutes (`deepMin`, `evidence:'heuristic'`) render with exactly the
authority of its `wholeRecordRMSSD` (`measured`). The suite's own epistemic discipline — the reason
`DEX-SUITE-EXTERNAL-REVIEW-v2` forced the HRV→BP removal, the reason `OXYDEX-PB-OVERCALL` reworded a
screening string — is invisible to the user at the point of consumption on five of eight nodes.

## 4 · The work, and why it is not done here

Remediation touches five `*-render.js`/`*-app.js` layers → **five bundles rebuild** → every
`provenance/<App>.json` re-stamps. Per `CLAUDE.md` §👥.3 that serialises against all other bundle work
and must be announced, not slipped in. It is also not mechanical: each surface needs the *right* metric
id resolved against its registry, which is per-node judgement.

Recommended sequencing, cheapest-first, each independently shippable:

1. **ECGDex** — 77 metrics, the largest gap and the node whose heuristic staging is most easily
   mistaken for measurement.
2. **PulseDex** (68) · **GlucoDex** (42) · **CPAPDex** (38) · **MotionDex** (10).
3. Only then re-measure OxyDex/HRVDex/PpgDex for *partial* coverage (§2's second limit).

**Prefer the loop-decorator pattern** (`hrvdex-chartbadges.js`) over per-call-site edits where the
surfaces are uniform: one decorator that walks `.chart-card`/`.kpi`/`.metric` and resolves the tier via
`<Node>Registry.idForLabel` badges N surfaces from one place, and cannot drift per-surface. It is also
the pattern the `cohesion-badges` gate already understands.

## 5 · Gate it, or it will regress silently

The existing `cohesion-badges` group asserts guide↔registry grade parity for the **reference guides**.
Nothing asserts the **apps** badge anything at all — which is why a mandate written in `CLAUDE.md` in
bold, with an explicit severity comparison, sat unmet on five nodes for six weeks. A gate here should
assert the *floor* this brief measured — every node UI has ≥1 badge call site — and be verified by
mutation (delete a node's decorator; the gate must red). That is a cheap, non-vacuous check that makes
"zero" impossible to reach again, without pretending to measure per-surface coverage.

## Done when

- [ ] Owner picks the sequencing in §4 and schedules the fleet re-bundle against other bundle work.
- [ ] Each of the five zero-nodes emits badges for its surfaced measurements, resolved against its own
      registry (never a hand-assigned tier — `CLAUDE.md` §🎫: the registry is the grade authority).
- [ ] The §5 floor gate lands and is mutation-verified.
- [ ] OxyDex/HRVDex/PpgDex re-measured for partial coverage and either closed or carried forward.

## Cross-references
- Parent: `AUDIT-FOLLOWUPS-BRIEF.md` §4.2 · mandate: `CLAUDE.md` §🎫 · workflow: `CONTRIBUTING.md`.
- Engine `metric-registry.js` (`badge`/`legend`/`BADGE_CSS`) · mirror `dex-badges.css` · grade authority
  `<node>-registry.js` · reference pattern `hrvdex-chartbadges.js` · compliant example `integrator-render.js`.

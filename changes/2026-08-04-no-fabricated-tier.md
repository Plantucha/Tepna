---
bump: patch
type: fixed
nodes: [CPAPDex]
brief: BADGE-COVERAGE-AUDIT-2026-08-04-BRIEF.md
---

CPAPDex's "Cross-Node Corroboration" card rendered a confident `experimental` evidence disc for five
metric ids absent from its registry — including ECGDex's rMSSD, which ECG_REGISTRY grades `validated`,
on a tile captioned "real RR-based HRV": an under-grade of two tiers on a correctly-computed number.
`MetricRegistry.entry` fabricates `evidence:'experimental'` for an unknown id, sets a `_missing` flag
no caller reads, and emits one `console.warn` in a 100%-local app. All five are now registered with
tiers inherited verbatim from a named ECG_REGISTRY sibling (the owning node — a metric's tier is a
NODE fact), and a new gate asserts every id-shaped token passed to a node's `evBadge` exists in that
node's own registry, across 72 call sites and 8 nodes. Also refutes the parent audit's headline: all
five nodes it reported as emitting no badge do badge, via registry-resolved helpers.

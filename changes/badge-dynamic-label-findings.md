---
bump: patch
type: fixed
brief: none
---

**The badge gate scans literal labels only — and a user's meal name renders a fabricated evidence
tier.**

`no-fabricated-tier` is a well-built gate: it asks the resolver the runtime actually uses and carries
three anti-vacuity assertions of its own. Its blind spot is **reach, not correctness** — it collects
tokens with a string-literal regex, so all **63** `evBadge(VARIABLE)` call sites across
`*-app.js`/`*-render.js` are invisible to it. Most are harmless (the variable holds a code-defined
label), and no better regex closes the gap, because the value is not in the source.

🔴 **One live defect sits in that blind spot.** `glucodex-app.js:779` badges each postprandial card
with its **meal name**, and that label is user CSV data (`glucodex-dsp.js:1772`,
`cells[ci.group] || 'Meal'`). Executed against the real registry rather than reasoned about:
`"Breakfast"`, `"Dinner"` and `"my weird lunch"` all resolve to nothing and emit a fabricated
**`experimental`** disc; the deny-listed `"date"` correctly emits none — the control that makes the
others a defect rather than a misreading of the machinery.

The cause is a default: the node `evBadge(label, fallback)` calls
`badgeForLabel(label, fallback !== false)`, so an omitted second argument means `fallback = true`. A
deny-list cannot help — the labels are arbitrary user text.

**The contrast worth copying:** `integrator-render.js:261`'s same-named helper has **no fallback** —
an unknown or empty key yields `''` rather than an invented tier — so the Integrator's four dynamic
sites are clean *by construction*. Two helpers, one name, opposite behaviour on a miss.

⚠️ **Reported and deliberately NOT fixed.** Dropping the meal-name badge is unambiguously right — the
meal is the card's *subject*, not a metric — but it leaves the card's four real measurements
(**peak rise · time-to-peak · +2 h delta · returned-to-baseline**, the four its own caption names)
unbadged, and **none of them exists in `glucodex-registry.js`**. Both halves need registry entries,
and assigning an evidence tier to postprandial kinetics is a **grading decision**: the mandate says a
metric's tier is a NODE fact, never invented ad hoc, so it belongs to whoever grades the node, with a
citation. The suggested shape once graded — register the four, badge them at their values, drop
`evBadge` from the title — is one small PR *after* the tiers exist, and none of it before.

Docs-only: an `audits/` report plus its `DOCS-INDEX` row. No source, no bundle, no provenance.

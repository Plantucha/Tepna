<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — re-run §4's probe) · **last-verified:** 2026-08-31

# The badge gate scans literal labels only — and a user's meal name renders a fabricated tier

> **One finding, one blind spot, one decision the owner has to make.** `no-fabricated-tier` is a
> well-built gate: it asks the resolver the runtime actually uses, and it carries three anti-vacuity
> assertions of its own. Its blind spot is not in its logic but in its **reach**.

---

## 1 · The blind spot: `evBadge('Literal')` only

The gate collects tokens with

```js
/evBadge\s*\(\s*(['"`])([^'"`\n]{1,80})\1/g
```

— a **string literal** argument. Every call site that passes a *variable* is invisible to it.
Measured 2026-08-31: **63 such sites** across `*-app.js` / `*-render.js`.

Most are harmless: the variable holds a code-defined label (a hardcoded KPI array's `k.l`, a metric
name from a fixed list), which resolves exactly as a literal would. **The gate's reach, not its
correctness, is the gap** — and it is a gap that cannot be closed by a better regex, because the
value is not in the source.

## 2 · The live defect: a fabricated tier on user-supplied text

`glucodex-app.js:779` badges each postprandial card with its meal's name:

```js
${typeof evBadge === 'function' ? evBadge(m.label) : ''}${m.label}
```

and that label originates in the user's CSV — `glucodex-dsp.js:1772`,
`label: cells[ci.group] || 'Meal'`. A meal group name can be anything.

**Executed against the real registry**, not reasoned about:

| label | resolves | emits | tier |
|---|---|---|---|
| `"Breakfast"` | false | **true** | **experimental** |
| `"Dinner"` | false | **true** | **experimental** |
| `"my weird lunch"` | false | **true** | **experimental** |
| `"date"` | false | false | — *(deny-listed; the control)* |

So every postprandial card asserts an **evidence grade on a meal name** — a fabricated tier, which
is precisely what `no-fabricated-tier` exists to prevent, in the one shape it cannot see. The
`"date"` row is the control: the mechanism works correctly for labels it knows about, which is what
makes the others a defect rather than a misreading.

The cause is the node `evBadge`'s default: `evBadge(label, fallback)` →
`badgeForLabel(label, fallback !== false)`, so an omitted second argument means **`fallback = true`**
and an unresolved, non-denied label gets the `experimental` disc. A deny-list cannot help here — the
labels are arbitrary user text.

## 3 · The contrast worth copying: the Integrator does not fabricate

`integrator-render.js:261` implements the same-named helper differently:

```js
function evBadge(key) {
  var R = window.MetricRegistry;
  if (!R || !R.badge || !key) return '';
  var e = FINDING_EVIDENCE[key];
  if (!e) return '';
  …
```

**No fallback.** An unknown or empty key yields no badge rather than an invented tier, so the
Integrator's four dynamic sites are clean *by construction*. Two helpers, one name, opposite
behaviour on a miss — and the node default is what makes §2 possible.

## 4 · Reproducing it

```sh
node --input-type=module -e '
globalThis.window = globalThis;
await import("./metric-registry.js"); await import("./glucodex-registry.js");
const R = globalThis.GlucoRegistry;
for (const l of ["Breakfast","my weird lunch","date"])
  console.log(l, !!R.idForLabel(l), !!R.badgeForLabel(l, true));'
```

## 5 · ⚠️ Why this is REPORTED and not FIXED — it needs a grading decision

The obvious fix (stop badging the meal name) is only half a fix, and the other half is not a
refactor:

- The meal name is the card's **subject**, not a metric — badging it is meaningless whatever tier is
  used, so removing that badge is unambiguously right.
- But the card's actual measurements — **peak rise · time-to-peak · +2 h delta · returned-to-baseline**,
  the four the card's own caption names — are **absent from `glucodex-registry.js` entirely**
  (`postprandial`, `peakDelta`, `meal` → zero hits). Removing the meal badge leaves four surfaced
  numbers with no badge, which the coverage mandate also forbids.

Both halves need registry entries, and **assigning an evidence tier to postprandial kinetics is a
grading decision, not an edit**. The mandate is explicit that a metric's tier is a NODE fact that is
never invented ad hoc — so the tier for these belongs to whoever grades the node, with a citation.
Recording the finding is what this document can honestly do; choosing `emerging` vs `experimental`
vs `heuristic` for four new registry rows is not.

**Suggested shape once graded:** register the four measurements, badge them at their values, and drop
`evBadge` from the meal-name title. That is one small PR *after* the tiers exist, and none of it
before.

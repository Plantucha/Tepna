<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-08-19 · **Follows:** `DEX-METRIC-REMOVAL-FOLLOWUPS-II-2026-08-09-BRIEF.md` (DONE — 2026-08-19) · **Affects:** `ppgdex-profile.js`, `ecgdex-profile.js`, `glucodex-profile.js`

# `computeHints()` is dead in three nodes — 26 writes to ids that exist nowhere

## 1 · The finding, and how it was found

`DEX-METRIC-REMOVAL-FOLLOWUPS-II` §2.1 asked for one deletion: PpgDex's `ansAge()`. Its argument for
deadness was that the label writes to `lbl_ppgAge` and **`PpgDex.src.html` has no such id**. Executing
it, the same grep answered a bigger question — the file has **no `lbl_` id at all**, so every sibling
call in the same function is equally unreachable:

| node | `lbl_` ids in `<Node>.src.html` | `set('lbl_…')` calls in `computeHints()` |
|---|---:|---:|
| PpgDex | **0** | 10 |
| ECGDex | **0** | 11 |
| GlucoDex | **0** | 5 |

**26 writes, fleet-wide, none of which can reach a node.** `lbl_ppgWeight` occurs in exactly three
places in the tree: `ppgdex-profile.js`, `PpgDex.html`, and `docs/PpgDex.html` — the source and the two
bundles that inline it. Never in a document that defines it.

## 2 · Dead on TWO independent grounds, which is why this is worth doing

1. **The early return.** `computeHints(r)` opens `if (DP()) return;` — *"unified panel owns the field
   hints now (legacy DOM inputs removed)"* — and `DP = () => global.DexProfile`. Wherever the unified
   panel is present, the body never runs.
2. **The missing ids.** Even if it ran, `set()` is `const l = $(id); if (!l) return;` and no `lbl_*` id
   exists, so every call no-ops.

Either alone kills it. That matters: a future change that removes `DexProfile`, or one that restores a
legacy panel, flips only ONE of the two — and the reader would reasonably conclude the code is live
again. **§2.1's `ansAge` is precisely that hazard realised**, which is why the parent brief ordered its
deletion rather than leaving it guarded.

## 3 · What is NOT claimed

- **Not measured: whether `DP()` is ever false in a shipped bundle.** The id argument makes it moot for
  reachability, but a claim about `DexProfile`'s lifecycle would need its own measurement.
- **Not proposed: deleting the unified panel's hint mechanism.** Only the three orphaned
  `computeHints()` bodies and any helper that becomes unreferenced once they go.
- **Not assumed equivalent across nodes.** ECGDex's 11 and GlucoDex's 5 were counted, not inferred from
  PpgDex — but their *call graphs* have not been read, so a helper shared with a live surface must be
  checked per node before removal.

## 4 · Why it was not done in the parent PR

Scope. The parent asked for one function in one node; this is three functions in three nodes, each
needing its own re-bundle, provenance re-record and `verify-fixtures` pass. Deleting them alongside an
unrelated fix would fuse two work-units into one commit — the failure `CLAUDE.md` §👥.2 records
permanently in `cabd7f7`.

## 5 · Done when

- [ ] Per node, the call graph inside `computeHints()` is read and any helper it uniquely owns is
      identified (PpgDex's `ansAge` was one such; it is already gone).
- [ ] The three bodies are removed, one re-bundle covering all three, with the ids re-counted at
      execution time rather than trusted from this table.
- [ ] A gate — or an explicit decision not to have one — for *"a `set('lbl_X')` whose id exists in no
      `.src.html`"*. ⚠️ Note this is the same shape as the badge-coverage mandate: a write to a surface
      that does not exist is the render-side twin of a metric surfaced without a badge, and this repo
      already prefers such things to fail VISIBLY rather than silently.

## 6 · Related

- `CLAUDE.md` §👥.2 — one work-unit per commit; the reason this is a separate brief.
- The parent's §2.1, whose one-line justification generalised to 26 when the same grep was run without
  the metric-specific filter.

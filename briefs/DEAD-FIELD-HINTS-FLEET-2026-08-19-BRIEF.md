<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** IN-PROGRESS — 25 of 42 removed 2026-08-19 · **Created:** 2026-08-19 · **Follows:** `DEX-METRIC-REMOVAL-FOLLOWUPS-II-2026-08-09-BRIEF.md` (DONE — 2026-08-19) · **Affects:** `ppgdex-profile.js`, `ecgdex-profile.js`, `glucodex-profile.js`

# `computeHints()` is dead in three nodes — 26 writes to ids that exist nowhere

## 0 · ⚠️ THIS BRIEF WAS WRONG THREE TIMES — corrected 2026-08-19 during execution

| the brief said | measured at execution |
|---|---|
| 3 nodes, 26 writes | **5 nodes, 42 writes** — scoped by the function NAME `computeHints`; sweeping by the PROPERTY (*a `set('lbl_X')` whose id is in no `.src.html`*) also finds HRVDex and PulseDex's `computeProfileHints` |
| PpgDex 10 | **9** — #1513 removed the `ansAge` write an hour earlier |
| "remove the three bodies" | **wrong for GlucoDex**, whose `calibRow`/`calibState` half is LIVE |

⚠️ **And the corrected sweep was itself blind:** `lbl_[A-Za-z]+` excludes digits, so it silently missed
`lbl_vo2gt`. Fixed to `lbl_[A-Za-z0-9_]+`. An instrument written to measure this class had the class's
own defect.

**Removed 2026-08-19: PpgDex 9 · ECGDex 11 · GlucoDex 5 = 25. Remaining: HRVDex 6 · PulseDex 11 = 17.**

⚠️ **The two remaining nodes are the GlucoDex shape, not the PpgDex shape** — HRVDex's writes sit inside
a live `updateProfile()`, and PulseDex's `computeProfileHints` has not had its call graph read. Removing
them by pattern is the mistake this section exists to record.

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

⚠️ **CORRECTION 2026-08-19 — ground 2 is stronger than "no-op" for PpgDex/ECGDex.** Those bodies also
read `$('{pre}Height').value`, and `{pre}Height` does not exist either, so the body would have thrown a
**TypeError**, not quietly done nothing. `if (DP()) return;` was load-bearing against a CRASH. Deleting
the body is therefore safer than leaving it guarded — the reverse of the usual instinct.

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

- [x] **DONE for 3 of 5 nodes.** PpgDex/ECGDex: whole body removed. GlucoDex: **surgical** — 5 dead
      writes out, `calibRow`/`calibState` kept, because that half is live. HRVDex and PulseDex still owe
      this read.
- [ ] The three bodies are removed, one re-bundle covering all three, with the ids re-counted at
      execution time rather than trusted from this table.
- [ ] A gate for *"a `set('lbl_X')` whose id exists in no `.src.html`"* — **now known VIABLE**: no `lbl_`
      id is created dynamically anywhere in the tree (checked 2026-08-19), so a static rule cannot
      false-positive on injected markup. Build it WITH the last 17, so it can be seen to RED first. ⚠️ Note this is the same shape as the badge-coverage mandate: a write to a surface
      that does not exist is the render-side twin of a metric surfaced without a badge, and this repo
      already prefers such things to fail VISIBLY rather than silently.

## 6 · Related

- `CLAUDE.md` §👥.2 — one work-unit per commit; the reason this is a separate brief.
- The parent's §2.1, whose one-line justification generalised to 26 when the same grep was run without
  the metric-specific filter.

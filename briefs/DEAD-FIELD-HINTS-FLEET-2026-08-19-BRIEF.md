<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-08-19 · **Created:** 2026-08-19 · **Follows:** `DEX-METRIC-REMOVAL-FOLLOWUPS-II-2026-08-09-BRIEF.md` (DONE — 2026-08-19) · **Affects:** `ppgdex-profile.js`, `ecgdex-profile.js`, `glucodex-profile.js`, `hrvdex-profile.js`, `pulsedex-overview.js`, `pulsedex-render.js`, `pulsedex-app.js`

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

### ⚠️ A FOURTH time — and the remaining count was wrong in the same way, again (closed 2026-08-19)

| §0 said | measured when the last two were executed |
|---|---|
| `Remaining: HRVDex 6 · PulseDex 11 = 17` | **22** — HRVDex is **11**, not 6 |
| PulseDex's writes live in a `*-profile.js` | they live in **`pulsedex-overview.js`**; there is no `pulsedex-profile.js` at all |

The five missing HRVDex sites reach the DOM through a bare `document.getElementById('lbl_…')` rather
than a setter, so **scoping by `set('lbl_X')` could not see them** — the same call-shape blindness §0
already records twice, surviving its own correction. §0 fixed the *character class*
(`lbl_[A-Za-z]+` → `lbl_[A-Za-z0-9_]+`) and left the *call shape* assumed.

⚠️ **A count taken by grepping a nonexistent path reads as `0`, not as an error.** Measuring
`pulsedex-profile.js` returned "0 writes" — clean, plausible, and about a file that does not exist.
That is the repo's own "a check that examined nothing and reported cleanly" failure, inside the
instrument built to close this very class.

### The fleet total depends on the UNIT, and this brief never states which (added 2026-08-19)

A peer recounted the last two nodes as **17** against this brief's **22** and was right — in a different
unit. Both totals are correct; they count different things, and mixing them is what makes the arithmetic
look broken:

| unit | PpgDex | ECGDex | GlucoDex | HRVDex | PulseDex | fleet |
|---|--:|--:|--:|--:|--:|--:|
| `set('lbl_X')` **call sites** | 9 | 11 | 5 | 6 | 11 | **42** |
| `lbl_*` **references**, any call shape | 9 | 11 | 6 | 11 | 11 | **48** |

- **42** is what this brief's own `25 + 17` arithmetic counts, and it is an **undercount of the
  defect** — it cannot see `_setSub(…)` or a bare `getElementById('lbl_…')`.
- **48** is the number of writes that could not reach a surface, which is what "dead field-hint write" means.
- **GlucoDex is the tell**: 5 hints, 6 references — `lbl_gluA1c` is written twice.

⚠️ **Neither number is wrong; a number without its unit is.** Quote the unit beside the count, or the next
reader has to choose between two true figures with nothing to choose on — which is exactly the
re-derivation this brief's §0 exists to prevent.

⚠️ **A stale count outlives the code.** `git grep -c "set('lbl_" glucodex-profile.js` still returns
**1** on current main. It is a **comment** (line 333, prose describing the removal), not a surviving call —
a raw grep count cannot tell code from the prose written about it.

**The gate's premise was independently re-measured, by the session that raised the count** — no
`lbl_` id is constructed anywhere on main: zero `'lbl_' + …`, zero `"lbl_" + …`, zero
``lbl_${…}``. So a static rule cannot miss one, and the property-based gate is sound rather than
merely convenient. That sweep also found **zero live `lbl_` references fleet-wide** — every surviving
occurrence in tracked `.js` is a comment describing the removal, plus the gate's own assertions. The class
is **closed**, not merely reduced.

**The fix now matches by PROPERTY, not by call shape** — any `lbl_*` string literal, whatever syntax
reaches it — and that rule is what the §5 gate enforces, so the blindness cannot return.

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

- [x] **DONE for all 5 nodes.** PpgDex/ECGDex: whole body removed. GlucoDex: **surgical** — 5 dead
      writes out, `calibRow`/`calibState` kept, because that half is live.
- [x] **HRVDex — surgical (11 sites).** Its writes sit inside a **live** `updateProfile()`, so only the
      dead statements went: `altFactor` stays (it feeds `window._hrvProfileAlt`), and the VO₂ projection
      block keeps `window._projVO2` + `renderANSAgeCard()` — only the `lv.textContent` line inside it was
      removed. Orphaned by the removal and therefore also gone: the `_setSub`/`_set` helpers and `idealW`.
      `vo2Est` and its chain were checked and **kept** — used at lines 86/89/112, not only by the dead write.
- [x] **PulseDex — whole function (11 sites).** `computeProfileHints` was dead on **two** independent
      grounds, the PpgDex shape rather than the GlucoDex one §0 feared: it opens
      `if (!document.getElementById('profSex')) return;` and `PulseDex.src.html` defines no `profSex`, so
      it returned at its first line on every call. Removed with its two call sites
      (`pulsedex-overview.js`, `pulsedex-render.js`), its `window` export, and the now-orphaned `nu` import.
- [x] The bodies are removed, **one re-bundle per affected node**, with the ids re-counted at execution
      time rather than trusted from this table — which is how the 17→22 correction above was found.
- [x] A gate for *"a `set('lbl_X')` whose id exists in no `.src.html`"* — **now known VIABLE**: no `lbl_`
      id is created dynamically anywhere in the tree (checked 2026-08-19), so a static rule cannot
      false-positive on injected markup. Build it WITH the last 17, so it can be seen to RED first. ⚠️ Note this is the same shape as the badge-coverage mandate: a write to a surface
      that does not exist is the render-side twin of a metric surfaced without a badge, and this repo
      already prefers such things to fail VISIBLY rather than silently.

      **Built and seen to RED first.** `dead-field-hints` (`tests/dex-tests.js`, fed by
      `run-tests.mjs readNodeSurfaces`) resolves every `lbl_*` literal in a node's inlined JS against the
      ids that node's own `.src.html` defines. Run against pristine `main` it **failed with exactly the 22**
      (HRVDex 11 · PulseDex 11) while all six already-cleaned nodes passed — so it discriminates rather
      than merely failing. Against the fix: 17/17 green.
      - **Matched by property, not call shape** — the specific blindness that made this brief wrong twice.
      - **Sources read from each `.src.html`'s own `<script src>` list**, never globbed, so a module added
        to a node is covered automatically.
      - **Anti-vacuity leg:** each node asserts its sources were actually read (`N js file(s), N bytes`)
        before its verdict is believed — a node whose files went unread would otherwise contribute no
        references and report "clean".
      - It reads its own surface list rather than `env.srcHtml`, which omits MotionDex and carries
        Integrator; a node missing from that list would have contributed zero ids and passed vacuously.

## 6 · Related

- `CLAUDE.md` §👥.2 — one work-unit per commit; the reason this is a separate brief.
- The parent's §2.1, whose one-line justification generalised to 26 when the same grep was run without
  the metric-specific filter.

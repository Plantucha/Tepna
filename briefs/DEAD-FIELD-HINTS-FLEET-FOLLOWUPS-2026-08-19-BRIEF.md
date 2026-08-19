<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-08-19 · **Follows:** `DEAD-FIELD-HINTS-FLEET-2026-08-19-BRIEF.md` (DONE — 2026-08-19)

# HRVDex's legacy profile DOM is gone, and more than the label writes is unreachable

Executing the parent removed 22 dead `lbl_*` writes. Finding the HRVDex half required reading the
guards around them, and those guards say something larger than the parent scoped.

## 1 · The finding

`HRVDex.src.html` defines **no `prof_*` id at all** — the unified `DexProfile` panel replaced them.
Measured 2026-08-19 against `HRVDex.src.html` (133 ids):

| id the code reaches for | present in `HRVDex.src.html` | consequence |
|---|---|---|
| `prof_weight` / `prof_height` | **absent** | `applyAgeNorms` returns at `if (!weightEl \|\| !heightEl) return;` — its whole tail never runs |
| `prof_age` | **absent** | `updateProfile`'s persistence block is gated on it and never runs |
| `profileZones` | **absent** | the "Populate HR zones separately" block never renders |
| `ansAgeCard` | **absent** | `renderANSAgeCard()`'s target does not exist |

So the dead label writes were the *symptom*. Whole guarded blocks are unreachable on the current
surface, and the file still reads as though it drives a legacy per-field profile form.

## 2 · Why this was NOT done in the parent PR

The parent's scope is *a write to an id no surface defines*, which is decidable by a static rule and
is what its gate enforces. **This is a different and larger claim** — that a guarded block is
unreachable — and it needs the call graph read per function, plus a decision the parent cannot make:
whether the guards are dead weight or deliberate defensive coding kept for a surface that may return.

⚠️ The parent brief was wrong four times by generalising from a pattern without re-measuring. Removing
these blocks by the same reflex would repeat exactly that, one level up.

## 3 · What to decide

- **(a) Remove the unreachable tails** — smaller files, but it discards the defensive guards that make
  the functions safe if a profile surface is ever restored.
- **(b) Keep them and say so** — a one-line rationale comment per guard naming the absent id and the
  date it went absent, so the next reader does not re-derive this. Cheapest, and matches how
  `_META_DENY` records its exceptions rather than hiding them.
- **(c) Extend the gate** — generalise `dead-field-hints` from `lbl_*` to *any* `getElementById`
  literal that no `.src.html` defines. ⚠️ **Measure the false-positive rate first**: ids ARE created
  dynamically elsewhere in the tree (the `lbl_` prefix was safe precisely because it is not), so the
  general rule is not known to be sound. A noisy red gets routed around rather than read.

**(b) is the lean default.** (c) is only worth building if the measured false-positive rate is near
zero — establish that before writing the gate, not after.

## 4 · Done when

- [ ] The four guards above carry either a removal or a dated rationale, decided as one unit.
- [ ] If (c) is attempted: the false-positive count over all 8 nodes is measured and recorded here
      FIRST, and the gate is seen to RED on a planted case before it is believed.

## 5 · Related

- `DEAD-FIELD-HINTS-FLEET-2026-08-19-BRIEF.md` §0 — the four corrections, and the call-shape blindness
  that survived its own fix twice.
- `CLAUDE.md` §🎫 — the badge-coverage mandate this class mirrors: a surface that does not exist and a
  metric with no badge are the same defect seen from two sides.

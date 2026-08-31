<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — re-run the scan in §3) · **last-verified:** 2026-08-31

# The ungated surface — producer-dependent safety, swept

> **The class.** A render/app guard whose correctness rests on an **unstated invariant of its
> DSP/producer**. The `||` default is the common carrier: `x || fallback` silently replaces a
> legitimate **0** with something else, so the code is correct only while "0 never occurs" — a fact
> about the producer that the reader cannot see from the consumer.
>
> This surface (`*-app.js`, `*-render.js`, `integrator-*`) has **no equivalence gate**, so nothing
> catches this class mechanically. That is why it was swept by hand.

**Result: CLEAN NEGATIVE across 26 files and 100 candidate sites. No live defect.** Three sites are
safe only because of a producer invariant, and those are named in §2 so a change to the producer is
understood to have this consequence.

---

## 1 · Why the negative is trustworthy — the scan was controlled first

⚠️ **An empty scan is a result only after the scan has been shown to see.** The model case is
`oxydex-render.js`'s pre-fix vacuous green (`9b1ddec0~1`, fixed in #1626), and every pattern here was
required to flag it before any empty result was believed.

**Three control failures, each of which would have shipped a confident wrong sweep:**

1. **The pattern could not match its own model case.** The first scan was line-based; the model
   defect puts `||` at end-of-line with its default on the next. It returned **empty across all 26
   files** — a clean sweep from an instrument structurally incapable of finding the one defect known
   to exist.
2. **It found the right thing and pointed at the wrong place.** Comments were blanked with
   `' ' * len(match)`, which replaces newlines too, so every line number after a block comment
   shifted. The control reported the defect at **:314**; it is at **:404**.
3. **The control itself examined nothing and reported success.** The check was
   `python3 scan.py … | grep -E ':40[0-9]' | head -3 && echo "✓ can see"`. `head` exits 0 on zero
   matches, so the `&&` fired and printed the success line while grep had matched nothing —
   CLAUDE.md §4b *inside the control that certifies the instrument*. Re-done by counting matches
   into a variable and asserting on the count.

Only (3) was caught by habit. (1) and (2) were caught by insisting the scan flag `9b1ddec0~1`.

## 2 · The three producer-dependent sites — safe today, and why

| site | the shape | the invariant that makes it safe |
|---|---|---|
| `integrator-dsp.js:404` | `_dig(…dawn.medianDelta) \|\| _dig(…riseMgdl) \|\| …` — a 0 falls through to a different key | `glucodex-dsp.js:2063` writes `medianDelta` **only when `present`**, and `present` requires ≥20 mg/dL. ⚠️ The in-memory `r.dawn` *does* carry sub-20 values (`glucodex-app.js:752` renders them); only the **export** drops them. Safety is a property of the export shape. |
| `motiondex-render.js:151`/`:183` | `sqi.flags && sqi.flags.length ? … : 'clean'` — an absent `flags` renders the literal **"clean"** | `motionSQI` returns a `flags` array on **every** path, including its `< 10 rows` early return (`flags:['no-data']`), and MotionDex has no `loadOwnExport`, so the projected `sqi: summary.sqi.conf` export form never re-enters this render. ⚠️ The same line renders an absent `conf` honestly as `'—'` — an asymmetry that reads like an oversight rather than a decision. |
| `ecgdex-app.js:695` · `ppgdex-app.js:488` | `UI.poincare(r.poincareNN \|\| r.nn, r.sd1, r.sd2)` | Both producers assign `poincareNN` unconditionally (`ecgdex-dsp.js:2585`, `ppgdex-dsp.js:4131`), so the fallback never fires. ⚠️ If it ever did, the ellipse would no longer match the cloud — SD1/SD2 are computed from `repSeg`, and the fallback plots `nn`. The comment above it states that requirement; nothing enforces it. |

**None is a defect. All three would become one if their producer changed**, and none of the three
consumers could tell.

## 3 · What was swept, and how the 100 resolve

26 files: every `*-app.js`, `*-render.js`, and `integrator-*.js`. Scan: a numeric read defaulted with
`||`, comment- and string-blanked, multi-line aware.

| bucket | n | why safe |
|---|---|---|
| `x \|\| 0` | 41 | **harmless by construction** — a falsy 0 defaults to 0 |
| `devicePixelRatio \|\| 1` | 6 | DPR is never legitimately 0 |
| `document.head \|\| documentElement` | 6 | DOM nodes, never 0 |
| presence tests over objects (`_hasSP`, `_hasCI`) | 2 | operands are objects; always truthy |
| array chains (`poincareNN\|\|nn`, `tausMin\|\|taus`, `vals\|\|vals.length`, `windows\|\|…`) | 6 | arrays are truthy even when empty |
| individually verified | the rest | see §2 and below |

Notable individual resolutions:
- `cpapdex-render.js:198` — `Math.max(1, Math.ceil(night.therapyHours \|\| 1))`: the `\|\| 1` is
  **redundant** under the enclosing `Math.max(1, …)`, and it sizes a chart bucket array, not a rate
  denominator. A 0-hour night renders an empty chart, not a fabricated rate.
- `ecgdex-render.js:234` · `ppgdex-render.js:215` — `!this.sqi.length \|\| this.sqi[k] >= 0.3`:
  absent SQI colours every R-peak normally. The alternative (all red) would be a false alarm, so
  showing normally is defensible — but a viewer cannot distinguish *"quality checked and fine"* from
  *"quality never checked"*. Recorded, not changed: a third state is a design decision.
- `oxydex-app.js:284` — `(_td.secs \|\| _td.sec \|\| 0)`: the `_td.sec` limb is **dead** (the
  producer writes only `secs`, `oxydex-dsp.js:3140`), and the terminal `\|\| 0` makes `secs === 0`
  resolve correctly regardless.
- `ecgdex-app.js:639` — `!r.longRec \|\| r.ambulatory ? 'neutral' : …`: absence yields **`neutral`**,
  not `ok`. This is the honest shape, and the counter-example to the class: an absent precondition
  declines to grade rather than grading favourably.

## 4 · Re-running it

The scan is a throwaway; the **method** is the artifact. Control against a known-true case, then
sweep, then resolve each hit against its producer. If it is ever rebuilt: blank comments while
**preserving newlines**, match across line breaks, and assert the control by a **counted** match
rather than a pipeline's exit status.

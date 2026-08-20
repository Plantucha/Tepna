<!--
  CROSS-DEVICE-DRIFT-FOLLOWUPS-2026-08-17-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-17 · **Follows:** `CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md` §5 (per-device σ + inverse-variance items, both executed 2026-08-17) · **Affects:** `clock.js` field naming, `tools/dual-clock-rate.mjs`, two stale brief headers

# What executing the per-device σ item surfaced

`CROSS-DEVICE-DRIFT-AND-CLOSURE` §5's "measure against the capture host" is done: 344 streams over 16
box nights, `tools/device-stability.mjs`, gated by `device-stability · per-device-sigma`. This brief
carries what turned up on the way and is **not** part of that work unit.

---

## 1 · `hostAxis.stability`'s σ fields are named `…Ms` and are not milliseconds

`clock.js` publishes `atShortestMs` / `atLongestMs`. `allanFromPhase` is handed phase in **ms** and τ
in **seconds**, so its `adev` is a fractional frequency in **ms/s** — which is exactly why the same
object computes `ppmUncertainty: adev * 1000`. If the field were milliseconds that multiplier would
be wrong.

So the two names understate their own values by 1000× to anyone who reads them as written. Nothing
is numerically wrong today — every in-repo consumer either uses `ppmUncertainty` or treats the value
opaquely — but this is a unit mislabel in shipped spine code, and CLAUDE.md rates a wrong unit at the
same severity as a wrong number. `HOSTAXIS-STABILITY` §2's own prose already writes the correct unit
("194 ms/s @ 0.15 s"), so the brief and the field disagree.

- **Fix:** add `atShortestPpm` / `atLongestPpm` alongside, deprecate the `…Ms` pair in comment. Additive,
  so no consumer breaks — the same additive discipline `stability` itself shipped under.
- **Cost:** `clock.js` is a **shared-spine change** (CLAUDE.md §👥.3) — it re-stamps all 8
  `provenance/<App>.json` fragments and serialises against every bundle-touching PR. That is the whole
  cost; the edit is three lines. Land it with other spine work, not alone.
- ⚠ Do **not** rename in place. `atLongestMs` is read by `ecgdex-dsp.js`'s export block.

## 2 · `tools/dual-clock-rate.mjs` has the defect this work found and fixed, mitigated by luck

`MAX_CRYSTAL_SPREAD_PPM` refuses a device whose fragment rates disagree by more than 50 ppm — by
**raw max−min spread**, with no reference to how precise each fragment's rate is. That is the rule
`device-stability.mjs` started with and had to abandon: it failed **25 of 40 device-nights**,
including 10 H10 nights, and would have contradicted `WEARABLE-DRIFT-DIRECT` §1's ±2–3 ppm. A
−21.0 ± 2.4 ppm fragment and a −119.5 ± 309 ppm one are the same measurement, and max−min calls them
a 98 ppm disagreement.

**`dual-clock-rate` is protected today only by its length filter** (fragments > 3 MB, `MIN_SPAN_MIN`
60), which happens to exclude the imprecise fragments rather than reasoning about them. That is a
mitigation, not the rule being right, and it fails the moment someone lowers the filter or meets a
corpus of uniformly short fragments.

- **Fix:** give it the same uncertainty-aware verdict — `hostAxis.stability.ppmUncertainty` is already
  available to it, since it already builds the axis. `device-stability.mjs crystalVerdict` is the
  reference implementation and is gate-backed by value (two mutants: a raw-spread rule and a
  uncertainty-blind fallback each kill assertions).
- **Do not** simply copy it — two implementations of one rule is what the `detector-stability` parity
  group exists to police. Promote one and have both call it.

## 3 · ~~Two brief headers say PROPOSED for work that shipped~~ — ONE does; I read the other from a stale checkout

> ### ⛔ CORRECTED 2026-08-17, same day, by the author. HALF OF THIS SECTION WAS FALSE.
>
> **`HOSTAXIS-STABILITY-2026-08-13-BRIEF.md` reads `DONE` on `main` and did when this was written.**
> I read it from the shared root checkout, which is **248 commits behind `origin/main`**, and reported
> a header that had already been flipped. The claim about what SHIPPED (`hostAxis.stability`, the
> `independent === false` refusal, the MINSTD pin, ECGDex's export) is correct — the claim about the
> HEADER was not, and the header was the point of the section.
>
> **Why the checkout is stale is worth more than the correction.** `tepna-sync-main.timer` runs every
> 15 min and is healthy; the service logs `SKIP — 175 uncommitted/untracked path(s) — never sync over
> someone's work`. **The guard is behaving correctly** — it must not fast-forward over another
> session's uncommitted files. But the consequence is that the shared tree froze 248 commits ago, so
> *every* session reading a brief, a DSP or a gate from the root checkout gets a stale copy and cannot
> tell. That is a worse failure than the one this section reported, and it is invisible: the file
> opens, parses and looks current.
>
> **The lesson, which is this brief's own thesis turned on itself:** a status read from a checkout is
> a statement about that checkout, not about `main`. Read briefs from a fresh worktree
> (`git worktree add … origin/main`) or via `git show origin/main:<path>` — never from the shared root
> unless you have just confirmed it is current. Confirm with `git rev-list --count HEAD..origin/main`
> **and** `git status --porcelain`; the ref count alone reads 0 while the tree is hundreds of files
> stale (CLAUDE.md §👥.2b).

**What survives, verified against `origin/main` rather than the stale tree:**

- **`WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md` — still `PROPOSED`.** §6 carries **7 `[x]`** plus one
  `[~]` (a same-day retraction record, not an open item), and §7.5 records the three-source closure
  **closing 4 of 4 box nights** with `tools/beat-leg-closure.mjs` shipped. This one is a genuine stale
  header.

The flip is still not done here: a status flip claims every acceptance item was verified, and verifying
them is its own work unit. Whoever takes it should re-run the Done-when list — and read it from
`origin/main`.

## 4 · The real precondition for inverse-variance weighting is still unbuilt

§5's inverse-variance item is answered NO for a reason that names what would change it: a **per-channel
σ of the offset estimate**, not a per-device clock σ. §3.4 observes the estimator already computes each
channel's curve, so the quantity is close to hand. Nobody has extracted it.

This is the one item in that thread that is genuinely open rather than refuted, and it is small.

## 5 · Recorded, NOT acted on — the PAT item belongs to another thread

`CROSS-DEVICE-DRIFT-AND-CLOSURE` §5's remaining `[ ]` ("PAT re-tested under drift-aware alignment")
reads as open, while the **same brief's §3.6** argues both routes to it close — an alignment fitted by
maximising beat coincidence has already absorbed the transit it would be used to measure. That
tension was deliberately left in place: `PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md` is **IN-PROGRESS**
and `PAT-UNDER-PERBLOCK-ALIGNMENT` has withdrawn its own title claim, so the PAT thread is live and
owned elsewhere. Closing another session's item from outside is the §📌 collision, and it produces no
merge conflict when it goes wrong.

**Owed by whoever owns PAT:** either close that item against §3.6, or state why §3.6 does not bind it.

## 6 · ~~`tools/doc-search.mjs` is not on `main`~~ — WITHDRAWN, it is

> ### ⛔ WITHDRAWN 2026-08-17, same day, by the author.
>
> `tools/doc-search.mjs` **is on `main`**. The `MODULE_NOT_FOUND` I hit came from invoking it in the
> shared root checkout, which is 248 commits behind and predates the file — the same staleness that
> produced §3's false half, reaching a different conclusion from the same cause.
>
> The shape is worth keeping even though the finding is not: **an absent file and a stale checkout are
> indistinguishable at the call site.** `MODULE_NOT_FOUND` is evidence about the tree you ran in, never
> about the repository. Before concluding a tool does not exist, check `git show origin/main:<path>`.

## 7 · Done when

- [ ] `atShortestPpm` / `atLongestPpm` added additively to `hostAxis.stability`, on the next spine PR
- [~] **HALF DONE — #1530, 2026-08-19.** *Sharing one implementation* is done: `dual-clock-rate.mjs`
      imports `crystalVerdict` and delegates through a pure `crystalCoherence()`, its duplicate
      `MAX_CRYSTAL_SPREAD_PPM` is now a re-export, and a 14-assertion group
      (`tools · clock · crystal-single-source`) asserts the two entry points agree across the boundary
      and the corpus extremes — because a shared implementation nobody checks is just a claim about
      the past. Behaviour preserved exactly (`[0,50]` crystal, `[0,50.1]` not).

      ⚠️ ***Reads uncertainties* is NOT done, and cannot be from this side.** `dual-clock-rate.mjs`
      computes **no per-fragment uncertainty at all** — no `ppmUncertainty`, `sigma` or `stderr`
      anywhere in it — while `device-stability.mjs` sources its own from σ_y at the recording's own
      span, i.e. from Allan machinery this tool does not run. So the shared verdict takes its
      **no-uncertainties branch** and falls back to the raw bound. That is the correct behaviour, not
      a shortfall: the branch exists to refuse inventing a σ, and a fabricated error bar would make
      every spread explicable. **§2's "protected today only by its length filter" therefore still
      stands** — the filter excludes imprecise fragments rather than reasoning about them. Closing
      this half needs σ_y computed in `dual-clock-rate`, which is a separate work-unit.
- [x] **DONE — verified 2026-08-19.** `WEARABLE-DRIFT-DIRECT-2026-08-02` already reads
      **`Status: DONE — 2026-08-17`** (*"every §6 item re-verified against the tree, and the recorded ppm
      caveat DISCHARGED BY RE-MEASUREMENT"*). Its Done-when list is fully `[x]`; the single `[~]` is a
      **retraction note**, not open work — it withdraws a same-day "cannot be run on this corpus" claim
      after the author found they had checked the wrong artifact.

      **Spot-checked against the tree rather than taken on the header's word**, since a status line is
      exactly the thing this repo keeps finding stale:
      · `tools/dual-clock-rate.mjs` exists (13 584 B) — *"shipped as a tool, not left in a scratch script"* ✓
      · its no-second-clock refusal is present (`independent`/`spreadMs` guards) ✓
      · `papers/wearable-clock-drift.html` carries the scope-note retraction ✓

      ⚠️ **That last one nearly went down as a defect.** A case-sensitive grep for `Corrections` returned
      **0** while `90–216` still appeared **4 times**, which reads as *"the retraction never landed."* It
      had: case-insensitively the paper has 23 correction mentions, and every `90–216` occurrence is
      **retraction context** — *"contradicted by a direct measurement"*, *"it is retracted as a statement
      about the device"*, *"≈7 ppm, not 90–216"*. The figure is present **because** it is being retracted.
      Presence of a retracted number is not evidence the retraction is missing; read the context.

- [ ] per-channel offset σ extracted, or recorded as declined with a reason
      > **Investigated 2026-08-19 — still open, but sharper, and one premise in §4 needs correcting.**
      >
      > **§4 says `inverseVarianceWeights` is "exported" and idle. It is exported AND USED** — at
      > `integrator-tch.js:428`, inside the three-cornered-hat decomposition. What is true is the
      > narrower claim: **`fitClockOffsetPooled` (`integrator-dsp.js:5611`) does not use it**, and the
      > two sit one file apart. "Exported without meeting" reads as unused; it is not.
      >
      > **`device-stability.mjs:152` already declines to reuse it, with a measured reason** — and its
      > comment claims to close this very item: *"(This is the §3.4 open item, answered with a
      > reason.)"* ⚠️ **It answers a DIFFERENT CONSUMER's question.** Its reasoning is that
      > `inverseVarianceWeights` **floors each σ² at 8 % of the largest**, to stop a near-zero σ²
      > capturing all the weight on short records — and that where the σ span two orders of magnitude
      > (2.4 ppm against 376 ppm) *the smallest is the most trustworthy*, so the floor would discard
      > exactly the fragment carrying the answer. Decisive for `device-stability`. **It says nothing
      > about `fitClockOffsetPooled`, whose per-channel σ separation is precisely the unmeasured
      > quantity this box asks for.**
      >
      > So the extraction is still the thing to do, and it now has a **decision rule attached**: if
      > `fitClockOffsetPooled`'s per-channel σ turn out widely separated, the floor makes
      > `inverseVarianceWeights` the wrong function there too, for the reason already written down
      > next door. If they are comparable, the floor is harmless and equal weighting was never
      > costing much either. **Either way the σ answers it — which is why this box, not the wiring,
      > is the open item.**
      >
      > ~~NOT done here: the extraction needs a corpus pass, and bulk traversal of the corpus trees is
      > one of the operations currently wedging on this volume (18 processes in D-state).~~
      > *(The volume fault is over — the checkout moved to ext4 on 2026-08-19 and a corpus pass is
      > cheap again. The extraction was attempted; what stopped it was not the disk.)*
      >
      > ### ⚠️ 2026-08-20 — the box's own PREMISE is false: `zAtPeak` SATURATES, so there is no σ to extract
      >
      > §3.4 reasons that the estimator "already computes each channel's curve", so a per-channel σ is a
      > matter of *recording* what exists. **Measured, it is not.** Planting a known offset with a known
      > jitter and sweeping the jitter over a 24× range gives ONE value of the recorded quantity:
      >
      > | planted σ (s) | 0.5 | 1 | 2 | 4 | 8 | 12 | ~16 |
      > |---|---|---|---|---|---|---|---|
      > | `zAtPeak` | 11.45 | 11.45 | 11.45 | 11.45 | 11.45 | 11.45 | falls |
      >
      > It only moves once σ approaches **half the ±`matchSec` window**, i.e. when the match starts
      > failing outright. `zAtPeak` is a **match-count**, not a precision proxy: within the window every
      > beat matches regardless of how tightly it matches, so the height carries the number of pairs and
      > the *width* carries the precision. The width is computed inside `fitClockOffsetPooled` and never
      > recorded. **So the decision rule above cannot be evaluated from the current exports** — this box
      > needs NEW machinery (record the support width, or a σ from the half-height crossings), not a
      > corpus pass over existing fields. That is the correction owed to §3.4, and it is why the box
      > stays open rather than closing as "declined".
      >
      > **The attempt was not wasted — it surfaced a shipped, user-visible defect (#1549, merged).**
      > `ownOffsetSec` was biased low by almost exactly `matchSec`, at every true offset:
      >
      > | `matchSec` | 10 | 20 | 30 | 45 | 90 |
      > |---|---|---|---|---|---|
      > | own-offset bias (s) | −7 | −17 | −27 | −42 | −87 |
      > | pooled bias (s) | +0.5 | +0.5 | +0.5 | +0.5 | +0.5 |
      >
      > Same cause as the saturation, one level down: the ±`matchSec` window makes the peak a **plateau
      > ~2·`matchSec` wide**, so its argmax is biased and its support-weighted centroid is not.
      > `fitClockOffsetPooled` already applies that centroid correction — its own comment says *"the
      > argmax landed 37 s low; the centroid lands within a second"* — but applied it to the pooled
      > value ONLY, leaving the per-channel `ownOffsetSec` on the raw argmax. `integrator-app.js:95`
      > renders that number as *"(own peak N min — does NOT support this offset)"*, so a channel that
      > agreed could be shown to the user as dissenting. Fixed by mirroring the pooled support+centroid;
      > all five windows now read +0.5 s. Gated by `integrator-dsp · clock-fit-pooled · own-offset-bias`
      > (11 assertions, sweeps `matchSec` 10/20/30/45/90, with an anti-vacuity leg).
      >
      > **The transferable shape:** a quantity that is *derived from* a search over a window inherits
      > that window's resolution, and a plateau-argmax is biased by half its width. Two independent
      > defects here — one blocking a measurement, one shipping a wrong number to a user — are the same
      > mistake about what a match window does.
- [x] ~~`doc-search.mjs` landed or its citations removed~~ — WITHDRAWN 2026-08-17: it was already on `main` (§6)

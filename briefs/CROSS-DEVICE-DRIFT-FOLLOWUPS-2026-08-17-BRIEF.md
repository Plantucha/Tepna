<!--
  CROSS-DEVICE-DRIFT-FOLLOWUPS-2026-08-17-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-27 · **Created:** 2026-08-17 · **Follows:** `CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md` §5 (per-device σ + inverse-variance items, both executed 2026-08-17) · **Affects:** `clock.js` field naming, `tools/dual-clock-rate.mjs`, two stale brief headers


> ### ✅ FLIPPED TO DONE 2026-08-27 — every box is closed, and the one `[~]` is not closable from here
>
> 4 `[x]`, 1 `[~]`, **zero open**. The partial item says so itself: *"Closing this half needs σ_y computed
> in `dual-clock-rate`, which is a separate work-unit."* `dual-clock-rate` computes no per-fragment
> uncertainty at all, so the shared verdict correctly takes its no-uncertainties branch — the brief argues
> that is right behaviour, not a shortfall, and I agree. Recorded here as a **deferred sub-item inside a
> DONE brief** (§📌 permits exactly that) rather than holding the whole brief open on work that belongs to
> another one.
>
> **What the sibling thread concluded, for the reader arriving from §5:** the per-device σ work this brief
> follows now has a measured downstream limit. The host-leg closure **cannot gate the PAT re-test on this
> corpus** — and the reason is not sample size. In the 7 bandable nights the verdicts separated
> **perfectly by band width**: every night with a tight (informative) band FAILED, every night that passed
> held a loose one. **A dispersion-derived band used as an inclusion gate anti-selects for measurement
> quality**, so "passing" enriches for the nights least fit for the downstream use. See
> `CROSS-DEVICE-DRIFT-AND-CLOSURE` §PAT box.

# What executing the per-device σ item surfaced

`CROSS-DEVICE-DRIFT-AND-CLOSURE` §5's "measure against the capture host" is done: 344 streams over 16
box nights, `tools/device-stability.mjs`, gated by `device-stability · per-device-sigma`. This brief
carries what turned up on the way and is **not** part of that work unit.

---

## 1 · ✅ DONE 2026-08-20 — and the mislabel was NOT harmless: it reached a user-facing card

`clock.js` publishes `atShortestMs` / `atLongestMs`. `allanFromPhase` is handed phase in **ms** and τ
in **seconds**, so its `adev` is a fractional frequency in **ms/s** — which is exactly why the same
object computes `ppmUncertainty: adev * 1000`. If the field were milliseconds that multiplier would
be wrong.

So the two names understate their own values by 1000× to anyone who reads them as written.

> ### ⛔ CORRECTED 2026-08-20 during execution — this paragraph's central claim was FALSE.
>
> It read: *"Nothing is numerically wrong today — **every in-repo consumer either uses
> `ppmUncertainty` or treats the value opaquely**."* That is what made the item look cosmetic for
> three days, and one `git grep` refutes it.
>
> **`ppgdex-app.js` renders BOTH fields to the user, labelled `ms disagreement`.** They are σ_y in
> ms/s — a *rate*. The long-τ card is wrong by a factor of **τ**: it displayed `0.0065` as
> milliseconds where the disagreement over a 60-minute window is ~23 ms. The short-τ card only looked
> right by arithmetic accident, because τ₀ ≈ 1 s makes the multiplier ≈ 1.
>
> So this was a **shipped, user-facing wrong unit**, not an internal naming wart — the severity
> CLAUDE.md §📏 actually names.
>
> ⚠️ **The warning below also names the wrong file.** `atLongestMs` is NOT read by `ecgdex-dsp.js`;
> its readers are `integrator-dsp.js`, `ppgdex-dsp.js` and `ppgdex-app.js`. The instruction it carries
> (do not rename in place) is right; its evidence was not.

This is a unit mislabel in shipped spine code, and CLAUDE.md rates a wrong unit at the same severity
as a wrong number. `HOSTAXIS-STABILITY` §2's own prose already writes the correct unit
("194 ms/s @ 0.15 s"), so the brief and the field disagree.

- **Fix (EXECUTED):** `atShortestPpm` / `atLongestPpm` added alongside, `…Ms` deprecated in comment.
  Additive, so no consumer breaks. **Twice over** — `ppgdex-dsp.js` keeps its own copy because PpgDex
  does not inline `clock.js` (§✅), so the pair had to be added in both and they stay in step by hand.
- **Also fixed, and the reason the item was worth more than its three lines:** the PpgDex card renders
  **ppm** with σ_y(τ) labels instead of `ms disagreement`, plus a paragraph saying why no millisecond
  figure is offered. **ppm rather than a converted duration is deliberate:** σ_y(τ)·τ is a time error
  only up to a **noise-type-dependent factor** (TDEV's √3 holds for white PM alone), so rendering that
  product as plain ms would swap a wrong *unit* for a fabricated *precision*, and doing it honestly
  would mean routing the classifier's verdict into display to produce a number **less** comparable than
  the one it replaced. Recorded at the render site so it is not "fixed" back to ms later.
- **Cost, as predicted:** a spine change — 11 bundles rebuilt. ⚠️ Measured while executing: **no
  analysis tool inlines `ppgdex-*` at all** (0 of 10), so the third-tree rule binds here through
  `clock.js` (via `odi-bias-analysis.html` + `resp-acc-analysis.html`), not through the node.
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

## 4 · ✅ DONE 2026-08-20 — and it was not unbuilt, it was computed and discarded

§5's inverse-variance item is answered NO for a reason that names what would change it: a **per-channel
σ of the offset estimate**, not a per-device clock σ. §3.4 observes the estimator already computes each
channel's curve, so the quantity is close to hand. Nobody has extracted it.

This is the one item in that thread that is genuinely open rather than refuted, and it is small.

> ### ✅ EXECUTED 2026-08-20 — it was closer to hand than "close to hand"
>
> `fitClockOffsetPooled` **already computed the interval and threw it away.** `ownLo`/`ownHi` bound the
> lags a channel alone cannot distinguish from its own peak, by the identical *"within 1 unit of the
> peak"* rule the pooled `spreadSec` uses; they were consumed as the centroid window for
> `ownOffsetSec` and then dropped. So this was a **publish**, not a derivation — now
> `rec.ownSpreadSec`, present-and-null on the refusal paths like its siblings.
>
> **The transfer condition was checked, not assumed.** The 1-unit rule is only meaningful on a
> unit-noise statistic. `zc` is a per-channel z and the pooled `Z` is those summed over √n, so both are
> unit-noise by construction and the rule carries over unchanged.
>
> 🔴 **It is a RESOLUTION, not a σ, and it ships under a name that says so.** §3.4 wants a per-channel
> *precision* so `inverseVarianceWeights` can replace the pooled fit's equal weighting. This is the raw
> material and **not** the weight: mapping a support width to a variance requires assuming a peak
> shape, and asserting one would manufacture precisely the precision the weighting exists to measure.
> The width ships in the unit it is actually in and **the mapping remains a deliberate open step** —
> the same discipline as #1587's σ_y ppm fields, one thread later.
>
> **Behaves like a measurement:** 15 / 35 / 55 s of support for match windows of 10 / 20 / 30 s,
> tracking the ~2·matchSec plateau the window creates. Gate-backed by a leg a published constant fails
> (planted: hard-wiring 42 reds *"a wider match window widens the support it resolves to"*).
>
> **Still owed for inverse-variance weighting, and now the only thing owed:** a defensible width→σ
> mapping. That is a statistics decision, not an extraction.

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

- [x] **DONE 2026-08-20** — added additively to `hostAxis.stability` **and** to `ppgdex-dsp.js`'s own copy; the user-facing `ms disagreement` render fixed with it. Full `npm run check` green (8110 assertions, 518 groups, 0 failing).
- [x] **DONE — the second half landed 2026-08-27; see the closing note below.** *(was HALF DONE, #1530, 2026-08-19)* *Sharing one implementation* is done: `dual-clock-rate.mjs`
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

      ### ✅ CLOSED 2026-08-27 — σ_y lands, and the naive version was wrong by 300×

      `dual-clock-rate.mjs` now emits **`ppmUncertainty`** per fragment, delegated end to end: the
      residuals about its own fitted line are already a phase series in ms, `clock.js`'s
      `allanFromPhase`/`allanSlope` do the statistics, and nothing is reimplemented here.

      ⚠️ **The obvious implementation is wrong, and its own data says so.** Reading σ_y at the house
      reference τ (256 s) gives **317 ppm** for an H10 fragment whose rate is −19.1 ppm and whose three
      fragments agree to **1.1 ppm** across the night. That figure is real — it is BLE delivery jitter at
      short averaging times — but it is not the uncertainty of a rate fitted over 295 minutes, and a
      317 ppm bar **makes every spread explicable**, which is exactly the fabricated-bar failure the
      no-uncertainties fallback exists to prevent. Shipping it would have satisfied this box's letter
      while defeating its purpose.

      **What is quoted instead is σ_y at τ = the fragment's own span**, reached by extrapolating along
      the fitted Allan slope from the longest *measured* point — a factor of ~4, anchored on data. The
      slope is used numerically; **no noise type is named** (the spine deliberately refuses to name one
      near a boundary, and nothing here needs the name).

      | fragment | span | rate | σ_y at span |
      |---|---|---|---|
      | H10 | 295.4 min | −19.1 ppm | **3.43 ppm** |
      | H10 | 199.4 min | −19.3 | **4.79** |
      | H10 | 87.6 min | −18.2 | **10.60** |
      | Verity | 162.0 min | −25.5 | **18.33** |

      Three checks it passes that the 256 s version failed: the bars **bracket** the observed 1.1 ppm
      inter-fragment spread, they **shrink with span** (a longer fragment determines a rate better), and
      a drawn-axis fragment still yields **no bar at all**.

      **The χ² branch is now reachable** — verified directly: entries with bars return a finite `chi2`
      (80.66 on a planted wide spread) where the same entries without bars return
      `note: 'no uncertainties; raw-spread bound only'`. `crystalCoherence` now surfaces `chi2` and
      `note` so a reader can see **which branch decided**; collapsing both to a boolean is how the
      fallback stayed invisible. The `spread ≤ MAX_CRYSTAL_SPREAD_PPM` fast path is untouched, so known
      crystals are still crystals without needing a bar.

      Gates: `tools · clock · crystal-single-source` 14/14, `independence` 34/34, typecheck clean.
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

- [x] **DONE 2026-08-20** — extracted as `ownSpreadSec`, the per-channel support **width**, deliberately NOT called σ: the width→variance mapping needs an assumed peak shape and stays an open step. It was already computed and discarded, so this was a publish rather than a derivation.
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

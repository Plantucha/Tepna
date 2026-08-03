<!--
  CLOCK-AXIS-AND-RENDER-SURFACE-FOLLOWUPS-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-02 (**§2 wave 3 and §3 EXECUTED — see §7.** cpapdex-render is 144/319 = 45 %; the matchRecall cross-site scan landed. §1 the host-axis spec and §5 the canvas-harness decision remain.) · **Created:** 2026-08-02 · **Follows:** `CLOCK-MUTATION-AUDIT-2026-08-02-BRIEF.md` §7.6

# What the clock audit left behind: an unspecified host-axis, and 125 reachable render mutants

`CLOCK-MUTATION-AUDIT` closed all five of its items. Executing it surfaced three things that are real,
bounded, and deliberately **not** folded into it — one of them because it is a specification question
before it is a testing one.

## 1 · The host-axis fit is now `clock.js`'s weakest region — and it is UNSPECIFIED

20 of the 37 surviving mutants sit in `clock.js:260-370`: anchor collection, the `need ≥3 host anchors`
guard, the sliding-window median, the `CK_AXIS_MAX_PPM` sanity bound, and the binary search.

**This is not simply "write more tests".** The §2.x guards were straightforward to gate because
`CLAUDE.md`'s Clock Contract states what they must do — *"any out-of-range component ⇒ null"*, *"any row
with day-component > 12 ⇒ file is unambiguous"*. The Contract documents the **parser**. The host-axis fit
arrived later, with the capture-host work, and **the Contract says nothing about it**. Several survivors
are loop bounds, `opts = opts || {}` defaults and window-edge clamps where the correct behaviour is
genuinely unstated — asserting them now would pin whatever the code happens to do today, which is how a
test becomes a change-detector rather than a contract.

**Do this in order:**
1. Write the host-axis section of the Clock Contract — what a valid anchor set is, what the ≥3 minimum
   protects against, what `CK_AXIS_MAX_PPM` rejects and why that bound, and what the fit returns when it
   refuses. Owner-ratified, in `CLAUDE.md`, alongside §1-§6.
2. **Then** gate it, boundary-and-rejection per §7.2's pattern (a one-sided test kills the `||`→`&&`
   mutant and leaves every `<`→`<=` alive).
3. Re-run `node tools/mutate.mjs --file clock.js --limit 500` and record the delta. The baseline to beat
   is **86/123 = 70 %**; the axis block is worth ~16 points on its own.

Related context that should inform the spec, not be re-derived: `[[wearables-drift-87ppm]]`,
`[[wearable-host-axis-fix]]`, `[[vigil-box-clock-facts]]`.

## 2 · `cpapdex-render.js` — 125 reachable mutants remain (wave 3)

Two waves took it 0/12 sampled → **118/319 = 36 %**, both test-only. Remaining survivors: 69 canvas ·
7 DOM-only · **125 reachable**. The two biggest blocks:

- **`renderHistory` (29)** — needs a `CPAPCross.buildLongitudinal` fixture of ≥ 2 nights. This is a
  fixture-construction job, not more of the same, which is why it was not folded into wave 2. It is the
  single largest reachable block left in the file.
- **`cpapClinicalSummary` (20)** — partially asserted already; the remainder is the provenance/build-stamp
  block and the multi-night header paths.

The 69 canvas survivors need a canvas stub or jsdom to reach at all. That is a **harness** decision with
fleet-wide consequences (every `*-render.js` has the same shape), so it belongs in its own brief rather
than as an aside here — flagged, not scoped.

## 3 · `matchRecall` is implemented TWICE, and only one copy is gated

`cohort-regression.js:226` and `cohort-runner.html:293` carry independent implementations of the same
greedy one-to-one recall matcher — same `[−10 s, +60 s]` window, same semantics, different code and
different return shapes (a bare ratio vs an object with `recall`/`precision`/`matched`). Neither is
generated from the other. `CLOCK-MUTATION-AUDIT` §7.4 gated the `cohort-regression.js` copy; the runner's
copy — **the one that actually drives the cohort** — is ungated.

They are not equally robust: the runner commits its match *after* the inner loop (`if (hit >= 0)`), so its
one-to-one property is structural; `cohort-regression.js` increments *inside* the loop and depends on the
`break`, whose deletion returns a recall of 2.0.

This is the **cross-site agreement** class the suite already gates by source scan (the DesSev band scan,
DA-II §2.2 — two sites grading the same number, no executable entry spanning both). Same treatment fits:
assert that both sites convert seconds→ms, test `d >= lo && d <= hi` signed-and-inclusive, and carry a
used-set guard. It needs `cohort-runner.html` + `cohort-regression.js` added to `readSources()`'s whitelist
in **both** runners (`tests/run-tests.mjs` and `Dex-Test-Suite.html`), plus the anti-vacuity assertion the
DesSev scan uses (a scan that finds nothing must FAIL, not pass by silence).

## 4 · One dead branch, recorded not fixed

`cpapdex-render.js`'s `cpapClinicalSummary` has an `else if (ahi != null)` fallback that is **unreachable by
construction**: the preceding `if (ahi != null)` unconditionally pushes a finding, so `findings.length` is
non-zero whenever that condition could hold. Its "well controlled; leak and usage within range" string can
never render. Dead, not wrong. Removing it is a render change owing a re-bundle, so it should ride the next
behavioural CPAPDex bundle rather than justify one.

## 5 · Done when

- [ ] The Clock Contract has a host-axis section, owner-ratified in `CLAUDE.md`.
- [ ] The axis guards are gated boundary-and-rejection, each verified by re-applying the exact mutant.
- [ ] `clock.js` re-run exhaustively; the delta against **86/123** recorded.
- [x] `renderHistory` + `cpapClinicalSummary` asserted; the new `cpapdex-render.js` rate recorded. — **§7:
      118/319 → 144/319 = 45 %.** `renderHistory` 29 → 15 survivors, `cpapClinicalSummary` 20 → out of the top six.
- [x] The `matchRecall` cross-site scan lands with its anti-vacuity leg, in both runners. — PR #726. Five
      mutants of `cohort-runner.html`'s previously-ungated copy confirmed killed; the anti-vacuity leg verified
      by deleting each source-list entry in turn.
- [ ] A decision recorded on whether the fleet gets a canvas harness (its own brief) or the 69 canvas
      mutants are accepted as out of scope permanently.

## 6 · A method note worth carrying forward

Across the two render waves, **four assertions were wrong while passing**, and mutation found all four:
an absent-metric test written with `undefined` where only an explicit `null` discriminates
(`isFinite(null)` is `true`); a one-to-one ratio that coincidentally survives a deleted `break`; a
disjunction tested with only one disjunct present; and a row-count blind to *position*. None would have
been caught by reading, by coverage, or by the test passing.

The generalisation: **an assertion written from reading the code tends to encode the code's shape rather
than its contract.** Re-applying the mutant it is supposed to catch, before believing it, costs seconds
and is the only step that reliably separates the two. `tools/mutate.mjs --file X --dry-run` lists a
module's mutation surface without running anything, which makes this cheap enough to do by default.


## 7 · EXECUTED 2026-08-02 — §2 wave 3 (`renderHistory` + `cpapClinicalSummary`) and §3

**`cpapdex-render.js`: 118/319 → 144/319 = 45 %.** Test-only, as both earlier waves were — no source
change to the module, no re-bundle.

| wave | rate | what it covered |
|---|---|---|
| baseline | 0/12 sampled | one entry point (`renderReviewView`), two substrings |
| 1 | 61/319 = 19 % | the per-night card bands |
| 2 | 118/319 = 36 % | hero tiers, oximetry, sessions, event timeline |
| **3** | **144/319 = 45 %** | **`renderHistory` (29 → 15), `cpapClinicalSummary` (20 → out of the top six)** |

`renderHistory` was skipped twice for a real reason — it needs a multi-night fixture routed through
`CPAPDSP.buildLongitudinal`, which is fixture construction rather than more of the same shape. That turned
out cheap once the input shape was read: `buildLongitudinal` takes plain night objects and degrades to
`crossNight: null` without `CPAPCross`, so the trend-row block is asserted only when cross-night data
actually arrives.

**The sharpest thing in that function is a SORT DIRECTION, and it is the opposite of its neighbour's.**
`cpapClinicalSummary` sorts **ascending** (oldest → newest) because it reports "latest night" from the
tail; `renderHistory`'s per-night table sorts **descending** (newest first) because that is how a log
reads. Both are deliberate and they are 500 lines apart in one file. A "consistency" cleanup unifying them
would silently invert one surface — the summary would report the *oldest* night as latest, or the table
would list the oldest night at the top. Both directions are now pinned, so neither can be tidied into the
other.

Also closed in this wave: the findings ladder's four bands asserted **at each edge** rather than by value
(wave 1 pinned AHI 40 severe and AHI 3 well-controlled, which leaves every `<` → `<=` alive); the local
`sev`'s four inclusive edges; four KPIs' decimal places (an index at 0 dp loses the distinction between
4.4 and 4.6 either side of a band edge); and the two `els.length > 1` multi-night suffixes.

**Two more assertions of mine were wrong while passing — six now, across three waves.** Both were caught
the same way, and both are the *same shape* as earlier ones, which is the point:

- *Compliance renders 67 %.* True, and free of the polarity: `sev(70, 50, pct)` is higher-better, and
  adding a `lower` flag turns 67 % from `warn` into `ok` **without moving the number**. Asserting a printed
  value says nothing about the class beside it. Now pinned at all three bands.
- *A night with no oximetry reads "no SpO₂".* Asserted with a session whose `oximetry` block is **absent**,
  where `s.oximetry` is already falsy — so deleting the `.available` half of the guard changes nothing.
  Only a block that is **present but `available: false`** discriminates. This is the third appearance of
  exactly this absent-vs-explicitly-negative confusion (after `fnum`'s `null` and `oximetryCard`'s own
  availability guard), which is enough to call it a house pattern rather than three accidents.

**Remaining: 175 survivors — 69 canvas · 7 DOM-only · 99 reachable.** The top three are now *all* canvas
(`drawAhiByHour` 27, `drawNightTrend` 24, `drawPressure` 16); the largest reachable blocks are
`renderHistory` 15, `crossCard` 11, `heroCard` 10. The canvas block is 39 % of what is left and cannot be
touched without the harness decision in §5 — which is the honest reason 45 % is where this stops being
cheap.

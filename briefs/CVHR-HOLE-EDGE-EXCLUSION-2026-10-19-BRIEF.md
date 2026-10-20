<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-10-19

# CVHR: exclude the decision window, not the hole

> **Rule 0:** `cvhr event exclusion widened by the detector decision window rebound search hole edge`
> → `ecgdex-dsp.js:2530-2609 · surgeConf` · `ppgdex-dsp.js [chunk 213/259]` ·
> `tests/dex-tests.js:57082-57105`. No prior brief covers the edge term; the residue row
> `2026-10-19-a-cvhr-hole-edge-adds-events-on-covered-seconds` is its origin and
> `PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md` §#2 treatment (3) is where it was logged.

## 1 · The defect

Both CVHR detectors — `cvhrFromNN` (PpgDex) and `detectCVHR` (ECGDex) — drop an event stamped on a
second that a dropout spans, **and only such a second**. The decision at second `s` nonetheless reads
far outside `s`. A planted hole therefore adds events on seconds the hole does not span, in both nodes.

The comment at `ecgdex-dsp.js:2367` and its copy at `ppgdex-dsp.js:3028` argue the opposite: the 1 Hz
resample holds the last rate flat across a hole, so the residual decays to zero inside it and the
envelope gate stays shut. That is right about the INSIDE of a hole and silent about its EDGES.

## 2 · The support chain, read off the code

| stage | what it reads | reach from `s` |
|---|---|---|
| `sm[s]` | mean of `hr[s−2 … s+2]` | ±2 |
| `lo = ma(sm, 23)` | `sm[s−11 … s+11]` | ±25 |
| `hiCut = ma(sm, 4)` | `sm[s−2 … s+2]` (even width, trailing) | ±6 |
| `res = hiCut − lo` | both of the above | ±25 |
| `env[s]` | mean of `|res[s−12 … s+12]|` | ±37 |
| dip-to-rebound loop | `res[u]`, `u = s+8 … s+48`; `res[s+47]` itself reaches `s+72` | −37 … +72 |

**The decision at `s` rests on `hr[s−37 … s+72]`.**

## 3 · ⚠️ The exclusion window is the MIRROR of the support window

Because the decision looks FORWARD 72 s and BACKWARD 37 s, a hole `[h0, h1]` contaminates every `s`
with `s >= h0 − 72 && s <= h1 + 37`. The widen reaches **72 s BEFORE the hole and 37 s after it** — not
the other way round. Writing it the intuitive way round is a real error: this tool had it that way first,
and the measurement did not catch it, because the planted holes sit mid-record.

## 4 · What was measured

`tools/cvhr-edge-widen.mjs` (verdict `cvhr-edge-widen`). Four candidates: `current` (the shipped rule,
the hole's own seconds), `res` (±25), `env` (±37), `full` (72 before, 37 after).

**⚠️ The planted battery alone cannot answer the question.** `plant` oscillates on ABSOLUTE time, so
splicing a hole of `holeSec` shifts the phase of every post-hole beat against the control's; past the
hole the two legs do not carry the same beats. Far from the hole that shows as a count difference the
near/far split removes. NEAR the hole no split can separate a phase-shifted dip from a fabricated one —
and near the hole is the only place the edge term lives. Measured: the 18 of 51 cases that read
unneutralised are exactly the holes whose shift lands near antiphase (11 s, 13 s, 15 s, and 45 s, 75 s,
105 s — the last four all 15 mod 30). **The control is a period that DIVIDES the hole**, which puts the
two legs back in phase; the detector accepts 14–46 s cycles, so 11 s, 13 s and 47 s have no divisor in
band, so the tool names them rather than scoring them.

Phase-matched, 42 cases over 14 of the 17 planted holes, both nodes:

| candidate | events a hole still ADDS | events it takes asymmetrically |
|---|---|---|
| `current` — the shipped rule | **2** | 1 |
| `res` — the residual's support | 1 | 0 |
| `env` — the envelope gate's support | 1 | 1 |
| `full` — the whole decision window | **0** | 1 |

**Only the whole decision window, rebound search included, removes the term.** Widening by the
residual's or the envelope's support halves it and leaves it standing, so "the detector's own support"
in the residue row is ambiguous between three windows and only the widest one works.

**Phase 2 — the cost**, over every optical stream this corpus holds. 2137 streams enumerated,
**350 measured**, 1787 refused: 1634 by the node's own 60-beat floor, 52 by its span guard, 22 with no
parseable sample, 11 on a clock seam, and **68 because the recomputation did not reproduce the node's
own event count** (§4b). The 350 carry 20969 holes and 5584 events.

| candidate | events lost per hole | share of events |
|---|---|---|
| `current` | 0 | 0 % |
| `res` | 0.007 | 2.5 % |
| `env` | 0.007 | 2.7 % |
| `full` | **0.008** | **2.9 %** |

`current` costs nothing by construction: the node drops those events before this tool sees them. The
whole decision window costs **0.008 events per hole**, three orders of magnitude under the pre-stated
ceiling of 2, and the widest window costs barely more than the narrowest — so narrowing it buys
nothing. Verdict `cvhr-edge-widen`: **PASS**, criterion `excluded_events_per_hole_mean <= 2`.

**A hole is a finger property on this corpus, not an optical one:** 20785 holes over 129 finger nights
against 184 over 221 wrist nights, about 250× per night. The finger nights carry 1682 events and lose
150; the wrist nights carry 3902 and lose 13.

**⚠️ THE MEAN HIDES A TAIL, and the tail is short fragments.** 194 of the 350 nights lose nothing and
the median night loses 0 %, while 35 lose at least half their events and 27 lose all of them. Those 27
carry one or two events each over spans of 500 s to 3500 s, and all 35 together hold 74 events. A
record that short does not survive a widen, which is what §5's denominator clause is for: such a
record owes a named refusal, not an index of zero.

### 4b · The control refused 68 nights, and that is a second defect

The recomputation reads `analyze`'s published `nn`/`tt` and rebuilds the gap mask from the sample axis.
The node's own mask is `spansTime || bridged` (`ppgdex-dsp.js:5287`), and `analyze` publishes a COUNT of
spanning intervals and never the mask — so the bridged half does not come back from the node's output.
On 68 of the 418 otherwise-eligible streams the two event counts differ by 1 to 8 events, and the tool
refuses the night rather than printing a figure for a pipeline nobody runs. Residue row
`2026-10-19-the-cvhr-gap-mask-does-not-leave-the-node` carries it.

## 5 · The change

Both nodes build a per-second contaminated mask from the gap mask they already carry, and test it at
decision time instead of testing the event's own second:

- `ppgdex-dsp.js` `cvhrFromNN` — the mask arrives as `spansGap`, nn-aligned (`_spansGap` at
  `:5287`, which is `spansTime || bridged` projected onto the kept frame).
- `ecgdex-dsp.js` `detectCVHR` — same shape, same window.
- The window is one shared constant pair per node, named for the stage that sets it, with the §2 table
  as its comment. It is NOT a magic 72.
- **The index's DENOMINATOR loses the same seconds.** `cvhrIndex` counts events per hour of OBSERVED
  time, and a second whose decision the mask excludes is not a second this metric observed. Dropping
  events while keeping the whole denominator biases the index DOWN, and it does so hardest on the
  records where the exclusion is widest. A record whose exclusion swallows most of its span owes a
  named refusal rather than a low number.

Landing cost, measured before anyone promises it: both bundles re-bundle; `manifestHash` and `computeHash`
both move, because `*-dsp.js` sits inside the export's compute closure; the CVHR index and event count
reach `ganglior.node-export`, so GATE B and GATE C red by design and both nodes' goldens regenerate
(`tools/regen-ppgdex-goldens.mjs`, `tools/regen-ecgdex-goldens.mjs`) followed by a corpus lap through
`tools/verify-fixtures.mjs`. One PATCH bump, one changeset.

## 6 · Acceptance

- [ ] The phase-matched planted grid reads `added 0` for both nodes under the shipped code, not only
      under the tool's post-filter.
- [ ] `tests/dex-tests.js` pins the mirror orientation by VALUE: a hole adds nothing, and an event
      72 s before a hole is dropped while one 73 s before it is kept.
- [ ] The real-night cost is re-measured on the shipped code and matches §4's figure.
- [ ] `cvhrDenomSec` drops the excluded seconds, and a record whose exclusion covers most of its span
      refuses by name instead of reporting a low index.
- [ ] Both nodes' goldens regenerate and `verify-fixtures.mjs` stamps `verifiedUnder`.
- [ ] The residue row closes as `fixed #NNNN`.

## 7 · What this does not claim

- Not that either node is wrong about a real dropout. The two nodes AGREE on every planted case, and
  agreement is not correctness.
- Not that the figure transfers to another corpus. The hole population is a property of the device and
  the link: the same measurement reads 161 holes per finger night and 0.8 per wrist night.
- Not that the detector owes a `null`. The hole manufactures the event, so removing it repairs a
  COUNT rather than reporting an absence; the index's denominator already excludes dead time.
- Not that the 1 Hz resample is the defect. The resample is sound; the per-second mask is the half that
  was never widened to match it.

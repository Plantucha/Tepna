---
bump: minor
type: added
nodes: []
brief: MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md
---

`resp-acc-analysis.html` gains the figure layer three preprints were blocked on, and stops silently
discarding an entire capture route.

THE FIGURES. The page rendered tables only — zero `<canvas>` anywhere and no export path — so no run of
it, headless or manual, could emit a PNG. §4a's re-scoping says exactly this: the blocker was never
"run the tool", it was that the capability had not been built. Three canvases now render on every run
from the numbers the tables already compute — Bland–Altman agreement against the CPAP-flow reference
with bias and ±1.96 SD direct-labelled, the MAE-against-coverage abstention curve, and per-night MAE as
sorted dots with a labelled median — each downloadable on its own, plus a stacked
`acc-resp-figures.png` following the same export shape `nights-icc-analysis.js` already uses so
`papers/figures/` keeps one convention.

The arithmetic under the plot is gated because it is published: `RespAccAnalysis.blandAltman` is pure
and lives in the module both test runners load, so the figure and the agreement table cannot drift
apart. Known answer, hand-checkable rather than recorded from the implementation — diffs of
{+2, 0, −2, +4, −4} give bias 0 and sample SD √10, limits ±1.96·√10 — and mutation-verified: the
population SD reds three assertions by value. It refuses rather than fabricating, too: one pair has no
SD, and limits of ±0 would read as perfect agreement.

Two layout defects were caught by rendering the figures and looking at them, which no palette validator
can do: the right-hand annotations were clipped against a fixed gutter (`−1.96 SD −3.32` came out
`−1.96 SD -3.3`), and the coverage axis divided its range into fifths so it read 45 % · 56 % · 68 % ·
79 % · 91 % · 102 %. The gutter is now measured from the widest label and the axis takes explicit
deciles.

THE INVISIBLE NIGHTS. `groupFiles` matched `_YYYYMMDD_HHMMSS_ACC.txt` — the Polar-Sensor-Logger phone
layout — while the capture host writes the same bytes as `_YYYYMMDDHHMMSS_ACC.txt`, one 14-digit run
with no separator. Box-captured nights passed the filename filter and then fell out of the grouping
loop on a bare `continue`: not counted, not logged, not skipped-with-a-reason. Three papers rest on
which nights this apparatus can see, so an entire capture route was excluded from the corpus and the
exclusion appeared in no count and no reported n. The parser moved into the pure module (the app layer
is loaded by neither runner) and is gated both ways, mutation-verified against the pre-fix regex; the
caller now reports how many ACC files were seen, how many carried no recognisable stamp, and how many
had no CPAP flow, with examples.

RUN AGAINST THE REAL CORPUS (2026-08-06). The §1 item that has blocked three preprints since
2026-07-21 is run: 16 night-groups from 419 paired ACC files, 7 scored, MAE 0.95 br/min (CI 0.79–1.18)
against a 1.42 null baseline and a 0.72 reference self-noise floor. The corpus was never missing — but
all 419 ACC files are capture-host layout, so before the sessionStamp fix above the tool could see
none of it.

Two further defects the run exposed, both fixed. Nine of sixteen nights were being SCORED against
noise: `recoverOffset` returned offsets from −5163 s to +4804 s at peak |r| 0.16–0.20 while the seven
that locked agreed to a 9-second spread, and `offsetUsed` fell through to the argmax anyway, so those
nights entered the published MAE aligned against unrelated breaths — the tool's own drift check had
already flagged every one "off-model". A night without a credible alignment now does not score. And
the Bland–Altman clamped out-of-range points onto the axis, drawing a row of dots that read as a
cluster of extreme disagreements; they are now dropped and counted in the figure.

`fitClockOffsetPooled` is wired (EVE-anchored, two responder channels, integrator-dsp inlined) and
reported on every night, but does NOT override a drift-consistent correlation lock: on a one-device
page it reaches confidence on 2 of 16 nights, both exactly at pFloor = 1/(nullIters+1), and on the one
head-to-head night it disagrees with a six-night drift model by 77 s where the correlation agrees to
3.6 s. Letting it decide moved the headline 0.95 → 1.01. The wiring stays because the better
instrument should be present and exercised; the policy is set by measurement rather than pedigree.

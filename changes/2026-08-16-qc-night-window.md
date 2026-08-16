---
bump: minor
type: added
---

**QC called a 31.7-hour block "the night".**

A capture SESSION was a workable proxy for a night while the box recorded only at night. Under
continuous recording a 1 h gap almost never splits, so the judged sessions on 2026-08-13/14/15 measured
**31.73 h, 16.24 h and 20.39 h**. Every coverage figure and every `missing` was computed against that.

⚠️ **THE FOLDER PROBLEM IS ALREADY SOLVED AND THIS IS NOT IT.** `QC-SCOPE-RESOLUTION-2026-07-28` fixed
which folder QC judges, and it works: all three of those sessions cross midnight correctly, with
`searched_dirs` spanning both folders on two of the three. (That brief's last checkbox — *"deploy to the
box"* — is **stale**: the box carries all four layers plus work that merged hours ago.) What remains is
day-versus-night INSIDE one contiguous session, which folder resolution cannot reach.

`night_band(ts)` anchors on the **evening**, so 22:30 and 02:42 either side of one midnight fall in the
same band — that is what makes it a night rather than a date. `night_view()` reports the session's
overlap with it, and the rows apportioned to it.

## The band is deliberately wide, and the reason is measured

**20:00 → 10:00**, 14 hours — longer than anyone sleeps on purpose. It bounds where a night may fall; it
does not claim the subject was in bed for it. `HRVDEX-ALL-NIGHT-SCOPE-2026-07-20` measured 28 nights:
**27 started 21:00–23:00 and one started at 01:06**, and a `getUTCHours() < 10` "morning only" rule kept
**1 of 28**. A band fitted to the mode drops the outlier night entirely — that is the failure this
inherits the measurement to avoid, rather than repeating it.

## Rows are apportioned PRO RATA, and that assumption is stated

QC reads filenames and counts newlines; it never parses a timestamp, which is what makes it cheap enough
to run every ten minutes. So it cannot know which rows fell inside the band. Each file contributes
`rows * overlap(file, band) / file_span`, assuming a roughly uniform row rate **within one file** — true
for a capture stream, and written into the docstring because it is the one thing that could make these
numbers wrong.

Measured across the corpus:

| session | → night span | rows apportioned |
|---|---|---|
| 14.52 h | 8.06 h | 0.88 |
| 18.40 h | 10.03 h | 0.76 |
| **3.35 h** (entirely night) | **3.35 h** | **1.00** |
| **20.39 h** | **10.42 h** | 0.63 |

## It REPORTS; it does not judge

`ok`, `coverage` and `missing` are untouched. Wiring the verdict onto a new band would change every
number in the alarm at once, with no ground truth to validate against — the band and the pro-rata
assumption should be watched on real nights first. Same stance as `system_files`, and the same caution
`2026-08-15-qc-judges-the-night.md` recorded when it declined to make this change unilaterally.

⚠️ **It also does not fix session SELECTION, and the honest reason is that the data model cannot.**
Selecting by night-overlap picks the 20.39 h block (it does contain the night); selecting by overlap
RATIO picks a 1.71 h fragment of 6 052 rows over the real 18.4 h session of 15 M. Clipping the span
without clipping the rows would push coverage above 100 %. Clipping rows needs per-row timestamps, which
is the design QC deliberately does not have.

## A collision the existing tests caught

`night` was **already** a published key — the folder date string (`"2026-07-19"`, `"incoming"`).
Publishing the band under that name silently replaced a string with a dict, and two pre-existing tests
failed immediately. Renamed to `night_window`; a regression test now asserts both facts survive.

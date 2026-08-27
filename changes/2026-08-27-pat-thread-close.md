---
bump: patch
type: changed
brief: PAT-RELATIVE-REFRAME-2026-08-17-BRIEF.md
---

The PAT thread closes **on a demonstrated negative**, and `pat-align.js`'s "bound, not rate" becomes the
**permanent** answer rather than a placeholder.

**Pre-registered before touching data:** persistence threshold `P ∈ {2.5,5,10,20,40}` ms × horizon
`H ∈ {60,300}` s, with a **count-matched null control** at random non-run positions. Quotable only if the
fraction was stable within ≤10 pp across `P ∈ [5,20]` **and** real runs persisted at ≥2× the null.

**Both bars failed, in all ten cells:**

| | real % | null % | ratio |
|---|---|---|---|
| H=60 s, P=10 | 71.7 | 72.0 | 0.99 |
| H=300 s, P=10 | 80.7 | 79.4 | 1.02 |
| spread across P ∈ [5,20] | **33.5 pp** (bar ≤10) | | max ratio **1.08** (bar ≥2) |

**The classification carries no information about runs** — random non-run positions persist identically.
The 72 % withheld in #1884 was the series' ambient base rate, which is exactly why it was withheld.

🔴 **The cause is IDENTIFIABILITY, not sample size.** The observable is `lag = BLE offset + true PAT`, and
within one connection neither term has an independent handle. A step and a dip do differ in shape, but
ambient drift makes every position look like a step at the same rate, so shape cannot recover the split.
**More nights will not fix this; a second offset-only observable would.** Recorded in `pat-align.js` so a
future reader does not re-run the same sweep expecting a different answer.

Also flips `PAT-RELATIVE-REFRAME` to **DONE**: box 1 answered by measurement, box 2 a guard shown
machinery-backed by `badges · registry · no-fabricated-tier` (planted-decoy demonstration), with its
scope limit stated — that gate covers `evBadge` sites in the 8 node UI files, not papers or analysis
tools. DOCS-INDEX row synced **by line with an identity assertion**, per the non-unique-key lesson.

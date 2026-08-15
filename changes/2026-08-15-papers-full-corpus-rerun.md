---
bump: patch
type: changed
---

Re-run the papers' corpus-dependent results on the full 52-night committed corpus (903,265
simultaneous s, 3.1× the sample behind the published headline σ) and update four papers plus
`papers/RERUN-RESULTS.md` to what it measures.

- **`sigma-no-reference.html`** — limitation (x) gains the 52-night column. This **withdraws** the
  "the corners reorder" reading landed earlier the same day as a 24-night small-sample effect
  (Verity +4 % → +24 %), **widens** the non-monotonicity finding from one corner to two (Verity and
  H10; only the O2Ring is monotonic), and replaces the blanket "the two analysis paths disagree in
  absolute terms" with the sharper measured statement: at matched window length the **O2Ring corner
  reproduces across both pipelines** (2.44 vs 2.41, published value inside the CI) while the H10 and
  Verity corners do not. No headline σ changes.
- **`sensor-trio-nights.html`** — its window-length limitation cited only the 17-night proxy corpus
  and called a re-fit "owed". It now carries all three corpora and the per-corner conclusion: only
  the O2Ring's sensitivity is stable enough to borrow, so a single scalar band applied to all three
  corners would encode the transfer this measurement refutes. The re-fit is still owed, better
  specified.
- **`wearable-clock-drift.html`** — new §3.6 applies three-source closure corpus-wide rather than to
  contested nights only: of 52 nights carrying an H10↔Verity rate, **17 close · 10 fail closure · 25
  are unclosed**, so **67 % are not measurements**, and pooling **inverts the sign** of the corpus
  median (+5.0 ppm pooled vs −3.0 ppm closed-only). Reported as a screen, not a new headline rate.
- **`dead-ends.html`** — wall 2.7 (cross-device PAT) notes that its evidence base for re-opening is a
  17-night screened set, not a 52-night one. Disposition unchanged; the wall was refuted on mechanism.

No node behaviour changes and no bundle is touched — this is papers, their `docs/` served twins, and
the re-run ledger.

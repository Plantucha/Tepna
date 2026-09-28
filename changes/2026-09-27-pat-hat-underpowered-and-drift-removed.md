---
bump: minor
type: added
brief: PAT-HAT-DRIFT-DIFFERENCED-2026-09-27-BRIEF.md
---

The PAT three-cornered hat now says which kind of negative corner it found, and adds a drift-removed
estimate beside the classic one.

On 2026-09-26 both PAT hats refused with "the independence assumption failed". Measured, the chest
corner's 95 % CI was [−216, +225] ms². Independent errors in that geometry give a negative corner on
34 % of nights, so the refusal was a precision limit.

`threeHat` adds three fields (every existing field is byte-identical):
- `ci` — a seeded 30-min block-bootstrap CI per corner.
- `corners` — per corner, one of:
  - `solved`, with a σ CI;
  - `underpowered`, with the bound it can state (09-26: chest σ < 14.4 ms);
  - `independence-failed`, naming the pair and a coarse explaining ρ.
- `diff` — the drift-removed hat on first differences (the Allan variance at τ = 5 min), labelled not
  comparable to the classic σ. On a planted 60 ms shared finger+ankle drift, the classic hat reads chest
  ≥ 24 ms against a true 8. The drift-removed hat recovers 8/9/12 ms within ±5.

The leg closure is not published as a consistency figure: it is identically 0 by construction
(22 322 of 22 322 beats). The page rendering is a separate unit.

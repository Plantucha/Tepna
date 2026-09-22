---
bump: minor
type: added
brief: MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md
---

measurement-block.js gains hoist/resolve/hoistSaving: the shared window/code/evidence/quality/reason parts of a measurement map can be lifted into a `shared` section and put back, reversibly. Nothing emits a hoisted document and no node changes — the contract keeps them per block deliberately, because a block must be readable alone — so this moves no fixture and no computeHash. It is the prerequisite §12 question 5 names ("hoisting must precede any per-window emission"), which is open and unscheduled; the contract change remains q5's to make. The invariant is stated in bytes rather than in a block count: hoist only where it reduces size, otherwise return the input unchanged — which refuses the one-block case and the nothing-shared case without either being a rule. Round trip asserted as deep equality, with the key-order caveat stated because a fixture byte-compare is the reader that would find it. Measured: 57.8 % on a three-block whole-night map.

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [analysis-stats]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
DEEP-AUDIT-VI F15 — `tchSigmasPairwiseFromVars` silently returned ONE of multiple admissible σ
triples: with any ρ ≠ 0 the pairwise system frequently has ≥2 positive roots reproducing the
observed variances exactly (audit probe2: 12 of 53 planted physical systems; 4 returned a
NON-planted root — one corner off 76 %, another 4×), and Newton reported whichever root its seed
reached as THE σ, ok:true, no flag. The kernel's doctrine is refusal, not a fabricated number:

- The descent is extracted (`solveFrom`) and MULTI-STARTED from a deterministic seed spread
  (per-corner and joint ×0.25/×4); a distinct admissible root ⇒
  `ok:false, reason: 'multiple admissible sigma triples …'` quoting every root, plus a `roots`
  diagnostic array. Single-root answers are bit-identical (same seed, same arithmetic).
- Internal probes (`_noCrit` — tchRhoCrit's ~120-step bisection, the sensitivity probe) keep the
  fast single-descent path: they ask "does a solution exist here", not "is it unique"; their known
  answers are pinned unchanged (rho-crit group 18/18, §8a ρ_crit ≈ 0.422).
- 🔴 The finding the fix surfaced: BOTH of the suite's own celebrated plants — (3,3,3, ρ .5/.5/.5)
  and (1.5,1.5,5, ρ .6/−.2/.3) — are multi-root systems (4 and 2 roots), and their "recovers
  planted σ" greens were the seed landing in the planted basin: known answers pinning seed luck.
  They return as REFUSAL cases (planted triple asserted AMONG the quoted roots); the replacement
  single-root plants keep every claimed property (all pairs correlated, classic seed non-physical,
  exact recovery), measured before pinning.
- Kestrel's sweep observation tested, not assumed: on my 53-system replication all 13 multi-root
  cases carry a non-physical classic seed (13/0) — consistent, quoted as measured-on-53, and the
  refusal keys on measured roots, never on the seed's sign.

Proven both ways (main's kernel: 10 red legs; fixed: 132/132 + rho-crit 18/18). Consumer sweep:
`tch-per-epoch-rho` degrades honestly (NO SOLUTION instead of a seed-dependent number); the 6
analysis tools inlining analysis-stats re-bundled; no app bundle carries it.

---
bump: patch
type: fixed
---

PpgDex: suppress DFA α1 and sample entropy across internal RR gaps.

When correctRR drops beats mid-sequence, the retained RR intervals are no
longer contiguous. DFA α1 and sample entropy assume a continuous sequence;
computing them across the gap fabricates a result. They now emit null when
the retained-index sequence has an internal gap, following the absence
contract. Lomb-Scargle is preserved (timestamped, handles irregular sampling).

Also: Biome lint fixes (unused vars, noAssignInExpressions via matchAll
refactor) and rebuilt PpgDex/Data Unifier/OverDex bundles.

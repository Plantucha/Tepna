---
bump: minor
type: changed
brief: MUTATION-DECLARED-EXCLUSION-2026-10-03-BRIEF.md
---

The mutation gate's declared exclusion becomes one module-level declaration, checked before any work starts (owner ruling). The cost it records is a property of the module — `mutmut` applies a glob when it runs mutants and never when it generates them, so every `capture.py` diff pays for the whole module's population whatever it touched — so a list of function keys each citing the same module-level measurement stated one fact as many. The gate now consults the declaration at selection rather than after spending the budget, turning a 7693 s run that reached no mutant into a verdict in seconds, and it prints on every run how many functions the declaration covers (measured from the module's AST, not quoted) and how many of this diff's functions fell under it, so the size of the blind spot is re-counted per PR. Two defects in the first version are fixed with it: the substitution never fired when a diff's entire scope was one declared function, because that case reports `NOT_RUN` rather than `UNKNOWN`; and the skipped functions stopped reaching the `unmeasured` ledger once the check moved earlier, which would have removed the record of what the gate no longer measures.

---
bump: patch
type: added
brief: none
---

**The three mutation ledgers merge over entry ids, and a duplicated id stops the merge.**

`tools/mutate-ledger-merge.mjs` is a git merge driver for `capture-host/tools/mutate-equivalence.json`,
`tools/mutate-equivalence.json` and `mutation-survivors.json`. It keeps an addition from either side,
honours a deletion, takes the side that changed an entry, and refuses when both sides changed one entry
differently. The identity carries the mutant operand, because 30 entry groups in each equivalence
ledger share one line and one operator. `--verify` emits one `tepna.verdict/1` object over the three
ledgers.

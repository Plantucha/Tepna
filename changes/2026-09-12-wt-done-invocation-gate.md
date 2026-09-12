---
bump: patch
type: added
nodes: [suite]
brief: none
---

`wt-done`'s in-use check is gated — the first test it has ever had.

The check shipped ungated in #2321, its self-match defect was found and fixed in #2402, and that fix
shipped ungated too: `usersOfPath` had no test on `main` at all. Both the defect and its repair were
carried entirely by a comment.

The gate drives the real `usersOfPath` against a synthetic `/proc`, so it needs no live process. It
pins the boundary #2402's own comment draws and nothing checked: the exemption is the INVOCATION —
the scanner, its caller, and its pipeline siblings — and deliberately NOT "same user" or "same
session", so a peer session working in the tree is still reported and still refuses the removal.

Plant-verified in both directions: reverting to the self-only exclusion reds the caller and sibling
assertions while the peer assertion stays green; widening the exemption to every process reds the
peer assertion while the other two stay green. Neither plant reds the whole group, so each assertion
is independently load-bearing.

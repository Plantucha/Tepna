---
bump: patch
type: fixed
brief: none
---

Six type errors that had drifted onto `main` are fixed with narrow annotations rather than a baseline move, so a branch cut from main no longer reads `mypy=RISEN` before it has changed anything. `blind_spots._record` is typed to the three node kinds its caller already guarantees instead of the base `ast.AST` that has none of the attributes it uses, and the isinstance test moves into the branch it protects because a narrowing cannot travel through a bool variable; its `swallowed` flag now carries the name it found, so the later attribute access and the guard that makes it safe are the same expression. `ppg_grid_check` keys `max` on a subscript rather than `dict.get`, which cannot return `None` for a key taken from that same dict. In `capture.py` a log label is typed as the label it is, and a tuple that is reassigned wide is annotated wide. Two of the six were introduced by the mutation-exclusion work itself, where a `list[dict]` was bound to a name already holding a `list[str]` in the same function.

---
bump: patch
type: fixed
brief: none
---

A function whose only difference from the base is its docstring no longer contributes mutation scope: mutmut generates no mutants for a docstring node, so the change carries nothing the gate could test, and scoping it re-mutates a body that did not move. A docstring edit accompanied by any other change still scopes, and every non-docstring string constant still scopes, so the exemption is the one node with no mutants behind it rather than a judgement about which strings matter.

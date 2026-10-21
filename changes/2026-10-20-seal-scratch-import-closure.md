---
bump: patch
type: fixed
brief: none
---

The seal scratch fixture copies `verify-seals.mjs`'s import closure instead of a hand list, so a tool
that gains an import stops dying with `ERR_MODULE_NOT_FOUND` inside the git-less copy.

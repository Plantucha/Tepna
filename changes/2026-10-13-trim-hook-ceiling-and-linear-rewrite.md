---
bump: patch
type: fixed
brief: RESIDUE.md
---

The trim hook declares a command ceiling under MAX_ARG_STRLEN and passes a longer command through with no jq noise. Its rewriting path is linear in the command length, because the quadratic last-stage expansion is gone.

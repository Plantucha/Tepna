---
bump: patch
type: fixed
brief: none
---

Escape a version through `escapeRe` in both release tools, where a dot-only escape reached a `new RegExp`. The suite now reds a partial escape that a RegExp reads in the same file.

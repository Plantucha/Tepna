---
bump: patch
type: fixed
brief: none
---

The walker no longer commits a build output into an author PR that it rebases. A conflict rebase rebuilds the bundles, and the walker then committed every path that the rebuild moved. Check 10 of `pr-compliance` refuses a bundle in an author PR, so #5797 went red after its first rebase.

The walker now commits only the provenance fragments and the fixtures. It restores each build output to the branch's own bytes. A `claude/regen-walker-*` branch still carries its build outputs.

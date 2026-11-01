---
bump: patch
type: fixed
brief: none
---

`pr-compliance` reads a Dependabot PR that touches only dependency manifests as NOT_APPLICABLE. A bot cannot write a `Rule 0:` line, a trailer or a changeset, so the gate failed #4238, #4239 and #4240 by construction. The exemption keys on the author that GitHub sets in the event and on a manifest-only diff.

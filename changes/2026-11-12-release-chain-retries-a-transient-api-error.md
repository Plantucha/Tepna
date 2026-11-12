---
bump: patch
type: fixed
brief: none
---

Retry a transient server error at the release chain's `push` and `pr` steps. One GitHub GraphQL error killed the v2.32.0 chain after it had committed and pushed. The timer then held on the unfinished run, so the cadence stopped until a person acted.

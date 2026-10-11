---
bump: patch
type: fixed
brief: none
---

Give each doc-search cache write its own temp file, so two sessions searching at once stop racing one shared `.tmp` name and discarding the loser's embeddings — measured at 6,062 chunks re-embedded in a single search — and unlink the temp file when a write fails so unique names cannot leak.

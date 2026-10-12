---
bump: patch
type: fixed
brief: none
---

Publish `charging: null` when a battery flat at 100 % is the only evidence, so a fresh coin cell is no longer read as a dock, and never null a measured charging reason.

---
bump: minor
type: added
brief: none
---

`tools/secret-scan.mjs` scans the commits a PR adds for credentials, private and shared addresses, home-directory paths and the private literals in the `TEPNA_PRIVATE_TERMS` secret. The `secret-scan` workflow runs it with a pinned scanner, verified by checksum. The check is not required yet.

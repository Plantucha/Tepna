<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
brief: OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS-2026-08-23-BRIEF.md
---
`capture-host/oxy_transfer.py` — D-w1 layer-3 semantic validation: the record-boundary walk (Format-A header + a whole number of 3-byte records between header and the 48-byte trailer + record count == trailer `total_seconds`), lifting `VALIDATION_DEPTH` from `size+finalised` to `size+finalised+records`. Geometry measured against real 95 KB / 81 KB `.dat` files: the invariant is `(size-58)/3 == total_seconds`; the JS parser's `ff ff` end-marker sits ~10 records before the trailer and would mis-count, so the size/trailer arithmetic is the reliable one. The control: a right-sized, finalised file with a shifted grid (20 records, trailer claims 21) now REDs where size+finalised passed. Old ledger rows keep the depth they were checked against.

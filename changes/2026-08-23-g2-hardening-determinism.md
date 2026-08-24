---
bump: patch
type: fixed
brief: OXYII-ACQUISITION-CHARTER-2026-08-23-BRIEF.md
---

G2-HARDENING completes: the key-set assertion took the module 245/28 to 257/16, and triaging the
remaining 16 individually — rather than bucketing them as prose — found two real defects that bucket
would have swallowed.

`sort_keys=True` is the ledger's determinism property: rows round-trip without it, so every
functional test passed either way, but byte stability does not survive, and an append-only ledger
whose bytes depend on construction order cannot be diffed, hashed or compared across runs.

`reason` defaulting to `""` is a data contract: a non-empty default silently marks every row created
without one, and the sibling module's truthiness check would then pass on rows nobody gave a reason.

Both verified by re-application. The remaining 12 are two genuinely equivalent families — the
encoding six already probe-backed in the ledger, the message six prose (verified: `reason` is written
and read by no consumer).

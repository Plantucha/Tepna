<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: OXYII-G1-TRANSACTIONAL-SYNC-2026-08-23-BRIEF.md
---

`resume_strategy` has decided re-serve-vs-resume since G1 and was reachable only from the pure
planner: the download loop always sent offset 0, so the policy could not be exercised by the path
that moves bytes, and the physical drop test that decides it had nothing to run against.

The pull path now asks it. A `.part` on disk produces a RESUME decision, the START frame carries the
real offset (the ring is seeked, not only the local writer), and the prefix is read from disk before
the remainder streams. `pull.resume` (default OFF) is what the drop test flips — config, not code.

A resumed file is VERIFIED before commit with the existing trailer predicate, and a failure discards
the `.part` and re-serves rather than committing. A clean pull fails SHORT and is visible in a byte
count; a resumed pull fails as a file of exactly the right size whose middle is wrong, which no
length check can see. Keeping a rejected `.part` would feed the next resume known-bad bytes.

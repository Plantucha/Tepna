---
bump: patch
type: added
brief: OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS-2026-08-23-BRIEF.md
---

`capture-host/tests/test_chaos_ordering.py` — D-w4, covering `oxy_transfer` (G1) and `cpap_spool` (P4)
in one harness because they are the same shape: `.part` → fsync file → validate → `os.replace` →
fsync directory.

**The gap it closes:** removing either fsync left every test green. All four fsync call sites across
the two modules are now covered, and **each removal kills a control** (verified by re-application,
mutating to `pass` so the module still imports).

🔴 **What it deliberately does NOT claim.** `fsync` defends against a MACHINE failure, and a process
kill does not lose page-cache data — the kernel writes those pages back whether or not `fsync` ran. So
a `kill -9` harness passes identically with the fsync present and removed, and mocking `fsync` to a
no-op is worse because it looks like it works. Two claims are kept strictly apart:

- `TestFsyncCallSites` — **the calls are made at the required points**. Real coverage of a real
  regression; licenses exactly that sentence and not "the data is durable".
- `TestCrashConsistency` — **the ordering invariants** that survive a process death: a `.part` is
  never adopted however complete it looks, a failed rename leaves old-or-new but never neither,
  committed bytes with no ledger row are re-pulled rather than lost, a torn ledger line costs one row
  rather than the history, and `cpap_spool` refuses to promote a corrupted `.part`.

**Durability proper stays OPEN**, with its blocker now specific rather than unknown: `dm-flakey` over
a loopback device, which drops writes after a trigger and so simulates the power loss `fsync` exists
for. `dmsetup` is present here; passwordless sudo is not — so it is an owner action.
`cpap_spool`'s `chaos-lane routed` equivalence entry stays routed until that runs for real.

⚠️ The page-cache reasoning is in the module docstring on purpose, so the next reader does not
"improve" this into a kill-based durability claim.

12 tests. One ordering assertion (`file fsync BEFORE directory fsync`) exists because the reverse
would durably record a name whose contents are not yet on disk — right size, wrong bytes.

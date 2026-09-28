---
bump: patch
type: fixed
brief: none
---

The CPAP spool-wiring tests stop reading coroutine frame locals to find the supervised loop's factory, so they survive mutmut's trampoline and mutmut's stats pass no longer fails on every capture.py diff; and the mutation tool's wall cap becomes reachable — it was applied at a `proc.wait()` placed after an unbounded read of the child's stdout, so a run that never finished was never bounded, which is how a traced stats pass reached hours against a two-hour budget. A budget exhausted before a single mutant was decided now reads NOT_RUN with the elapsed time in the verdict, not UNKNOWN.

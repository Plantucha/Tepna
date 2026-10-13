---
bump: patch
type: changed
brief: none
---

**The sentinel pattern in the project conventions names the waiter that outlives its producer.**

A sentinel dies with its writer. When the watchdog kills the subshell, no `EXIT=` line is ever written, and a bare `until grep` loop polls forever. The fleet measured one such wait at 2 h 08 min on 2026-09-22.

The conventions now show two guarded forms. A waiter in the launching shell checks the producer PID beside the sentinel. A waiter in a different shell bounds the loop with a deadline. A test group pins both forms in the text.

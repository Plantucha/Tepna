---
bump: patch
type: fixed
brief: none
---

The diff-scoped mutation gate found **43 survivors** on `probe_oxyii_opcodes.py` at 100% statement +
branch coverage. Almost all were one shape — `f(address, …)` → `f(None, …)` — because the test doubles
accepted any arguments and returned the same thing regardless, so no argument was observable.

The doubles now **record what they were called with**, and seven tests assert on it: the scan is asked
for *this* ring with a real timeout, the client connects to the device that was *found*, AUTH carries
its payload, `--max-ops` is honoured inside `run()` and not merely passed to it, the scan retries
exactly twice (an always-failing scan — the old fixture recovered on the third attempt, where `< 2` and
`<= 2` give identical counts), and the report stays indented and survives an unserialisable value.

Each of the nine mutants was **re-applied by hand and confirmed to fail the new test**. Coverage was
already 100% before this change and is 100% after: the gap was never coverage, it was that coverage
answers "was this line run" where the defect was "was it run with the right value".

---
bump: patch
type: fixed
brief: none
---

Say what releases the CPAP card when the poller's teardown runs under a cancellation. The executor
submission carries the release, so the shield guards only a future coroutine awaitable, and a new
test leg pins the release in the shape where the cancellation is already delivered.

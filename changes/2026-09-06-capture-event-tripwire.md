---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---

capture-host tests: a leaked module-global event can no longer hollow out a later test.

`capture` carries three module-global `asyncio.Event`s — `_STOP`, `_RECOVER`, `_OXYII_PAUSE` — that
gate the runner loops, and tests `.set()` them directly with nothing restoring them. One left set
makes every later runner test spin in an outer idle gate and reach none of the code it names, while
still passing: a test that observes nothing looks exactly like a test whose subject behaved.

An autouse fixture in `tests/conftest.py` now clears them before each test (so a leak cannot cascade)
and asserts after each test that none was left set, naming the test and the event (so a new leak is
named rather than absorbed). Both halves are kept deliberately: a reset alone would silence this
class forever without ever surfacing a recurrence.

The event set is DISCOVERED by introspection, not listed, so a fourth event is covered the day it is
added — and that is how `_STOP` was found at all, since grepping the original failure only showed the
two events that happened to appear in one message.

21 tests set one of these events as part of their scenario and now declare it with
`@pytest.mark.sets_capture_events`; the fixture is a reset, not a ban.

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: RADIO-CLOCK-SIDECAR-2026-09-07-BRIEF.md
---
**27 surviving mutants closed on the radio-clock collector and the night report — no production code
changed, so this is entirely about what the tests can see.** `mutation (diff-scoped)` is advisory and
went red on both #2359 and #2363; these are its real findings, worked rather than excused.

The one that matters most is a **correctness case that bites about once an hour**: `associate` picks
the nearest anchor with `max(candidates, key=lambda pair: pair[1])`, and without that explicit key a
tuple comparison orders by `event_counter` FIRST. The counter is a u16 that wraps at 0xFFFF — at a
50 ms connection interval, roughly hourly — and across a wrap the highest counter is the **oldest**
anchor. A keyless `max` would therefore attribute every packet after a wrap to an event from before
it, silently, with a plausible-looking answer. Now pinned by a wrapped-counter fixture.

Others, each an input the collector will actually meet:

- **A `Disconnection Complete` for a handle never seen connect** — the normal case on startup, since
  the collector attaches to a monitor stream that is already running. All three drops are
  `.pop(key, None)`; without the default each would raise `KeyError` on a packet meaning "nothing to do".
- **A reconnect on the same handle** must not charge the counter difference to `missed_anchors` —
  otherwise a reconnect invents tens of thousands of missed anchors.
- **A device configured with no address** is dropped rather than carried through as `None`.
- **Counters that count rather than latch** (`+= 1` → `= 1` is invisible until a second row exists).
- **Every column in its own position** — the earlier row fixture carried several `None`s, so a cell
  replaced by `None` was indistinguishable from the real thing.
- **The window trims its OLDEST sample** — the previous fixture was symmetric, so dropping the
  second-oldest gave the same median and the test could not see it.
- **`held` streams counted rather than latched** in the night report: "1 held" and "2 held" are
  different statements about how much of a night is untrustworthy.

**60 survivors remain and are characterised rather than silently excused**: ~17 length-boundary
mutants on guards where a shorter buffer is refused by a later guard anyway, ~9 log/message strings,
~9 dropped arguments that equal their own default, 4 `encoding="utf-8"` (the class already documented
for `oxy_inventory.py`), and the socket path inside `main`'s `pragma: no cover` branch. They are debt,
not danger, and they are not being written into `mutate-equivalence.json` without the probe each entry
is supposed to record.

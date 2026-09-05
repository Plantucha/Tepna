<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: O2RING-AUTONOMOUS-HARVEST-2026-08-26-BRIEF.md
---

The doff/presence auto-pull asked for `which=latest`, so a night with several onboard sessions
committed only the newest and left the rest to the hourly poller — which reaches an unworn ring only
while it is awake. Measured 2026-08-25→09-05: 4 of 22 sessions arrived that way, 6.5–10.8 h after
close, two of them full 1.3–2.3 h recordings.

Fixed by a SECOND dispatch rather than a wider first one. §14b measured the pull durations
(`latest` p90 31.1 s, `all` p90 69.4 s) but the post-drop window they must fit inside is explicitly
unresolved, so widening the event scope would trade a proven scope for an unmeasured bound. The
follow-on runs after the primary pull has answered — reachability demonstrated, not assumed — and a
new `which=new` scope drains by ledger diff (`oxy_inventory.undrained`), pulling only what no
VERIFIED/COMMITTED row already covers.

Also: `STATUS["autopull"]` is now forwarded by `/api/state` and drawn on the monitor — `trigger` is
the only runtime evidence a doff or presence pull ever fired, and it reached no consumer. And
`STATUS["updated"]`, written on every publish and read by nothing, is deleted.

Two blind spots in `find_unwired` were fixed because they would have passed this change for the
wrong reason: the render scan counted a key mentioned in a monitor.html COMMENT as drawn (and
`autopull` was mentioned only in a comment describing this very defect class), and `projected_keys`
read the per-device projection only, leaving every top-level forwarded block unscanned.

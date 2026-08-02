<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: POLAR-ONBOARD-BACKUP-2026-08-01-BRIEF.md
---
The Polar session walk stops traversing what cannot hold a session.

`polar_psftp.list_recordings` always knew a session is exactly `/U/0/<8-digit date>/<E|R>/<6-digit
time>/` — the filter at the bottom of the function says so. It just applied that filter **after**
walking the whole tree to depth 6. The USB probe (#709) listed what is actually up there on the real
Verity — `DBDC.DAT`, `USERID.BPB`, `S/`, `20260621/` — so the walk descended `S/` in full over a link
stuck at MTU 23 and discarded the result. Every directory is a PS-FTP round trip; that is why the
waste is measured in minutes.

`walk()` gains an optional `descend` predicate, added **last** so the existing signature and both
callers are untouched (`pull_recording` still takes everything under a session). It is shape-based
rather than a name blocklist, so an unknown future sibling of `S/` is pruned by default instead of
silently reintroducing the cost.

Two further defects in the same path, both surfaced by asking why a listing burned the full 300 s
watchdog on 2026-08-02:

* **`_with_retry` had no per-attempt bound**, which made the retry dead code in the exact case it
  exists for — a wedged link does not raise, it hangs, so attempt 1 consumed the caller's entire
  budget and attempts 2 and 3 never ran. It now takes an optional `per_attempt_timeout`, sized so
  three attempts fit inside the offline-op watchdog with room for the backoffs (3×75 + 2×2 = 229 s).
* **the walk logged nothing**, so when it was killed at 300 s, "device busy", "tree too large" and
  "link wedged" were indistinguishable after the fact. It now logs progress every 25 entries plus a
  completion line — a hang has to name where it hung.

Stated plainly: it is **not** yet proven on hardware that tree size was *the* cause of that hang. The
sensor was docked and charging throughout, which is a live confound (POLAR-ONBOARD-BACKUP §6b). The
pruning is correct regardless — it cannot make the walk slower and removes provably-unneeded
traversal — and the new logging is what will identify the real cause on the next run.

Out-of-suite Python only — no shipped bundle, no `manifestHash` movement, no fixture re-recorded.

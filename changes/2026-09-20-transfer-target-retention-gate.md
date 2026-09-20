<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The rsync-over-ssh archive target (`archive.target: {protocol: rsync}`) — the direct vigil → NAS push
being wired 2026-09-20 — had three defects, read in the tree and never exercised because no night had
ever been pushed by that path. **`storage.keep_nights` stays 0 until this lands.**

1. **No retention gate for a transfer target.** `storage_poller` computed `archive_enabled = enabled
   and dest`, False for a target-only config, so with `keep_nights > 0` the pruner would have deleted
   by AGE alone while the verified-push `.archived` markers went unread — and even a marker-only gate
   is the mode that lost data on 2026-07-25 (6 of 10 nights marked against a volume that was gone).
   Now: a transfer target is an archive; a night with no marker is held without asking; a MARKED
   prune candidate is asked of the remote — `storage_targets.confirm_night` runs `rsync --dry-run
   --itemize-changes` and confirms only when NOTHING is pending — and only the candidates retention
   would take are asked, so a 58-night box costs a few ssh sessions per poll, not 58.
   FAILS SAFE throughout: non-zero exit, timeout, missing rsync, a pending item ⇒ unconfirmed; a
   link-class failure (255/124/127) stops asking and holds every remaining night. End-to-end test with
   a dead link: markers present, nothing deleted.
2. **Nights would have FLATTENED.** `rsync_argv` sent `<night>/` (its contents) into `share/` itself;
   every night into one directory. Now `share/<night>/` (and `share/<subtree>/`).
3. **`include_subtrees` ignored by the transfer form.** Honoured by the mount form only, so a box
   archiving by rsync had exactly one copy of `stored/` (the onboard-flash pulls) and `cpap/`. Now
   pushed after the nights, `incoming/` refused as before, no marker on a growing tree; the
   `uncovered_subtrees` reporter runs for a transfer target too — `sniffer/` (1.6 GB of pcaps) is in
   neither list and is REPORTED, not mirrored: whether it deserves a second copy is the owner's.

Not changed: `archive.enabled` (still false on the box), any config, anything on the NAS.

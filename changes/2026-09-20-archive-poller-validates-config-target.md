<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
A config-authored rsync archive target never started the offload — and said nothing. `archive_poller`
gated on `target.get("kind") == "transfer"` read off the RAW config dict, but `kind` is not a field
anyone writes: `storage_targets.validate()` DERIVES it from the protocol, and only the web-UI save
path runs validate(). So the day the vigil → TrueNAS push was wired (2026-09-20): `archive.enabled:
true`, a valid rsync target, `/api/storage/test` green ("reachable and writable"), restart — and 23
minutes with no `archive:` line in the journal, no status block, no marker. The poller had returned
on its first line. The test suite could not see it: every poller test handed it a target with `kind`
already written in.

Now the poller validates the config target the way the UI path does (adds `kind`, defaults `port`
and `verify`, refuses unknown fields and any secret), hands the VALIDATED target to the transfer, and
logs its state whatever the outcome — `archive: ARMED — rsync://user@host:share`, `archive: OFF —
<why>`, or `archive: target REFUSED (<reason>) — offload is OFF until config.yaml is fixed`. An
offload that is off is now distinguishable from one that is broken. Tests: a config-authored target
(no `kind`) arms and arrives validated; a refused target and a non-mapping target log and stay off;
both OFF cases are said. Existing tests that hand-wrote `kind` now use the config shape.

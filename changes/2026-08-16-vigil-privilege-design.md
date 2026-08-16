---
bump: patch
type: changed
brief: VIGIL-AUTO-UPDATE-FOLLOWUPS-2026-08-14-BRIEF.md
---

Delivers the box privilege-model design the owner asked for, as §2a, for sign-off. Nothing is applied to
the box: no sudoers file written, no unit edited, no helper installed.

Scope narrowed first. This was going to cover the adapter-recovery ladder as well, and it does not:
`CAP_NET_ADMIN` is already granted and the ladder is running, so only the update/restart path remains —
root code execution rather than a network capability.

Three options, costed against the two precedents already working in this codebase. `link_rssi.py` takes
privilege through `AmbientCapabilities` inherited across exec, with sudo only as a dev fallback since
`NoNewPrivileges=true` forbids setuid sudo on the appliance. `webmon.py` states the companion rule, that
the privileged surface takes no caller-controlled input, because an argument the caller chooses is still
an argument the caller chooses. And `enable-restart-control.sh`'s own header supplies the constraint that
rules out the obvious fix: a NOPASSWD grant must name a file the granted user cannot rewrite, which is
exactly why the installer cannot be granted, since it copies from a directory `vigil` owns.

Option A automates the install from the canonical remote, hardcoding the URL in the root-owned script
rather than reading vigil-writable git config. It is buildable and it is the one that needs a signature,
because it converts "root writes when the owner types a password" into "root writes whenever vigil asks,
from GitHub". Not proposed.

Option B makes the privileged surface stable enough that installing it is rare, which reduces the drift
rather than fixing it.

Option C is recommended: do not automate the privileged step, make its drift loud. `check-system-files.sh`
already detects the drift; the failure in all three measured staleness events was that nobody read the
detection for days. Surfacing it in the QC summary and the monitor preserves the privilege boundary
entirely and attacks the failure that actually occurred, which was observability rather than privilege.

Docs only.

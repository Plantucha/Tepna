<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [suite]
brief: CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md
---

Put the four privileged NOPASSWD helpers under drift detection, and close
`CAPTURE-HOST-FOLLOWUPS-2026-07-16` (out-of-suite `capture-host/`).

**The finding, measured on the live box.** `deploy/check-system-files.sh` compares installed system files
against the repo and reports STALE / NOT INSTALLED — but its manifest listed three files and omitted the
four root-owned helpers in `/usr/local/lib/tepna`, which are the ones holding `NOPASSWD` sudoers grants.
Measured by md5: `tepna-clock.sh` and `tepna-restart.sh` on the box differ from the (repo-identical)
checkout, and `tepna-usbreset.sh` was never installed and has no grant at all. It matters more than
ordinary drift because `helper_path.SYSTEM_DIRS[0]` is `/usr/local/lib/tepna`, checked *before* the
in-repo copy — so a fixed helper can sit in the checkout indefinitely while sudo keeps running the old
one. The missing `tepna-usbreset.sh` means the USB unbind/bind step `VIGIL-OVERNIGHT-FINDINGS` P1.3 calls
"the only reliable clear" for a wedged adapter cannot run.

The four helpers are now on the manifest behind a `TEPNA_LIB_DIR` seam (so a redirected run can never
write the real `/usr/local/lib/tepna`), with tests reproducing both halves of the live state and a
non-vacuity check that derives the helper list from `enable-clock-control.sh`, so the grant list and the
drift list cannot separate. Three mutants killed: each helper dropped from the manifest, and the seam
ignored.

Fixing the box itself is an owner action — `sudo bash deploy/enable-clock-control.sh`, then re-run the
checker for 0 drifted.

**Also measured for §2:** V4's monotonic re-anchor is no longer only unit-tested — the journal shows it
firing twice (Jul 27, Jul 29), though on timezone sets rather than the NTP step V4 specifies, so it is
recorded as partial. V5's sudoers rule is installed, but the apply path has still never written
(`/etc/systemd/timesyncd.conf.d/` does not exist).

**`CAPTURE-HOST-FOLLOWUPS-2026-07-16` → DONE**, on its Done-when's "executed or re-homed" clause. §3's
blockers are resolved by the parent going DONE the same day (the overnight round-trip *was* §11's
condition; "on a real Pi" is superseded because the appliance is an x86_64 mini-PC). Of §4, the only item
without a home — sharpening the PPG averaged-pulse — is re-homed to FOLLOWUPS-II as D5, after verifying in
code that it is still foot-anchored and that nothing consumes it.

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: CPAP-AUTOHARVEST-2026-07-26-BRIEF.md
---
The CPAP auto-harvest could never bring the ez Share card up on a box where the packaged `wpa_supplicant.service` is active — which is the vigil box, and the default on Ubuntu with systemd-networkd (out-of-suite `capture-host/`; no bundle, no `manifestHash`, no fixture).

`_WPA_CONF` hardcoded `ctrl_interface=/run/wpa_supplicant` — the **system daemon's own socket directory**. Our `wpa_supplicant -B` therefore exited 255 the instant it tried to own a socket there ("Successfully initialized wpa_supplicant" on stderr, then gone), and the failure surfaced as `state='error', detail="Wi-Fi profile 'ezshare' would not come up safely"` — naming the profile, the one thing that was never wrong. That is the same mis-aimed-reason defect CAPTURE-HOST-DEEP-AUDIT §E5 fixed once already, arriving by a different route. The module's own comment anticipated "two supplicants driving one interface fight over the association", but the mitigation it describes ("bound to OUR conf and OUR interface") never held, because a shared control directory collides before the radio is ever reached.

**Timeline on the real box, which is what proves the cause:** the harvest has succeeded exactly ONCE — a 523 MB backfill (197 DATALOG nights through 20260725, `STR.edf`, `Identification.json/.crc`, `SETTINGS/`) finishing 07-26 19:02. `wpa_supplicant.service` started 07-26 19:56:10 as PID 1520, owning `/run/wpa_supplicant`. Every attempt after that — two manual `POST /api/cpap/pull` at 21:25 and 21:26, and the scheduled run at 07-27 13:00:34 — failed. Not sudoers (the whitelisted commands run), and not a read-only mount: the `error: Read-only file system` string in the 07-26 log is `wpa_cli` failing to reach the ctrl socket, and adding `/run/wpa_supplicant` to `ReadWritePaths` does not fix it.

**Second defect, found while fixing the first:** every `wpa_cli` call omitted `-p`, so it resolved through that same shared directory. The status poll interrogated the SYSTEM supplicant, and `_wpa_down`'s `terminate` would have **killed the box's own wpa_supplicant**. Bounded today only because `wlp1s0` is DOWN/NO-CARRIER and the uplink is wired `eno1`, so terminating PID 1520 would not strand the box — but on a Wi-Fi-uplinked box the CPAP teardown would have taken the network down with it.

**Fix:** a private `_WPA_DIR = "/run/tepna-wpa"` (created before launch), every `wpa_cli` pinned to it with `-p`, and a supplicant that fails to start is now torn down and logs the real `rc` + last stderr line instead of blaming the profile.

Gated: 3 tests, each verified RED against the pre-fix code — the conf must not name the system directory, every `wpa_cli` (the destructive `terminate` specifically) must carry `-p`, and a half-started supplicant must tear down and say why. capture-host pytest **1572 → 1575 green**, and the CI gate `pytest --cov --cov-branch --cov-fail-under=100` still reports **100.00%** (`cpap_harvest.py` 265 stmts / 88 branches, 0 missing).

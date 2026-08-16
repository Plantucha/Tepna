---
bump: patch
type: changed
brief: VIGIL-AUTO-UPDATE-FOLLOWUPS-2026-08-14-BRIEF.md
---

§3's audit is run and written down: which privileged helpers depend on `ReadWritePaths`, and which do
not. It corrects one of that brief's own claims.

A helper spawned **by the daemon** inherits the unit's mount namespace, and `sudo` does not escape it —
privilege is not a namespace. So a helper writing outside the writable set fails with `Read-only file
system`, which reads like a permissions bug and is a sandbox one. §3 assumed the helpers "work today *by
having been listed*, not by design". Read rather than assumed:

| helper | writes | why it works |
|---|---|---|
| `tepna-rssi.sh` | **nothing** — `hcitool` read → stdout | cannot fail this way at all |
| `tepna-clock.sh` | `/etc/chrony/sources.d/…`, `/etc/systemd/timesyncd.conf.d/…` | **by having been listed** |
| `tepna-btreset.sh` | `/sys/bus/usb/drivers/usb`, `/sys/bus/usb/devices` | by `ProtectSystem=strict`'s carve-out |
| `tepna-usbreset.sh` | `/sys/bus/usb/devices` | by the same carve-out |
| `tepna-restart.sh` | `/opt/tepna/.git` — **outside the list** | it FAILED; fixed by `systemd-run --uid=vigil` |

**Correction:** §3 says *"`tepna-clock.sh` and `tepna-rssi.sh` … write to `/etc/chrony` / `/run/chrony`"*.
`tepna-rssi.sh` writes nothing. The two were lumped, and only the clock helper is exposed.

**So the writable set is two things, and only one is maintained by anyone:** `ReadWritePaths`, and
`ProtectSystem=strict`'s own `/dev` `/proc` `/sys` carve-out. Exactly **one of five** helpers depends on
the list — narrower than the brief assumed, and it is also the one nobody would notice breaking, because
chrony keeps working from its existing config.

Documented in `check-system-files.sh`'s header, which is §3's second box and the place a helper author
actually meets the constraint.

⚠️ **The class has already bitten a second subsystem, found while running this audit.** The journal
carries **95 `Read-only file system` lines from the CPAP Wi-Fi path** — `/run/wpa_supplicant`,
`/run/tepna-wpa`, `/tmp/tepna-wpa-1000`, all outside the set — dated **2026-07-26 → 07-29 and none
since**, while `ReadWritePaths` was never changed. Harvest still runs daily (849 journal lines since
08-08, most recent today), so it was fixed in code or that leg is no longer reached. **Which of the two
is not established**, and that is recorded rather than guessed. §3's prediction had already come true in
a different subsystem before the brief was written.

Docs and one shell header; no behaviour change. §2 (the helper-install privilege model) and §4/§5
(decisions) remain owner calls.

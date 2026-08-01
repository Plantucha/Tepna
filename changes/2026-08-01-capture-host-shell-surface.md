<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: none
---
Bring capture-host's shell surface under test and lint — the three NOPASSWD root helpers had neither.

Python coverage there is 100% statement AND branch and CI fails under it, but that denominator is .py
files: the ~16 shell scripts beside them were outside it entirely, including `tepna-clock.sh`,
`tepna-restart.sh` and `tepna-rssi.sh` (each held by a `NOPASSWD` sudoers grant) and the two installers
that WRITE `/etc/sudoers.d`. 51 new tests drive the three helpers for real with their entire external
command surface stubbed onto PATH: input validation (shell metacharacters, bad MACs, bad adapters, bad
timezones), the chrony-vs-timesyncd branch that once wrote a drop-in chrony never reads and reported
success, chrony's log2 `maxpoll` conversion, `sync` using burst + conditional makestep rather than a
restart that unsynchronises the box for ~60 s, the fixed-verb grant scope, a restart that comes up dead
failing loudly, and the signed-int8 RSSI fold at its boundaries. `tepna-clock.sh` gains a `TEPNA_ETC_ROOT`
test seam that is inert under sudo by construction (`id -u != 0`), so the grant cannot be turned into
"root writes any path you name". A new inventory gate requires every `.sh` to parse, carry SPDX, and be
either owned by a named test or listed as untested with a reason, so the gap cannot reappear silently —
it immediately found nine deploy scripts with no SPDX header (now stamped) and `fix-web-origin.sh`
overwriting the live `/etc/caddy/Caddyfile` BEFORE validating it, the same bug `expose-monitor.sh` records
having fixed; it now composes to a temp file, validates that, and only then installs. Also asserts the
installers' security invariants against their source: the sudoers grant names the root-owned `$DST` copy
and never the user-writable in-repo one, `$DST` equals `helper_path.SYSTEM_DIRS[0]` (a cross-language
invariant nothing checked), `visudo -cqf` runs before the install, and no grant names a general-purpose
tool.

Adds **shellcheck** at `--severity=style` — the strictest level — as a CI step and as a pytest, so a
developer sees the failure before CI does. The tree was 0 error / 0 warning / 13 info; getting it clean
turned the `A && B || C` counter updates in `sync-apps.sh` and `install-services.sh` into `if/else` and
replaced an `ls | wc -l` with a glob array, leaving five inline `# shellcheck disable=` suppressions —
each carrying a proof at the line, and a further test asserts that every suppression does.

Then fixes the six findings a deep audit of the same tree produced, each proven by a failing test first.
**F1 (data loss):** `nightarchive._mirror_matches` and `archive_night` both skipped anything that was
not a plain top-level file, so a night holding a subdirectory was CONFIRMED fully mirrored while the
subdirectory had never been copied — and confirmation is what releases the local copy to
`prune_old_nights`. They now share one enumerator (`rel_files`) and cannot disagree about what a night
contains; `os.walk(onerror=_raise)` keeps the OSError paths failing safe (dropping it reintroduces the
same fail-open, and the pre-existing tests catch that). **F3 (silent failure):** `polar_psftp` computed
`ok: len(data) == size` per file and wrote the bytes under the real name regardless, with no caller
reading the field — a truncated onboard recording, i.e. the backup that exists because the live link is
lossy, looked like a successful pull. It now lands in `.part` and is promoted only when the length
checks out, the same posture `cpap_harvest.short_read` already documents; the verdict reaches the
journal and the monitor. **F3b:** `pull_polar_offline_all` documented "skips a file already on disk at
the same size" and did not — every on-charger auto-pull re-downloaded the device's whole flash over BLE
with capture paused, reporting every file as new. **F5 (wrong key):** `nightqc`/`timeline` searched an
unanchored `_(\d{14})_`, so on a 14-digit device serial the SERIAL parsed as the session stamp and keyed
the file to a night eighteen months away; both now use the anchored, year-validated
`writers.file_stamp`, the sibling `file_device_id` already used. That removed the last reference to a
regex `webmon` reached through `_timeline._STAMP_RE` inside an `or True` that made the whole condition
constant — dead logic, now replaced by what it actually did. **F2 (single-copy exposure):**
`captures/stored/` (onboard device-flash pulls) and `captures/cpap/` (harvested EDFs) were outside the
mirror entirely, behind a mirrored-nights count that reads as "the backup is working". Measured before
deciding: 1.5 MB and 534 MB against ~942 MB **per night**, so the disk-budget question this looked like
does not exist — both are now mirrored by default (`archive.include_subtrees`). They are APPEND-FOREVER
rather than finished, so `mirror_subtree` runs a size-diff every cycle with no `.archived` marker; a
night dir and `incoming/` (partial in-flight downloads, which a mirror would dress up as data) are
refused in code, not by config. Mirroring is explicitly NOT a licence to prune — the warning is at the
line, because "it has a second copy now" is the same reasoning that made F1 a data-loss path.
`uncovered_subtrees` stays as the guard for the NEXT subtree someone adds, subtracting what is actually
covered so it does not become a reporter nobody reads. **F6:** `Spo2CsvWriter` enforced its own blank-not-zero rule for
`pr` only, so an absent SpO2 would have written the literal string `None`. **F4 (docs):** the sport
brief's PSL layout table gave acc/gyro/mag a `timestamp [ms]` column that neither PSL nor the box emits,
named the PPG columns `ppg0/1/2`, and merged the two files PSL splits.

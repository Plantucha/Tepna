<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: none
---
Close the mutation survivors in the three weakest capture-host modules, and bound the Python mutator so webmon can be measured at all.

Acting on `audits/MUTATION-AUDIT-FINDINGS-2026-08-02.md`, whose headline was that a quarter to a half
of mutations are invisible to a suite pinned at 100 % statement+branch coverage. **No shipped source
changed** — every survivor closed here was closed by asserting something the tests already had in
front of them and never looked at.

**`pull_session.py` — 46 % → 62 % killed (250 → 179 survivors, 71 killed, 0 regressions).** The
finding worth the audit on its own: `_install` stubbed `BleakScanner.find_device_by_filter` with a
`find(*a, **k)` that returned the device and never invoked the filter — so the lambda deciding *which
BLE peer the pull connects to* had no test at all. Twelve mutations of it survived, including
`address == … or name-matches …` → `and`, which strands the pull whenever the ring's MAC has rotated —
the exact case the `or` exists for. The fake scanner now applies the real predicate, putting that
decision under every test in the file. Also: `continue` → `break` in the per-session loop (one
unusable session on flash would abandon every night behind it — and with `which="all"` the *first*
session is nearly always the already-on-disk one, so a new night would never be collected); the
7-argument wiring and every default of `pull()`, which only ever ran against arg-ignoring stubs; the
`8 ≤ len(ts) ≤ 14` and `0 < size` boundaries; and the sidecar's own numbers.

**`storage_targets.py` — 65 % → 81 % killed (373 → 209 survivors, 164 killed, 0 regressions).**
`mount_unit` emits a systemd unit installed into `/etc/systemd/system` and a list of commands the
operator pastes into a **root shell**, and the existing tests asserted substrings of it. So
`default_opts += ",credentials=…"` could become `=` — replacing the whole option set, dropping
`uid/gid/file_mode/dir_mode`, mounting the share as root — with everything green. The unit body, its
systemd-escaped filename and the root steps are now asserted whole. `rsync_argv` likewise: its
`dry_run=False` default is what `push_night` uses for the real copy, and flipping it makes every
offload transfer nothing while the verify pass (itself a `--dry-run` finding nothing pending) reports
"copied and verified byte-for-byte".

**`cpap_harvest.py` — the commands, and whether they run as root.** The tests recorded `argv[0]`;
`sudo=True` → `sudo=False` survived on all three teardown steps, as did `_wpa_dir(root)` →
`_wpa_dir(None)` (which points `wpa_cli terminate` at the *system* supplicant's socket directory) and
a `wifi_down` that is not told which interface it brought up.

**`tools/mutate.py` — the flat `--timeout 3600` is why webmon was never measured.** It is ~15000× the
clean run of the cheapest module and not quite 2× what webmon needs, and `TimeoutExpired` propagated
out of `run_one`, so both attempts died with a traceback and left no measurement — webmon went into the
audit as "unmeasured" rather than "ran this long, got this far". The cap is now derived from the
module's own clean run, a cap that IS hit reports its partial counts behind an explicit `timed_out`
flag, `--estimate` prices a module before it costs anything, `--budget` skips loudly, and a skip exits
non-zero. Ported from `tools/mutate.mjs` (#702), which reached the same conclusions the same day.

**Recorded, not fixed, because they are equivalent mutants:** `_pull_once`'s two `continue` → `break`
rejects on the traversal/non-stamp paths (`which=<specific>` makes `targets` a single-element list and
`parse_file_list` only emits exactly-14-digit stamps, so no test can distinguish them), and `pull()`'s
`loop.time() >= deadline` → `>` (a timing boundary that monotonic time makes unreachable). Confirmed
still surviving after the pass, which is the correct outcome for both.

Tests + tooling only — no shipped source, no `manifestHash` movement, no fixture re-recorded.

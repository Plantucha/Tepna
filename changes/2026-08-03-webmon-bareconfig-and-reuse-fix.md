<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Scratch reuse silently produced a false 100 %, and webmon's bare-config routes are now covered.

**The tool bug first, because it fabricated a result.** The hash-keyed scratch reuse refreshed only the
test files NAMED IN THE SELECTION. `tests/_srcscan.py` is a helper, never in a selection, so a scratch
predating it kept a stale `tests/` and every run died with `ModuleNotFoundError: tests._srcscan` —
which mutmut reports as *"Failed to collect list of tests"*. `mutmut results` then returned an empty
list, and a naive rate calculation over it reads **100 % killed**. Reuse now refreshes the whole
`tests/` tree; any new conftest, fixture module or helper would have done the same.

This is the fifth way a mutation run fails while looking fine, and the first that was self-inflicted.
The runbook's §1 already said *check `rc`, not the flag* — `rc: 1` and `elapsed_sec: 0.8` were both
sitting in the output.

**Also corrected in the runbook:** mutmut CACHES per-mutant verdicts between runs and resets only what a
change invalidated, so a re-run on a reused scratch is INCREMENTAL. That is what makes iteration cheap,
but an 18 s re-run is not a full measurement — use `--no-reuse` before publishing a module's rate.

**The webmon pass:** the `cfg.get("devices", [])` sites on the six routes `_mk_bare` could not reach
(settings POST, timesync, timesync/all, Polar recordings, Polar pull, forget, timeline) — each a 500 on
a box before its first pairing — plus the seven-survivor `mount_unit` guard, where `and` → `or` emits a
systemd unit for a target that needs none. 24 killed.

<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — re-measure with `capture-host/tools/mutate.py`) · **last-verified:** 2026-08-02

# Mutation audit — `capture-host/` (Python)

> **What this answers, and why coverage could not.** `capture-host/` has been at **100 % statement +
> branch coverage** since the 2026-07-27 pass, enforced at `--cov-fail-under=100`. Coverage asks *"was
> this line executed?"*. Mutation asks *"would any test NOTICE if it were wrong?"* — and on a tree
> already at 100 % those are different questions, because a fully-covered line can still sit under an
> assertion that never looks at the value it produced.
>
> This closes the gap `TEST-AUDIT-FINDINGS-2026-07-18-BRIEF.md` §34 recorded (the Python side was never
> mutation-audited) and is the sibling of the JS side's `tools/mutate.mjs`.
>
> **Engine:** unmodified **mutmut 3.7.0**. **Driver:** `capture-host/tools/mutate.py` (per-module
> scoping into a `/tmp` scratch copy). **Gate:** `capture-host/tools/mutate_diff.py`, wired as the
> `mutation-diff` job — diff-scoped, never whole-tree.

---

## The headline

**A quarter to a half of mutations are invisible to a suite at 100 % coverage.** The weakest module,
`pull_session.py`, is the O2Ring `.dat` puller — the backup path that exists *because* the live BLE
link is lossy.

| module | kill rate | killed / total | survivors | worst functions |
|---|---|---|---|---|
| `pull_session.py` | **47%** | 216/458 | 242 | `x__pull_once` (156), `x_main` (47), `x_pull` (37) |
| `offline_lock.py` | **50%** | 1/2 | 1 | `xǁOfflineBusyǁ__init__` (1) |
| `proc_util.py` | **56%** | 9/16 | 7 | `x_kill` (7) |
| `storage_targets.py` | **65%** | 700/1073 | 373 | `x_mount_unit` (74), `x_validate` (72), `x_test_target` (58) |
| `polar_psftp.py` | **69%** | 734/1052 | 318 | `x_pull_recording` (66), `x_main` (62), `x_list_recordings` (39) |
| `cpap_harvest.py` | **72%** | 883/1226 | 343 | `x__wpa_up` (63), `x__sh` (35), `x_wifi_up` (33) |
| `writers.py` | **75%** | 431/568 | 137 | `xǁHostClockLogWriterǁwrite` (30), `xǁStreamWriterǁ__init__` (21), `x_file_device_id` (13) |
| `oxyii.py` | **77%** | 269/349 | 80 | `x_parse_live` (13), `x_parse_file_list` (12), `x_auth_payload` (8) |
| `timeline.py` | **77%** | 498/639 | 141 | `x_build` (58), `x_read_link_samples` (43), `x_wedge_buckets` (11) |
| `link_rssi.py` | **78%** | 158/202 | 44 | `x_dbus_hci` (18), `x__run` (8), `x_read_rssi` (7) |
| `telemetry.py` | **78%** | 204/259 | 55 | `xǁTelemetryBusǁpush` (16), `xǁTelemetryBusǁmeta` (12), `x_stream_health` (9) |
| `nightqc.py` | **80%** | 506/625 | 119 | `x_summarize` (47), `x__model_of` (23), `x_file_span_sec` (21) |
| `host_clock.py` | **81%** | 433/530 | 97 | `x_read_state` (46), `x_classify` (25), `x_parse_chrony_tracking` (10) |
| `viatom.py` | **88%** | 37/42 | 5 | `x_decode_packet` (5) |
| `polar_pmd.py` | **89%** | 519/577 | 58 | `x_decode_frame` (26), `x__decode_delta_ex` (14), `x_chosen_rate` (5) |
| `nightarchive.py` | **94%** | 262/278 | 16 | `x_uncovered_subtrees` (5), `x_pending_nights` (4), `x__grew_since_marker` (2) |
| `sdnotify.py` | **97%** | 40/41 | 1 | `x_sd_notify` (1) |
| `settings_schema.py` | **97%** | 77/79 | 2 | `x_set_nested` (2) |
| `helper_path.py` | **100%** | 21/21 | 0 | — |

`webmon.py` is not in the table: it exceeded the driver's per-module timeout twice and is the one
module still unmeasured. `capture.py` was sampled on its `_now` clock path only (69 of ~7 177 mutants,
52 % killed).

---

## ⚠️ Read the rates with this caveat, or you will chase noise

**Raw kill rates overstate the gap.** On `capture.py`'s `_now` I classified every survivor: **29 of 33
were mutations of log-message wording** (`log.warning("ABSORBED CIVIL SHIFT…")`), 2 were float
boundaries that cannot be hit, and only **2 were logic worth reading**. The large modules here are
comment- and log-heavy, so expect the same shape. A survivor proves the suite cannot see a change at
that line — nothing more. Triage before you act; the split matters more than the percentage.

Categories that are legitimately untestable and should be dismissed on sight:

* string-literal mutations of log/error prose,
* float boundaries (`< settle_sec` → `<= settle_sec`),
* **equivalent mutants** — e.g. both `plan_prune` boundary mutants (`keep_nights <= 0` → `< 0`, and
  `len(nights) <= keep_nights` → `<`) reach `nights[:-keep_nights]`, which returns `[]` in exactly the
  cases the guard short-circuits. No test can distinguish them because there is no difference.

---

## Confirmed leads that were fixed (2026-08-02)

Each was proven by a failing test written first, then re-measured to confirm the mutant died.

| finding | mutant | consequence |
|---|---|---|
| **The low-disk flag's production case was untested** | `diskguard.disk_report`: `min_free_gb > 0 and free_gb < min_free_gb` → `or` | Both existing tests pass under the mutant: one uses the default `0.0`, the other `1e9`. Neither covers *threshold set, disk healthy* — the only configuration the box runs (`min_free_gb: 2`, 83 GB free). Under the mutant the low-disk alert fires **on every poll, forever**. |
| **`free_gb` precision unasserted** | `round(free_gb, 2)` → `round(_, None)` (returns an int) | It is a surfaced number — status.json, the storage card, the alert text. |
| **The Notifier's fail-safe default was unpinned** | `alerts.Notifier.__init__`: `enabled: bool = False` → `True` | Every test passed `enabled=` explicitly. That default is what stands between "no webhook configured" and every install attempting POSTs. |
| **Un-keyed alerts could dedupe against each other** | `alerts.Notifier.send`: `key is not None and dedupe_sec > 0` → `or` | A `key=None` alert stores itself under the `None` key and suppresses the *next unrelated* un-keyed alert. Two different events collapse into one delivery. |

Result: `alerts` 87→**89** killed, `diskguard` 73→**78**.

---

## Two harness defects found by running this

**1. A test hard-coded the checkout's directory name.**
`test_resolve_falls_back_to_the_in_repo_copy` asserted `"capture-host" in got`. The contract is "falls
back to the copy beside `helper_path.py`"; the directory *name* is not part of it. It failed in every
copy of the tree — a git worktree, a vendored checkout, the mutation scratch copy — and blocked three
modules. Fixed to assert against the module's own directory; `helper_path` then measured **100 %**.

**2. Source-scanning tests cannot run against a mutant file — and fail silently as "not checked".**
mutmut 3 generates **one** file holding every mutant inline and dispatches at runtime. A test that
greps source therefore sees all mutants at once. `test_no_deprecated_apis.py` scans for bleak's
deprecated bare `adapter` kwarg, and mutmut's `"bluez"` → `"BLUEZ"` string mutation inside
`pull_session.py` tripped it on **every run including the baseline** — which mutmut reports as
"not checked" for the whole module, looking like an environment problem rather than a harness bug.
Such tests are now excluded in the driver (`SOURCE_SCANNING_TESTS`).

**Both matter beyond mutation:** a baseline that fails *silently* inside the copy would mark every
mutant "killed" and hand back a meaningless 100 %.

---

## Where to go next (highest value first)

1. **`pull_session.py` — 47 %, 242 survivors**, 156 of them in `_pull_once`. It is the onboard-recording
   backup path; a wrong answer there is silent by construction.
2. **`storage_targets.py` — 373 survivors**, concentrated in `mount_unit` / `validate` / `test_target`
   (the offload destination validators).
3. **`cpap_harvest.py` — 343 survivors**, concentrated in `_wpa_up` / `wifi_up` — the Wi-Fi association
   path whose default-route guard is what stops the box stranding itself.
4. **`webmon.py`** — still unmeasured; needs a narrower test selection or a longer cap.
5. **`capture.py`** — sample it one subsystem at a time (`--only 'capture.x__now__*'`), never whole.

Per-module survivor lists are reproducible with `tools/mutate.py <module>`; they are NOT committed,
because they are a measurement of a moment and go stale the instant a test changes.

<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — re-measure with `capture-host/tools/mutate.py`) · **last-verified:** 2026-08-02 (second pass: three targets closed, webmon measured)

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

`capture.py` was sampled on its `_now` clock path only (69 of ~7 177 mutants, 52 % killed).

> **The table above is the FIRST-PASS measurement and five rows are now stale by design** — see
> *Second pass* and *Third pass* below for the current numbers on `pull_session`, `storage_targets`,
> `cpap_harvest` and `polar_psftp`, and for webmon, which the second pass measured for the first time.
> The original figures are kept as written because they are what the findings below were derived from.
>
> ⚠️ **A survivor list goes stale the moment the MODULE changes, not just the tests — and it goes stale
> silently, because the mutant IDs are still valid names.** `polar_psftp.py` was re-measured for the
> third pass and had 1 154 mutants where the table records 1 052: PR #710 landed 81 new source lines
> between the two runs. Mutant numbering is per-function and positional, so every ID in a function that
> PR touched now points at a *different* mutation — reading the old list's `x_list_recordings__mutmut_50`
> against the new tree hands you a plausible, wrong diff. IDs in functions the PR did NOT touch remain
> exactly valid, which is what makes the staleness hard to see. **Re-measure the module before triaging
> it**, then diff the ID sets.

### webmon, measured — and why it took two attempts to find out

`webmon.py` was the one module the first pass could not measure: it "exceeded the driver's per-module
timeout twice". Measured on the second pass it takes **3 857 s** — against a cap hard-coded at
**3 600 s**. It was never pathological. It was 7 % over an arbitrary number.

Two things had to be fixed before the number could exist at all (both in `tools/mutate.py`):

* the flat `--timeout 3600` is ~15 000× the clean run of the cheapest module here and 0.93× what
  webmon needs. The cap is now **derived from the module's own clean run**, and `--estimate` prices a
  module before it costs anything.
* `subprocess.TimeoutExpired` propagated straight out of `run_one`, so each attempt died with a
  traceback and left **no measurement whatsoever** — which is how a module 7 % over budget came to be
  recorded as unmeasurable. A cap that IS hit now reports its partial counts behind an explicit
  `timed_out` flag, because "ran this long, got this far" is a result and a traceback is not.

| module | kill rate | killed / total | survivors | worst functions |
|---|---|---|---|---|
| `webmon.py` | **59%** | 1402/2356 | 954 | `x_make_app` (926), `x__warn_comment_loss` (12), `x__has_comments` (10) |

That makes webmon the second-weakest module in the suite — below `storage_targets`, above only
`pull_session`'s original 47 %. The shape is unusually concentrated: **926 of its 954 survivors are in
`make_app` alone**, one very large function holding the whole aiohttp route table. So "webmon is
weakly tested" is really "the route table is weakly tested". Triage it a route at a time with
`--only 'webmon.x_make_app__mutmut_*'`, and do not read the module-level percentage as a property of
the module.

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

## Second pass — the three named targets, closed (2026-08-02)

Same method: triage first, write the test failing-first, then re-measure and confirm the specific
mutant flipped to killed **by ID**. **No shipped source changed** — every survivor below was closed by
asserting something the tests already had in front of them and never looked at.

| module | kill rate | survivors | killed this pass | regressions |
|---|---|---|---|---|
| `pull_session.py` | 47 % → **62 %** | 250 → 179 | 71 | 0 |
| `storage_targets.py` | 65 % → **81 %** | 373 → 209 | 164 | 0 |
| `cpap_harvest.py` | 72 % → **77 %** | 348 → 282 | 66 | 0 |

**The finding worth the audit on its own.** `test_pull_session.py`'s `_install` stubbed
`BleakScanner.find_device_by_filter` with a `find(*a, **k)` that returned the device and **never
invoked the filter** — so the lambda deciding *which BLE peer the pull connects to* had no test at
all. Twelve of its mutations survived, including

```python
d.address.upper() == address.upper() or any(h in name for h in _NAME_HINTS)   # or → and
```

which strands the pull whenever the ring's MAC has rotated — the exact case the `or` exists for. The
fake scanner now applies the real predicate, which puts that decision under every test in the file.
This is the general shape: **a fake that ignores an argument makes the code that computes it
untestable**, and coverage cannot see the difference.

Others of the same kind:

* `_pull_once`'s `continue` → `break` in the per-session loop. With `which="all"` the *first* session
  is nearly always the one already on disk, so breaking there means a genuinely new night is never
  collected — and it fails silently, returning a shorter list rather than an error.
* `mount_unit` emits a systemd unit installed into `/etc/systemd/system` plus commands the operator
  pastes as **root**, and the tests asserted substrings of it. So `default_opts += ",credentials=…"`
  could become `=`, replacing the whole option set — dropping `uid/gid/file_mode/dir_mode` and mounting
  the share as root — with everything green. The unit body, its systemd-escaped filename and the root
  steps are now asserted whole.
* `rsync_argv`'s `dry_run: bool = False`. That default is what `push_night` uses for the **real** copy;
  flipped, every offload transfers nothing while the verify pass — itself a `--dry-run` finding nothing
  pending — reports "copied and verified byte-for-byte".
* `cpap_harvest`'s teardown ran `sudo=True` → `sudo=False` on all three commands undetected, because
  the tests recorded `argv[0]` and nothing else. Same for `_wpa_dir(root)` → `_wpa_dir(None)`, which
  aims `wpa_cli terminate` at the **system** supplicant's socket directory, and for the `timeout`
  argument, where `None` reaches `subprocess.run` as *wait forever*.

### Equivalent mutants, recorded so nobody re-derives them

Confirmed **still surviving** after the pass, which is the correct outcome for all three:

* `_pull_once`'s two `continue` → `break` on the traversal / non-stamp reject paths. Those are only
  reachable via `which=<specific>`, which makes `targets` a single-element list — and
  `oxyii.parse_file_list` only ever emits exactly-14-digit stamps, so they cannot be reached from
  `which="all"`. `continue` and `break` are indistinguishable there by construction.
* `pull()`'s `loop.time() >= deadline` → `>`: a timing boundary that monotonic time makes unreachable.

---

## Third pass — `polar_psftp.py`, closed (2026-08-02)

Same method, and the same result in a starker form. **No shipped source changed.**

| module | kill rate | survivors | killed this pass | regressions |
|---|---|---|---|---|
| `polar_psftp.py` | 75 % → **94 %** | 280 → 57 | 223 | 0 |

The starting figure is **not** the 69 % / 318 in the headline table: re-measuring first (see the
staleness note above) put the module at 1 154 mutants, 280 surviving, because #710 had already closed
`walk` and `_session_descend` to zero survivors apiece.

**Every one of the 223 traces to a double that accepted an argument and threw it away.** The two
extremes make the point better than a percentage:

* **`_bt_disconnect`: 22 survivors out of 22 mutants** — the entire function, under a test named
  `test_bt_disconnect_runs_and_swallows_errors` that was pointed straight at it. Its fake was
  `async def fake(*a, **k)`. So `p = None`, `"bluetoothctl"` → `None`, `"disconnect"` → `"DISCONNECT"`
  and the address → `None` were all invisible: under any of them the pre-connect BlueZ clear silently
  does nothing, and bleak goes back to losing the fight for the device's single BLE slot that this
  function exists to win.
* **`__aenter__`: 24 survivors under four tests aimed at it**, because `BleakClient` was stubbed
  `lambda dev, **kw: client`. `dev` is the *entire content* of the scan-then-fall-back logic — a rich
  device object when the advertisement scan hits, the bare address when it misses — and the stub
  discarded it, so inverting the fallback (`if not dev` → `if dev`) changed nothing any test could see.
  `start_notify(self, _char, cb)` discarded the characteristic UUID the same way: subscribing to `None`
  instead of the one characteristic all PS-FTP traffic rides was equally invisible.

The fix is one shared change plus assertions: `FakeClient` now **keeps every argument it is handed**
(constructor device, scan address and timeout, adapter kwargs, notify/write characteristic, write mode,
`_acquire_mtu` calls, query params) and `_install` records instead of ignoring. Two stub defaults were
deliberately set to *not* mirror production — `find(addr, timeout=None)` and
`write_gatt_char(..., response=None)` — because a double that repeats the real default cannot
distinguish "passed correctly" from "not passed at all". That one detail was worth two more mutants:
the first pass of this very audit missed `write_gatt_char(MTU_CHAR, pkt)` for exactly that reason, and
so did a `fake_list(addr, adapter=None)` I wrote whose arguments I then never read.

Others of the same kind, all now asserted:

* `set_local_time` sent **`query(SET_LOCAL_TIME)` with the params dropped** — the device told to set
  its clock with no clock attached — undetected, because the test asserted only that the call
  completed. Same for the deliberate `tz_offset_min = 0`, the constant the whole common-timebase
  argument rests on (a non-zero offset is what put the Verity 4 h ahead of the H10 on 2026-07-18).
* `get_local_time` had **23 survivors in one `datetime(...)` call** — seconds read from field 4,
  minutes defaulting to 1, millis scaled by 1001 — under an assertion that checked `.year`, `.hour`
  and `.minute` and stopped. The components *after* the ones it named were free to be anything.
* `pull_recording`'s sidecar: `meta = None`, and `os.path.join('recording.meta.json')` — `out_dir`
  dropped, so the file that makes a pulled session self-describing is written into whatever directory
  the process happens to be in. No test had ever opened it.
* `manifest["files"]` assigned to a **misspelled key**, leaving the empty list it was initialised
  with: a pull that fetched a whole session reports zero files, and both readers print nothing.
* `main`: `--address`, `--out` and the **subcommand** all made optional. The module's own comment leans
  on the subcommand being required ("argparse has already exited, so the both-false arm cannot be
  reached"); with `required=False` that arm *is* reached and the CLI exits 0 having done nothing — the
  worst available way to fail a backup. And `'OK'` → `'XXOKXX'` survived `assert "OK" in out`, which a
  substring check cannot see.
* Three teardown/read bounds the module documents at length and nothing asserted: `__aexit__`'s
  `wait_for` timeout (five lines of comment explain that unbounded there means the caller's timeout can
  *never* fire — capture stays paused and the connect lock held for the rest of the night),
  `_read_response`'s queue wait, and the 180 s per-file download bound.

### Equivalent mutants, recorded so nobody re-derives them

Predicted before the run and confirmed **still surviving**, which is the correct outcome:

* `path.encode('UTF-8')` and `ev.decode('UTF-8', ...)` — Python codec names are case-insensitive.
* `_encode_query_header`'s three high-byte variants (`<< 8`, `>> 9`, `& 128`). Every allowlisted query
  id is < 256, so the expression is 0 under all of them and the original.
* `_pb_int32`'s `value < 0` → `<= 0` / `< 1`: the branches differ only at `value == 0`, where both
  produce `_uvarint(0)`.
* `__aenter__`'s `getattr(..., 'mtu_size', None) or 23` — identical to `..., 23) or 23` on every input.
  Likewise `get_local_time`'s `tt.get(4, None) or 0`.
* `_frame_mtu`'s initial value (`__init__` 9/10) and `pull_recording`'s initial `total_bytes`
  (mutant 21): both are unconditionally overwritten before anything reads them.
* `_with_retry`'s `last = None` → `''`: reachable only with `attempts=0`, where both `raise` the same
  `TypeError`.
* `list_recordings`' `idx >= 1` → `> 1` / `>= 2`: a session at index 1 would need the path `/E/HHMMSS/`,
  unreachable under `USER_ROOT = "/U/0/"`.

### What is left, and why it is not worth grinding

**57 survivors, and 28 of them are prose** — argparse `help=`/`description=` strings (20 of `main`'s
28), four `log.info` walk-progress formats, two `log.warning` texts, two `RuntimeError` messages.
Another 17 are the equivalents above. The rest is formatting (`json.dumps` indent width, the sidecar's
indent, the sort-key sentinel for a session with no date) and `list_recordings`' session-shape guard,
which needs a stray non-time entry directly under `E/` to distinguish `and` from `or`. Nothing in the
residue changes what the box does.

---

## Fourth pass — `writers.py`, closed (2026-08-02)

The module that writes the corpus. **No shipped source changed.**

| module | kill rate | survivors | killed this pass | regressions |
|---|---|---|---|---|
| `writers.py` | 76 % → **90 %** | 137 → 54 | 83 | 0 |

* **`fsync: bool = True` was unpinned in all five writers at once.** Every test in
  `test_writers_sidecars.py` constructs with `fsync=False` — correctly, to stay fast — so nothing held
  the default, and flipping it writes a whole night into page cache and calls it recorded. The audit
  made this exact finding once already on `alerts.Notifier(enabled=False)`; that it recurs is the
  point. A fail-safe default is invisible to a suite that always passes the argument.
* **Twenty-four survivors in one `";".join(...)`** in `HostClockLogWriter.write` — `st.get("stratum")`
  → `st.get(None)`, `"reference"` → `"REFERENCE"` — under assertions that read `cells[1]`, `[2]`, `[3]`
  and the last. The six columns in between were free to be anything, in the sidecar whose whole purpose
  is telling "stratum-1 PPS all night" from "the box free-ran on its RTC".
* The **`_RR` sibling**: `is not None` → `is None` in both `flush()` and `close()`, so the per-beat
  intervals never leave a 1 MiB buffer. Every existing RR assertion read the file *after* `close()`,
  which is the one moment that hides. Also the `rsplit("_HR.", 1)` the source comments at length and
  nothing tested.
* **`max(0, n-1)` → `max(1, n-1)`** on the open-writer counter: it floors at one and never reaches zero,
  so `capture`'s empty-writers health check believes the box is recording forever.
* PPI flag bits unpacked from the wrong positions ("skin contact supported" stuck at 1 turns an
  unknowable into a positive claim), and `file_stamp`/`file_device_id` over the filename shapes their
  own docstrings name.

### A test of mine broke the harness, in the way §2 predicts

`test_the_open_writer_count_returns_to_zero` first asserted the AMBIENT module global
(`open_sample_writers() == 0`) rather than resetting it. Plain `pytest` passed; mutmut's stats phase
orders tests differently, hit `assert 2 == 0`, and **the whole module reported "not checked"** — which
reads as a broken environment rather than a broken test, exactly the harness defect recorded above. It
now resets the counter via `monkeypatch`. Two lessons worth keeping: a test that reads ambient global
state is order-dependent even when it passes, and a `mutmut results` read while a run is still going
prints "not checked" for every mutant, which is indistinguishable from the real failure.

### What is left, and why it is not worth grinding

**54 survivors.** Twenty are `buffering=` sizes (byte-identical output), ten are `newline=None` — which
on Linux translates `\n` to `os.linesep` = `\n`, so it is equivalent on the only platform this ships
to — five are the `>=` → `>` float boundary on the flush cadence, four are `self._counted = None` vs
`False` (both falsy), and the rest are `rstrip("XX0XX")`-style literals that strip the same characters
plus an `X` that never appears in a formatted float. Nothing in the residue changes a written byte.

---

## Fifth pass — `webmon.py`'s `make_app`, closed (2026-08-02)

The aiohttp route table. **No shipped source changed.**

| module | kill rate | survivors | timeouts | killed this pass | regressions |
|---|---|---|---|---|---|
| `webmon.py` | 82 % → **89 %** | 395 → 240 | 25 → 13 | 178 | 0 |

**The largest cluster was one shape, and it is the worst one in the file:**

```python
{"ok": False, "error": "..."}   ->   {"ok": True, "error": "..."}      # status 400 / 409 / 500 / 502
```

Forty-nine of those survived. The tests asserted `resp.status`, and a few asserted `body["ok"] is True`
on SUCCESS paths — **nothing read the body of a FAILURE**. The browser branches on `ok`, so a refused
bond, a blocked CPAP pull, and a config write that hit a full disk would all have rendered as done. The
fix is not more assertions on `status`; it is asserting the response OBJECT, which is what the route
returns — the same discipline `pull_recording`'s manifest and `HostClockLogWriter`'s row already get.

Others:

* **Helper arguments discarded by `async def fake(*a, **k)` doubles** (~40). Including
  `bonding.forget(adapter_mac)` — which passes the ADAPTER as the address, so the box unpairs its own
  controller entry. This box has three BLE radios, so an `adapter_mac` computed and then dropped sends
  the operation out of whichever controller BlueZ picks.
* **The atomic config write** (~20). Its docstring explains at length why it is atomic — a truncating
  write left `config.yaml` empty on a full disk and the daemon came up recording nothing, silently.
  What no test checked was the MECHANICS: `dir=d` is what makes the temp a sibling, and without it
  `os.replace` crosses filesystems and the atomicity is gone.
* **The SSE stream** (~30). The old test read one frame and asserted `b"72" in frame` — a substring in
  a byte blob cannot see the headers, the `_all` multiplex, or the filter DIRECTION (`msg["stream"] !=
  key` → `==` gives a subscriber everything except what it asked for). `X-Accel-Buffering: no` is what
  stops a reverse proxy buffering an event stream into uselessness.
* **`os.path.join("monitor.html")`** — the directory dropped, so the index resolves against the process
  working directory. Under systemd that is `/`: the monitor 404s on the box while working fine from a
  shell in the source tree. Same defect class as `polar_psftp`'s sidecar.
* **Six guard inversions**, notably `enabled and tgt is not None` → `or`, which marks the archive
  enabled with NO target — the nightly offload then runs against nothing and reports success.
* **`100 * done // total` → `101 * done // total`**, which ends a completed pull at 101 %.

### The fixture, not the test, was the blind spot

`cfg.get("devices", [])` → `cfg.get("devices")` is identical while the key is present, and **every**
fixture supplied it. Only a config with no `devices` key — a box before its first pairing — tells them
apart, and then it is `None` where a list is iterated: a 500 on the monitor's first ever page load. A
`_mk_bare` fixture now covers that shape. Twenty-four such mutants remain on routes it does not yet
reach; they are the cheapest thing left.

### ⚠️ Adding tests can turn a `killed` verdict into a `timeout`

Eleven mutants in one contiguous block (`timesync_all` / `polar_pull`) went from `killed` to `timeout`
across this pass. They are **not** regressions — a timeout is inconclusive, and total timeouts FELL
25 → 13 — but the mechanism is worth knowing: **mutmut's per-mutant time budget is derived from the
baseline clean run and does not grow with the test selection.** Adding tests that cover a region makes
every mutant in that region slower to evaluate, so borderline ones brush the budget. Read the
survivor/timeout split, never the killed count alone, and diff the two sets separately.

### ⚠️ Its mutant file cannot be parsed — use a line-scan differ

~2 000 mutants of one ~900-line function makes `mutants/webmon.py` **113 MB / 1.9 M lines**.
`ast.parse` does not finish, so the AST survivor-differ used for every other module is useless here.
Scan for `def x_<fn>__mutmut_N(` headers and slice the raw source between them: linear, one second.
**`capture.py` (7 177 mutants) will hit the same wall.**

### What is left

**240 survivors + 13 timeouts.** Seventy-six percent is prose: 69 `XX`-marker string literals, 33
literal case-flips, 5 log messages, plus argparse-style help text. Of the 26 guard/comparison
survivors, most are `cfg.get(key, None)` — identical to the original wherever the key exists — and the
`<= 60` / `< 61` pair is a float boundary. The genuinely valuable remainder is small and named above:
the bare-config sites, `(tgt.get("kind") or "") == "mount" and …` → `or`, the `device_id` merge guard,
and the comment-loss warning's `and`/`or`.

---

## Sixth pass — `capture.py`, and why it was never measurable (2026-08-03)

`capture.py` is the daemon. The audit had it at **1 %** — 69 of 7 197 mutants, the `_now` path only —
with the standing advice "sample one subsystem at a time, never whole". That advice was necessary and
**not sufficient**, because `--only` filters AFTER generation: the 100 MB mutant file is built whatever
you scope to.

### The actual cause was two lines of tooling

| | |
|---|---|
| generated mutant module | **100 MB / 1.9 M lines** (7 197 mutants) |
| cold import | **429 s** |
| import with a `.pyc` | **0.4 s** |

`tools/mutate.py` set `PYTHONDONTWRITEBYTECODE=1`, and mutmut starts a **fresh process per mutant** — so
every one recompiled 1.9 M lines. 7 197 × 429 s is **36 days**. The flag existed to avoid `.pyc` litter;
the scratch is a throwaway `/tmp` copy, so it was protecting nothing. **Fixed.**

Second: the generated file is a pure function of the **mutated module** — mutmut copies test files but
never mutates them (`do_not_mutate = ["tests/*"]`). Regenerating on a *test-only* edit therefore rebuilt
a byte-identical 100 MB file and discarded the warm cache with it. Scratches are now keyed on the
module's hash and reused, and the record reports `reused_scratch` so nobody mistakes a reuse for a
fresh generation. **Measured: a `capture.py` iteration went from 22 min to 18 s; `sdnotify` 6.7 s → 1.0 s.**

### The subsystem: 16 pure decision predicates

| | kill rate | survivors | killed | regressions |
|---|---|---|---|---|
| `capture.py` (16 predicates, 230 mutants) | 83 % → **91 %** | 39 → 21 | 18 | 0 |

They gate whether a device is dropped, a clock corrected, a radio power-cycled — and the survivors sat
on the boundaries their own docstrings were written around:

* **`radio_looks_deaf`: `seen > 0` → `seen > 1`.** One heard advertisement is proof the receiver
  receives; the mutant power-cycles a radio that heard something. This is the function added *because*
  hci0 read `UP RUNNING` with 332 MB of lifetime traffic while a 20 s scan saw zero advertisements.
* **`transient_ble_error`: five survivors, all functional.** `text = repr(exc).lower()`, so a
  case-flipped marker can never match and a protocol refusal silently becomes retryable. The subtlety
  that let them survive a first attempt: unless the message ALSO carries a transient marker, the
  fall-through returns False too and the mutation is invisible.
* **`classify_adapter_health`**: the phantom reason's device-name prefix, under `"phantom BlueZ link"
  in h["reasons"][0]` — a substring of one element. Same defect as webmon's `assert "OK" in out`.
* Boundaries in `clock_resync_reason`, `oxyii_rtc_due`, `stream_is_stalled`, `rebond_due` — including
  `every <= 0` → `<= 1`, which reads a legal `every=1` as "disabled".

**Confirmed equivalent** (predicted, then confirmed surviving): `grace >= 0` in three predicates
(`bool(grace and …)` short-circuits identically), `err or "XXXX"` (both fail the `in` test), and
`defense_warnings`' `int(capeff_hex, 16)` → base 10/17 — the check is `== 0`, and a digit string is zero
in every base while a letter-bearing one either raises or is nonzero, so both paths emit no warning.
Of the 21 survivors, 16 are `defense_warnings` operator prose.

### A fourth way a mutation run fails while looking fine

Recorded alongside the three already in this doc. `tests/test_oxyii_rtc.py::test_the_clock_write_stays_
behind_the_policy` **scans source** — it asserts exactly one `set_time_frame(` call site and finds 664 in
the mutant file. mutmut reports that as **"failed to collect stats"**: the whole module unmeasurable, and
nothing that reads like a test failure. It now skips when it detects a generated file, rather than being
added to `SOURCE_SCANNING_TESTS` — that exclusion is per-FILE and would have removed `oxyii_rtc_due`'s
only coverage, turning its 10 mutants into fake survivors.

The full set, none of which look like an error at a glance: a poisoned baseline → "not checked" · a
mid-run `mutmut results` → "not checked" · a signal-killed run → `rc: -15` with `timed_out: false` · a
source-scanning test → "failed to collect stats".

### `tools/mutate_pure.py` — a fast path, deliberately not a replacement

An in-process harness: harvest mutmut's already-generated mutant bodies by line scan, then in ONE
process rebind `module.<fn>` per mutant and call the covering cases directly. **235 mutants/s** against
mutmut's ~13/s. Two things kept it honest:

* Running all cases per mutant made it SLOWER than mutmut (21 s vs 18 s). What makes mutmut fast is its
  stats pass mapping tests to functions; adding the equivalent (wrap the function in a recorder, run
  each case once, keep the callers) took it to 0.98 s. `radio_looks_deaf` is covered by 1 of 137 cases.
* It runs **zero-fixture tests only**, so it kills 183 where mutmut kills 209. Synthesising
  `monkeypatch`/`tmp_path` was tried and **reverted**: a test declaring only `monkeypatch` can still
  depend on AUTOUSE conftest fixtures, and one promptly tried to restart the real bluetooth service.

So its survivor set is a **superset** of the truth — false alarms, never blind spots. Use it to find
candidates in a second and confirm with `mutate.py`; `--self-check` exits 1 on any disagreement.

### ⚠️ `clock.js` has the same problem, an order of magnitude worse, and the same fix does NOT apply

Measured 2026-08-03: **`node tests/run-tests.mjs --group=clock` takes 7 m 49 s**, and `tools/mutate.mjs`
pays that PER MUTANT — ~16 h for clock.js's 123 mutants. The Python fixes do not transfer (there is no
100 MB file; the cost is the suite), and the in-process trick is **unsound** there: five DSPs do
`parseTimestamp = DexClock.parseTimestamp` at load time, so swapping the reference would be invisible to
them — silent false negatives. The JS win is a narrower group selection: which of the 41 groups the
`clock` tag selects can actually observe a clock mutation?

---

## Where to go next (highest value first)

1. **`capture.py` — the real blind spot.** ~7 177 mutants, of which 69 have ever been measured (1 %),
   on the `_now` clock path alone. Sample it one subsystem at a time
   (`--only 'capture.x_<func>__mutmut_*'`), never whole, and use the line-scan differ (see § Fifth pass).

2. ~~**`webmon.py`**~~ — **closed 2026-08-02 at 89 %** (see § Fifth pass). The former entry read: So "webmon is weakly tested" is really "the aiohttp
   route table is weakly tested" — the unit of work is a ROUTE, not the function. Triaged into six
   clusters: error-response bodies (`{"ok": False}` → `{"ok": True}` at status 400/409/502, invisible
   to tests that assert only `resp.status`), arguments discarded by helper doubles, the config
   atomic-write, the SSE stream handler, default paths, and six real guard inversions. 85 are pure
   string literals.

   ⚠️ **Its mutant file cannot be parsed.** ~2 000 mutants of one ~900-line function makes
   `mutants/webmon.py` **113 MB / 1.9 M lines**; `ast.parse` does not finish, so the AST-based
   survivor-differ used for every other module is useless here. Diff by scanning for `def
   x_<fn>__mutmut_N(` headers and slicing the raw source — linear, one second. `capture.py` (7 177
   mutants) will hit the same wall.

   Budget **~70 min per full run** (measured 4 204 s, `rc: 0`, cap 6 570 s), and a pass needs three.
2. **`pull_session.py` — 179 survivors remain.** The residue is dominated by log prose and
   `asyncio.sleep` durations; `x_main`'s argparse wiring is the largest untouched cluster with real
   content.
3. **`storage_targets.py` — 209 survivors remain**, now concentrated in `test_target` (the live rsync
   probe) rather than the validators.
4. **`capture.py`** — sample it one subsystem at a time (`--only 'capture.x__now__*'`), never whole.

**Do not wire a whole-tree kill-rate threshold into CI.** The gate that exists — `tools/mutate_diff.py`,
the `mutation-diff` job — is diff-scoped on purpose and must stay that way; a gate that reds on the
legitimately untestable is a gate someone switches off.

Per-module survivor lists are reproducible with `tools/mutate.py <module>`; they are NOT committed,
because they are a measurement of a moment and go stale the instant a test changes.

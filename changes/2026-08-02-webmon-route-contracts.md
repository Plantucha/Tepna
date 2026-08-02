<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Assert webmon's route contracts — 59 % → 82 % of mutations now killed, and two real defects fixed on the way.

Third pass on `audits/MUTATION-AUDIT-FINDINGS-2026-08-02.md`, taking its top remaining target. webmon was
measured for the first time in #707 at **59 %**, with **926 of its 954 survivors inside `make_app`** —
one 830-line function holding the whole aiohttp route table. The finding was never "webmon is weakly
tested" so much as "the route table is weakly tested", and the reason is specific: the existing tests
assert `resp.status` and a field or two, never the response BODIES or the arguments the handlers pass
down.

**Measured, `tools/mutate.py webmon` before and after: 954 → 417 survivors, 552 newly killed, zero
regressions.** (The 15 mutants that moved the other way are all `timeout`, not `survived` — the larger
suite pushed mutmut's baseline-relative per-mutant cap over the edge on 15 that previously completed.
Timeouts are counted as not-killed here, which understates the result.)

Ten test files, 201 tests, covering `_remembered`/`state`, `settings_get`/`_model_of`, `cpap_pull`,
`_storage_cfg`, `timeline_get`, `settings_post`, `polar_pull`, `pull_stored_h`, `remember`,
`timesync`/`timesync_all`, and the module-level helpers.

**Two real defects fell out of writing them, and both are fixed here** — so unlike the earlier passes,
this one does change shipped source:

* **A non-UTF-8 byte in `config.yaml` made every save fail.** `_has_comments` caught `OSError` but not
  `UnicodeDecodeError`, and `_save()` wraps it in a blanket `except Exception: return False` — so an
  accented device name typed in a Latin-1 editor takes the entire settings UI down with
  "config write failed (disk?)", a wrong reason for a disk that is fine, from a check that is purely
  advisory.
* **The comment-loss warning fired on configs with no comments.** The banner exclusion listed three
  phrases and missed the banner's own fourth line, so a freshly machine-written `config.yaml` was
  reported as carrying operator notes. That is precisely the cry-wolf failure the design set out to
  avoid — its docstring says it "deliberately ignores the banner we wrote ourselves". The exclusion is
  now derived FROM `_CFG_BANNER`, so it cannot drift again.

Both were negative-controlled: `webmon.py` reverted to `origin/main`, exactly those two tests red,
restored, green.

The recurring shape, now on its fourth instance in this repo: **a double that accepts an argument and
discards it makes the code computing that argument unobservable.** `test_webmon_cpap_pull.py`'s `_stub`
took `root=` and dropped it — and `root=` is the argument webmon's own comment calls load-bearing,
because without it the wpa control dir falls back to `/tmp`, read-only under `ProtectSystem=strict`. Its
docstring already had the right instinct written down ("a double that cannot accept what the caller
passes tests the double, not the caller"); accepting is not observing.

Verified: pytest 2019 passed (was 1818 at the start of this work), 100 % statement+branch held; ruff
clean; `node tests/run-tests.mjs` 4894 assertions green.

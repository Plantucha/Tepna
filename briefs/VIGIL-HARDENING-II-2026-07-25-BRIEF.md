<!--
  VIGIL-HARDENING-II-2026-07-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-25 · **Created:** 2026-07-25 · **Method-parent:** `AUDIT-PROMPT.md` · **Sibling:** `VIGIL-PPG-GRID-AUDIT-2026-07-25-BRIEF.md` (pass I) · **Closes:** `VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md` §P3.2

# Vigil hardening pass II — the destructive paths

> **Scope:** out-of-suite (`capture-host/`). No Dex bundle, no `manifestHash`, no provenance impact.
> **Gate:** capture-host pytest **971 green at baseline → 984 after** (+13 tests, 0 regressions);
> Node lane 3899 assertions green; `build.mjs --check` clean.
> **Why these modules:** pass I covered the signal path (`capture.py` grid, `telemetry`, `host_clock`,
> `link_rssi`, `writers`) and explicitly left `diskguard`/`nightarchive`, `webmon`, `polar_pmd` and
> `oxyii` uncovered. This pass takes the **destructive** ones first — the code that can delete a night
> or destroy the config — because the box is at 13.2 % free with retention about to engage, and is being
> migrated to new hardware.

---

## 0. The one-paragraph story

Two ways to lose everything, both live. **Retention deleted by AGE alone**, which treats "old" as "safe
to lose" — with the backup volume absent, the 15th night would have deleted a recording whose only other
copy was on a disk the box cannot see. And **`config.yaml` was written with a truncating `open(path,
"w")`**, so a full disk or a power cut mid-write left the appliance's entire configuration empty — and
silently, because the config is read exactly once at startup, so the damage only surfaces as "recorded
nothing all night" at the next restart. Both are fixed. A third, subtler one was found while fixing the
first: the `.archived` marker records that a copy was *made*, not that it still *exists*, so the obvious
version of the retention gate would still have deleted nights whose mirror had gone away with the disk.

---

## 1. Retention could delete the only copy — FIXED

### 1.1 The gate (closes VIGIL-OVERNIGHT-FINDINGS §P3.2)

`diskguard.plan_prune` deletes everything older than the newest `keep_nights`, full stop. Nothing
consulted whether a night had ever been offloaded. Measured on the box, 2026-07-25:

```
archive dest : /run/media/michal/data/tepna-archive   present: False
nights       : 10        keep_nights: 14
in 6 nights, age-only prune would delete : ['2026-07-16', '2026-07-17']
```

Now `nightarchive.unarchived_nights()` feeds the `protect` set whenever archiving is enabled, so a night
is deleted only once its second copy is confirmed. Same run, after:

```
with the gate, it deletes : nothing — no mirror can be confirmed
```

**The cost is deliberate.** A broken backup volume now *stalls* pruning instead of quietly consuming the
only copies, which can fill the disk. That is the correct trade for this suite — `diskguard`'s own header
already says a low-disk condition "is an *alert*, never an excuse to auto-delete this week's data" — but
it must never be silent, so it is surfaced three ways: `storage.retention_held` + `retention_held_reason`
in `status.json`, an edge-triggered `log.warning`, and a rewrite of the low-disk alert text. That last
one matters: a "disk low" alert on a box whose pruning is held by a dead backup volume otherwise reads as
*raise keep_nights*, which is the one action that would not help.

### 1.2 `active_nights` failed OPEN toward deletion — FIXED

`except OSError: continue` meant a night that could not be listed was reported **not active** — and this
set's only consumer is the protect-list for pruning. So EACCES, EIO (on a failing disk, precisely when
this runs hot) or EMFILE (on a busy daemon) made an unreadable night look settled and therefore prunable:
the doubt licensed the delete. Now only `FileNotFoundError` — a night that genuinely vanished — is
treated as inactive; every other `OSError` protects. The existing test asserted `== set()` for a bare
`OSError`, i.e. it **pinned the fail-open**; changed deliberately, with the reason recorded inline.

### 1.3 The `.archived` marker is not proof the copy survives — FIXED

Found while writing §1.1's tests, and it would have defeated the whole gate. The marker records that a
copy was once **made**. On the real box, **6 of 10 nights carried the marker while the backup volume was
absent** — so a marker-only gate would have cheerfully deleted the on-box copy of a night whose mirror had
gone away with the disk, losing both. `unarchived_nights(captures, dest)` now requires the marker **and**
`dest/<night>` to actually be there; a dest that is missing entirely means nothing can be confirmed, so
every night is protected. Fails safe throughout — an unreadable marker or mirror counts as unconfirmed.

---

## 2. `config.yaml` was written non-atomically — FIXED

```python
with open(cfg_path, "w") as f:          # TRUNCATES before it writes
    yaml.safe_dump(cfg, f, ...)
```

`open(path, "w")` truncates first. A failure partway — a full disk (the box is at 13.2 % free), a power
cut, a kill — left the only copy truncated or empty, and the `except` could not undo it: by the time it
ran the file was already destroyed. Returning `ok:false` does not restore a file.

The blast radius is the whole appliance and it is **silent**: `capture.py` reads the config exactly once,
at startup, so corruption changes nothing until the next restart — and then the daemon either fails to
parse it or comes up with an empty device list and records nothing, all night, with no error at the time
of the damage. Reachable from three endpoints (`/api/remember`, `/api/forget`, and the clock setter).

Now a standard atomic write: `tempfile.mkstemp` in the same directory → `fsync` → `os.replace` (atomic on
POSIX, so a reader sees the whole old file or the whole new one) → **directory fsync**, which is what
makes the rename itself survive a power loss. Failure at any step leaves the original untouched, reports
`false`, and removes the temp file.

**Read side hardened too.** `cfg = yaml.safe_load(open(args.config))` returned `None` for an empty file,
turning a truncated config into an `AttributeError: 'NoneType' object has no attribute 'get'` several
frames later — the least useful possible symptom for the most likely corruption. It now reads under a
context manager and exits with a message naming the problem.

---

## 3. Checked and found clean — do NOT re-file

- **IMU units, on real overnight data.** `|acc|` median **998 mg** (H10 chest) and **1028 mg** (Verity
  arm) against 1 g of gravity; gyro **3.8 dps** residual bias at rest. Correct.
- **Magnetometer scale.** The naive test *fails*: `|B|` median **1.077 G** against an Earth field of
  0.25–0.65 G. It is a **false positive** — raw magnitude is dominated by hard-iron offset. Fitting the
  locus (bias shifts the sphere's *centre*, not its *radius*) gives **radius 0.4483 G** against
  Asheville's ~0.48 G — **0.93×**, with a median fit residual of 0.0065 G. Scale is correct; the offset
  is `(+0.640, −0.197, +0.177) G`. This also independently re-confirms DEEP-AUDIT-2026-07-22's refutation
  of the "GYRO/MAG 8× mis-scale" claim. **Use the sphere fit, not `|B|`.**
- **O2Ring `[7]`=PI / `[11]`=motion mapping** (swapped once, 2026-07-18). Unfiltered the check *fails*
  (PI 89 % zero) — another false positive, from frames where the ring was off-finger. Restricted to rows
  the ring was actually reading: PI non-zero **100 %** of the time, median 2.40 %, 36 distinct values;
  motion **99.8 %** zero, max 4. Mapping is correct.
- **`archive_night` cannot mirror onto the boot disk.** Hypothesised that an unmounted dest would be
  silently `makedirs`-ed, doubling disk use and defeating the backup. Refuted: the caller guards on
  `os.path.isdir(dest)` and the comment names the exact hazard.
- **`plan_prune`'s "tonight is always protected"** is enforced by the caller, which passes
  `active_nights | {today}`. Verified, not just documented.

---

## 4. What shipped

| file | change |
|---|---|
| `capture-host/nightarchive.py` | §1.1/§1.3 `unarchived_nights(captures, dest)` — confirms the mirror, not the marker |
| `capture-host/diskguard.py` | §1.2 unreadable night is PROTECTED, not swept |
| `capture-host/capture.py` | §1.1 retention gated + held-state surfaced/logged/alerted; §2 config read hardened |
| `capture-host/webmon.py` | §2 atomic `_save()` — mkstemp + fsync + os.replace + dir fsync |
| `capture-host/tests/test_nightarchive.py` | 9 gate tests incl. vanished-mirror and absent-volume |
| `capture-host/tests/test_diskguard.py` | fail-open split into its two cases; one deliberate assertion change |
| `capture-host/tests/test_webmon_api.py` | 3 atomic-write tests, driven through `/api/remember` |
| `capture-host/tests/test_webmon_endpoints.py` | stale `open` patch retargeted to `yaml.safe_dump` |

**Mutation-checked.** §2's headline test was verified against a surgically reverted `_save`: with the old
truncating write it **fails** with `a failed write must not damage the existing config`; with the fix it
passes. A first attempt reached for the `_save` closure directly, got `None`, and silently proved
nothing — it was rewritten to drive the real endpoint. (Same failure mode as pass I's bounded-jitter
draft; two for two, so: **always mutation-check a new invariant.**)

---

## 5. Residue

1. **The backup volume is still not mounted.** The gate now protects the data, but nothing is being
   mirrored, and pruning is held — so free space only falls. Mount `/run/media/michal/data` (or repoint
   `archive.dest`) before the disk fills. This is now visible in `status.json` as `retention_held`.
2. **Not yet audited:** `polar_pmd` frame-decode internals (the *units* it produces are verified above,
   the framing/seam logic is not), `bonding.py`, `oxyii` decode beyond the live-frame mapping, and the
   remaining `webmon` endpoints.
3. Carried unchanged from pass I: the O2Ring link thrashing, and OxyDex discarding a whole row over an
   unreadable pulse rate (in-suite, needs the browser gate).

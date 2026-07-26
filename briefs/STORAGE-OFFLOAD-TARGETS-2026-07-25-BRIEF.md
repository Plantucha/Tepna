<!--
  STORAGE-OFFLOAD-TARGETS-2026-07-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-25 · **Created:** 2026-07-25 · **Builds on:** `VIGIL-HARDENING-II-2026-07-25-BRIEF.md` §1 (the retention gate this feeds)

# Storage card — where a night goes, and when

> **Scope:** out-of-suite (`capture-host/`). No Dex bundle, no `manifestHash`, no provenance impact.
> **Gate:** capture-host pytest **992 green at baseline → 1035 after** (+43, 0 regressions); Node lane
> 3899 green; `build --check` clean; `monitor.html` JS syntax-checked and every referenced element id
> verified present.
> **Why now:** the M900 the box is moving to has a small SSD, and the box writes ~350 MB/night.

---

## 0. The one-paragraph story

A **Storage** card in the sidebar (visible in every view) plus a Storage panel that configures **where
finished nights go and at what time**, persisted in `config.yaml` and honoured by the archive poller.
Seven protocols are offered, but they are **not equivalent**, and the card says so: iSCSI, NFS, NVMe-oF
and SMB are kernel mounts that a **root** process must establish, and Vigil runs unprivileged — so for
those it generates the exact systemd `.mount` unit to install once, then **verifies the mount is real**
before writing to it. rsync-over-SSH is implemented end-to-end because the daemon can actually do it.
No password field exists anywhere in the feature, by construction.

---

## 1. The privilege line — why the protocols are split

`capture.py` runs with **`CapEff: 0`**. That is measured, not assumed: on 2026-07-24 its own recovery
ladder's `hciconfig reset` returned exit 1 for exactly this reason. iSCSI, NFS, NVMe-oF and SMB are
kernel mounts requiring root or a pre-authorised unit. A card that offered a "Connect" button for them
would be promising something the daemon cannot do — and a green pill over work that never happened is
this suite's signature failure.

| kind | protocols | what Vigil does |
|---|---|---|
| **mount** | iSCSI · NFS · NVMe-oF · SMB · local | Stores the target, **generates the systemd `.mount` unit + the exact root commands**, then treats the mountpoint as the archive dest and verifies it |
| **transfer** | **rsync/SSH** (implemented) · WebDAV · FTP (declared, not implemented) | Runs the push itself, unprivileged, on the schedule |

WebDAV and FTP are offered in the catalogue but `push_night` returns an explicit *"not implemented —
configure it as a mount target, or use rsync"* rather than silently doing nothing. Declaring a protocol
the box cannot serve, and then failing loudly, is honest; a button that appears to work is not.

## 2. `ismount`, not `isdir` — the check the whole feature rests on

An **unmounted mountpoint is a present, empty, writable directory on the boot disk.** `os.path.isdir`
returns True for it, so a mirror "succeeds" and ~350 MB/night lands on the wrong filesystem while the
operator believes it is on the NAS — and the disk fills from the inside. `dest_status()` therefore uses
`os.path.ismount()` for every network mount kind, with `local` the deliberate exception (a plain
directory *is* the destination there, so `isdir` is correct for it).

This is the same distinction VIGIL-HARDENING-II §1.3 had to draw for the local mirror: *a copy having
been made is not a copy existing.* It feeds the retention gate directly — an unready target means
nothing is confirmed off-box, so nights are **held rather than pruned**.

## 3. Secrets never enter the box's config or the API

No password field exists, and `validate()` **rejects** one (`password`, `pass`, `passwd`, `secret`,
`token`, `key`, `psk`, `chap_secret`) with a message pointing at the alternative. Unknown keys are
refused too, rather than stored.

`config.yaml` is world-readable on the box and the monitor is LAN-reachable through Caddy, so a typed
SMB or FTP password would be at rest in plaintext in **both**. Authentication is by reference:
- **rsync** — an SSH private key **path** (`identity`), operator-installed, mode 600.
- **SMB** — a root-owned credentials file **path**, emitted into the generated unit as `credentials=`.

Vigil stores the path, never the secret, and never returns a secret over the API.

## 4. These values become argv — so they are validated like argv

`host` and `user` are pattern-matched and a **leading dash is rejected**: `-e/bin/sh` in the host slot
would be read by rsync as an **option**, not a destination. `rsync_argv` uses `create_subprocess_exec`
(no shell) and puts a bare `--` before the operands so a path can never be reinterpreted. Mount
`options` are restricted to `[A-Za-z0-9_,=./:@%-]` because they are interpolated into a generated unit
file, where a newline would append arbitrary `[Service]` directives. Paths must be absolute and may not
contain `..`.

## 5. When — the schedule

`after_settle` (today's behaviour: offload as soon as a night goes quiet) or `daily` with `at: "HH:MM"`
and a `window_min`. **Clock Contract:** `at` is **local civil time**, matched against the same naive
host clock the capture filenames use; there is deliberately no timezone field, because a second clock
in a different frame is exactly what the contract exists to prevent.

`due()` anchors on the **window opening**, not on "≥24 h since the last run" — the latter makes the
offload drift a little later every day, so a box that ran late yesterday would eventually miss its slot
entirely.

A daily window matters here beyond politeness: a 350 MB push over the LAN should not compete with three
live BLE streams at 03:00, and it should not run beside a sleeping person.

## 6. Confirmation, not optimism

`push_night` runs rsync, then a **second `--dry-run` pass**, and marks the night `.archived` **only if
that pass finds nothing left to transfer** — i.e. the remote genuinely matches. An unverified push
leaves the night unmarked, so it is retried next cycle and the retention gate keeps holding it. A
failing link stops the loop rather than hammering every night against it.

## 7. What shipped

| file | change |
|---|---|
| `capture-host/storage_targets.py` | **new** — protocol catalogue, validation, `ismount` readiness, unit generation, rsync push + verify, schedule |
| `capture-host/webmon.py` | `GET/POST /api/storage`, `POST /api/storage/test`; `/api/state` now carries `archive` |
| `capture-host/capture.py` | archive poller honours the schedule and drives transfer targets (`_archive_transfer`) |
| `capture-host/monitor.html` | sidebar **Storage** card + Storage view (protocol-aware fields, generated unit, test button) |
| `capture-host/tests/test_storage_targets.py` | **new** — 36 tests |
| `capture-host/tests/test_webmon_api.py` | 7 endpoint tests |

## 8. Residue

1. **WebDAV and FTP are declared, not implemented.** They fail loudly and point at rsync or a mount.
   Implementing them is a contained follow-up; rsync covers the TrueNAS case already.
2. **Not exercised against a real server.** Every gate here is unit-level plus an end-to-end run over
   the real aiohttp app. The first real push to `192.168.0.142` is the acceptance test, and
   `POST /api/storage/test` exists so that happens deliberately rather than at 03:00.
3. **`settings_schema` deliberately does not gain these keys.** That allowlist guards scalar capture
   behaviour; a storage target is a structured object with its own validator, and widening the scalar
   table to hold it would weaken both.

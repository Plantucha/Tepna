---
bump: minor
type: added
brief: CPAP-ACQ-P3-GAP-ACCOUNTING-2026-09-18-BRIEF.md
---

**INV11 — one acquisition owner per device.** Verified before building: **zero occurrences** of any owner
or lock construct in `capture-host/`. Two acquisitions of one device could start concurrently, and the
failure presented as **interleaved frames rather than as an error** — the worst shape, because nothing
reported it.

`AcquisitionOwners.acquire` claims a device for a session and **REFUSES** a second claim with
`AcquisitionOwned`, which carries the device, the holding session and since-when. Refused rather than
queued: a queued acquisition looks like it worked and arrives late, while a refusal is legible at the
moment it happens. The exception mirrors `InvalidTransition` in the same module, which carries both
states rather than raising a generic "bad state".

**Per-DEVICE, not per-adapter.** Per-adapter would collide with the one-systemd-instance-per-adapter
decision (2026-08-26): under that model two instances legitimately drive two adapters, and a per-adapter
lock says nothing about the device either is talking to.

⚠️ **Process-lifetime, and that is the correct scope rather than a shortcut.** The dangerous failure for a
lock on an unattended overnight box is one that **outlives the acquisition it guarded**: a durable on-disk
lock left by a crash converts a recoverable failure into a permanent one, and this daemon's recovery model
assumes a restart can resume. An in-memory registry cannot have that failure — **it dies with the process
that crashed**, which is exactly the release path a durable lock would need restart state to reproduce.

⚠️ **What it does not cover, stated rather than implied:** two processes each hold their own registry, so
this cannot refuse a second acquisition started by a different instance. Closing that needs a durable
lock, and a durable lock is only safe with a **liveness proof** — a pid plus that process's start time, so
a stale entry is detectable rather than permanent. Separate unit, separate risk.

Two release-path edges are tests rather than comments: **re-acquiring within one session is not a
conflict** (a retry inside a session is not a second owner, and raising there would fire the guard on the
recovery path it protects), and **a late release from a superseded session is a no-op, not an eviction**
(otherwise crash recovery can steal a device from the session that replaced it).

The W2 lesson is applied where it actually bites: the read accessor is named
`holder_in_this_process`, because `None` means "no holder this registry can see" and **not** "no holder".
A bare `holder()` would invite a caller to read an unknown as an absence — the `int(summary.get(k) or 0)`
shape in different clothing — and a test asserts the unqualified name does not exist.

Plant-verified: replacing the raise with silent coexistence reds the refusal test.

Gate: `capture-host/check.sh` all green — 7306 passed, coverage 100.00 %.

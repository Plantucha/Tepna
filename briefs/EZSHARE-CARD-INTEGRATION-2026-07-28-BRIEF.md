<!--
  EZSHARE-CARD-INTEGRATION-2026-07-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living · last-verified 2026-07-28) · **Created:** 2026-07-28 · **Subject:** the ez Share Wi-Fi SD card in a ResMed AirSense · **Implements:** `capture-host/cpap_harvest.py`

# Harvesting a CPAP card over an access-point SD adapter — what actually bites

Everything here was measured on a real ResMed AirSense with a genuine ez Share card, on a Linux box
running the harvest as a hardened systemd service. Nothing is from a datasheet. Where a number appears
it was read off the wire or the filesystem on **2026-07-28**, and every item marked ⚠ cost real debugging
time and, in two cases, lost data.

If you are building the same thing — a daemon that periodically pulls therapy files off a Wi-Fi SD card
— read §1, §2 and §5 before writing any code. They are the three things that are not obvious and that no
amount of careful reasoning will give you.

---

## 1 · ⚠ THE LISTING CEILS. This is the single most expensive fact in the document.

The card serves an HTML directory listing with a human-readable size column:

```
   2026- 7-27   21:29:42        104KB  <a href="download?file=…SA2.edf"> 20260727_212942_SA2.edf</a>
```

**That `104KB` is `ceil(bytes / 1024)`, not a rounded value.** The real file is **105 810 bytes =
103.33 KB**. Measured across ten files, `listed == ceil(bytes/1024)` in all ten:

| listed | bytes | true KB | ceil |
|---|---|---|---|
| 1 KB | 832 | 0.81 | 1 |
| 2 KB | 1 344 | 1.31 | 2 |
| 204 KB | 208 776 | 203.88 | 204 |
| 91 KB | 92 984 | 90.80 | 91 |
| 2229 KB | 2 281 784 | 2228.30 | 2229 |
| 25 KB | 25 032 | 24.45 | 25 |

**Why it matters.** The obvious completeness test — *"did I receive roughly what the listing promised?"*
— is usually written as a symmetric tolerance: `|received − printed| ≤ half the last displayed digit`.
That is the correct model for a value that was **rounded**. Under **ceil** a complete file may be up to a
whole quantum *smaller* than printed and can never be larger, so a symmetric window rejects **every file
whose fractional KB part is below 0.5** — approximately half of them, forever.

We shipped that bug. It produced **487 `.part` files and 246 MB** of byte-perfect downloads that were
rejected as truncated, re-fetched on every run, and re-rejected. Five consecutive fetches of the file
that "kept truncating" returned 105 810 bytes every time. Nothing was ever flaky.

**What to do instead:**

- **Judge completeness against `Content-Length`.** The card sends it and it is exact. When the server has
  declared the length there is no rounding model to get wrong. One byte short is short.
- If you must use the listing (e.g. a skip-if-present check that runs *before* downloading), make the
  window **asymmetric**: `(P − q, P]`. The asymmetry is the safety property — a symmetric `P ± q` opens a
  band *above* P where a corrupt file passes.
- Accept the residual blind spot honestly: with only the listing, a file up to one quantum small is
  **indistinguishable** from complete. That is information-theoretic; the string does not carry the
  precision. It is exactly why `Content-Length` must be primary.

## 2 · What the card actually supports (probe results, not assumptions)

```
HTTP/1.1 200 OK
Content-Length: 105810      ← exact, always present in our sample
Accept-Ranges: bytes        ← and a Range request really does return 206
```

- **`Content-Length` is present and exact.** Use it.
- **Range/resume works.** `curl -r 100000-` returned `206` with exactly the remaining 5 810 bytes. We did
  not end up needing resume (see §1 — the truncations were not real), but it is available if your card
  genuinely drops mid-file.
- **Throughput: 1.65 MB/s** measured on a 2.6 MB file (2 599 890 bytes in 1.58 s). The data is never the
  bottleneck.
- **Listing traversal is cheap**: root 0.0 s, the `DATALOG` index with 199 night directories 0.2 s, a
  single night ~0.0 s.
- The listing is **not** a standard index — it is HTML with `<a href="download?file=…">` links and a
  vendor size column. Parse it with an explicit regex and an ignore-list (`JOURNAL.JNL`, `ezshare.cfg`,
  `System Volume Information`), and expect `[KMG]?B` units in the size column.

**Volume, for planning:** a night is **2.9–4.7 MB** across 5–10 files, dominated by `BRP.edf` (2.6 MB of
2.9 MB — the high-resolution flow/pressure waveform). A 197-night archive is **~530 MB**. The steady-state
incremental pull is one night, so skip-if-present is what makes this cheap, not bandwidth.

**Directory convention:** files are foldered by **session start date** (`DATALOG/20260727/…` for a night
that began 07-27 21:29 and ended the following morning). The machine creates tomorrow's directory
*empty* before writing to it, so an empty newest directory is normal and not a missing night.

## 3 · Associating to it from Linux, and what privileges you actually need

The card is an access point: SSID `ez Share`, WPA-PSK, default key `88888888`, and it serves at
**`192.168.4.1`** with your client on `192.168.4.2/24`.

The whole privileged surface is **three binaries**, and on a stock box they are the only sudoers entries
you need:

```
NOPASSWD: /usr/sbin/ip, /usr/sbin/wpa_supplicant, /usr/sbin/wpa_cli
```

The sequence:

```
ip link set <iface> up
wpa_supplicant -B -i <iface> -c <conf with ctrl_interface=DIR>
  …wait for association…
ip addr add 192.168.4.2/24 dev <iface>      # address only — NEVER a route (see §4)
  …plain HTTP GETs…
ip addr flush dev <iface> ; ip link set <iface> down
```

**The download itself needs no privilege at all.** It is an unauthenticated HTTP GET. Every root
requirement in the design exists solely to join the AP — which is why §6's station-mode alternative
removes all of it.

### ⚠ 3a · The wpa_supplicant control directory must be writable BY THE SERVICE

Two traps, both of which we shipped:

1. **Do not use `/run/…` and create it with `sudo mkdir`.** That needs a sudoers entry beyond the three
   above. Ours was missing, the directory never existed, `wpa_supplicant -B` could not create its control
   socket, exited 255, and the failure was reported as *"the Wi-Fi profile would not come up"*. The
   privilege was never necessary: **wpa_supplicant runs as root and can write into any directory that
   exists — the directory itself does not have to be root-owned.**
2. **Do not verify your fix from an SSH shell.** We did, using `/tmp`, and it worked — then failed on the
   box with `[Errno 30] Read-only file system`, because the service runs under `ProtectSystem=strict`
   where the whole hierarchy is read-only except an explicit `ReadWritePaths` list. **An interactive
   shell is not the sandbox that constrains your daemon.** Probe for a writable directory from inside the
   service instead of choosing one: `$RUNTIME_DIRECTORY` if systemd provides it, else a path under your
   own data root, else `/tmp`.

### ⚠ 3b · Never share the system supplicant's control directory

`/run/wpa_supplicant` belongs to the packaged `wpa_supplicant.service`, which is active on a stock
Ubuntu box. Putting your `ctrl_interface` there has two consequences, the second serious:

- your `wpa_supplicant -B` exits 255 the moment it tries to own a socket in that directory;
- a bare `wpa_cli -i <iface> terminate` resolves through that shared directory and **kills the system
  supplicant**. On a wired box that is invisible. On a Wi-Fi-uplinked box your CPAP teardown takes the
  network down with it.

Use a private directory and pin **every** `wpa_cli` call to it with `-p <dir>`.

### ⚠ 3c · `wpa_cli` cannot run under a hardened unit — confirm association from `/sys` instead

`wpa_cli` creates its **own client socket under `/tmp`**. Under `ProtectSystem=strict` that is read-only,
so every status poll fails with `Failed to connect to non-global ctrl_ifname: … Read-only file system` —
**even when the supplicant is up, associated, and its sockets exist.** We spent a day watching the
harvest report *"did not associate within 45 s"* about a radio that had associated in four seconds.

`/sys/class/net/<iface>/carrier` is the same fact with no socket and no privilege:

| state | `carrier` | `wpa_state` |
|---|---|---|
| link down | unreadable (EINVAL) | — |
| up, not associated | `0` | `SCANNING` |
| **associated** | **`1`** | `COMPLETED` |

Read `carrier` first; fall back to `wpa_cli` only when it is unreadable (a driver that exposes neither
`carrier` nor `operstate`), and **never** to override a definite `/sys` answer. Treat a *down* link as a
definite "not associated" rather than "unknown" — otherwise you route straight back into the fallback
that cannot run.

If you would rather keep `wpa_cli`, `PrivateTmp=yes` on the unit fixes it and **increases** isolation.
Either is fine; the `/sys` route needs no unit change at all.

### ⚠ 3d · A non-zero `wpa_supplicant -B` is not a failed association

It exits non-zero when one is **already running** on the interface (`nl80211: deinit ifname=…`), and one
often is, because the only thing that reaps it is the `wpa_cli terminate` that §3c just showed you cannot
run. An inherited supplicant associates perfectly well. Log the non-zero result and **fall through to the
association poll** — it is bounded, so the worst case is unchanged, while the common case stops reporting
a phantom failure.

## 4 · ⚠ The card is a routing dead end. Guard the default route.

The card offers DHCP and will happily become your default route. It routes **nowhere** — no internet, no
LAN, no SSH back to your box. On a headless recorder that is an outage that lasts until someone walks
over to it.

- Assign the address with `ip addr add`, never a DHCP client, and **never add a route**.
- Read the default-route device **before** associating, hand it to the association routine as a guard, and
  re-check after. If it moved, tear the association down immediately and skip the run. A day of CPAP
  files is never worth making the box unreachable.
- If the interface you are about to borrow **is** the one carrying the default route — i.e. the box has no
  Ethernet — **refuse at install time**. Do not attempt it. Those deployments need a second radio or §6.

## 5 · ⚠ Do not harvest while you are recording something else

The card is 2.4 GHz. On our box, running a transfer while BLE sensors were streaming cost **5–7 dB** of
signal and **17 reconnects** across three sensors.

- Gate the harvest on "nothing is streaming", and treat *connected + worn + not charging* as streaming.
- Schedule it in a **bounded window** (we use 13:00–15:00), not with a `now.hour >= at_hour` floor. A
  floor makes every restart after that hour consider itself due — ours re-armed a 13:00 job at 19:25 and
  then retried every 60 s, held back only by the streaming interlock, so it would have fired the moment
  the sensors came off at bedtime. That is precisely the contention the schedule exists to avoid.
- Do not schedule it for the morning: measured on the real machine, **6 of 14 nights were still being
  written after 09:00**.

## 6 · The alternative that removes all of this: station mode

An ez Share card does not have to be an access point. In **station mode** it joins your existing network
as an ordinary client, and then:

- no association, no `wpa_supplicant`, no `wpa_cli`, no `ip` — **no privileged operation of any kind**;
- no default-route hazard, because you never touch your own routing;
- no 2.4 GHz contention with your own radios beyond ordinary network traffic;
- the harvest becomes plain HTTP against a LAN address.

If your deployment allows it, this is strictly better and you should stop reading at §2. The design worth
shipping supports **both**: probe the card's base URL first with one short unretried GET, and only fall
into the association path if it does not answer. The same build then serves both deployments and the
privileged branch is simply never entered on the sudo-free one.

## 7 · File-integrity conventions that turned out to matter

- **Write to `<name>.part`, then rename.** A crash mid-write must never leave a truncated file that a
  later skip-if-present accepts as complete.
- **Do not rename before validating.** Ours checked completeness *after* `os.replace`, so a truncated body
  was promoted to its real name and skip-if-present then saw a plausible file and never came back for it.
- **A truncated body is not a "fetched file".** Do not count it in your success stats.
- Make the skip test and the completeness test **share one definition of complete**. Ours drifted apart —
  the skip test allowed 2 %, the truncation detector flagged only >5 % — leaving a 0–5 % band invisible to
  both, where a truncated file was accepted, reported OK, and skipped forever.
- **A zero-length session is normal — do not read it as truncation.** The machine opens a session on
  mask-on and closes it on mask-off, so a night routinely holds a 25 KB false start beside the real
  2.6 MB session. 24 of our 1 244 EDFs carry `nrec = 0` and are **exactly** their own header
  (`256 + 256*ns` bytes, nothing after it) on 6 nights that each also hold a full session. Truncation
  does not land on the header boundary 24 times out of 24. If you validate structurally, allow it.
- If you inherit a pile of `.part` files, check before deleting: ours were **byte-identical duplicates of
  files already correctly in place** (485 of them, verified with `cmp`). Reap only on an exact byte match;
  a `.part` that *differs* may be the only copy of an interrupted download.

## 8 · Ordering the debugging, if it is already broken

The failures in this document all present identically — *"the harvest did not pull anything"* — and the
log line you get names the wrong cause more often than the right one. Check in this order:

1. Is the interface **up**, and does it stay up? (`ip -br link`, then again 5 s later.) Something else may
   be managing it, or your own teardown may have downed it and you are reading the aftermath.
2. Does `wpa_supplicant` **start**? Look for its control sockets appearing in your chosen directory.
3. Is the radio **associated**? Read `carrier`, not `wpa_cli` — see §3c.
4. Does the card **answer**? `curl http://192.168.4.1/dir?dir=A:`.
5. Only then look at the transfer, and when you do, **measure it**: fetch the same file five times and
   compare byte counts before believing anything about truncation.

We inverted steps 1 and 5 and lost an afternoon to a networkd theory that was wrong — the link was down
because our *own* teardown had downed it, not because anything was fighting us.

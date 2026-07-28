<!--
  CPAP-AUTOHARVEST-2026-07-26-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-28 · **Created:** 2026-07-26 · **Followed-by:** `CPAP-AUTOHARVEST-FOLLOWUPS-2026-07-28-BRIEF.md` · **Reference:** `EZSHARE-CARD-INTEGRATION-2026-07-28-BRIEF.md`

# CPAP auto-harvest — pulling ResMed `DATALOG/` off a Wi-Fi SD adapter, nightly, unattended

> **Scope:** out-of-suite (`capture-host/`). CPAP joins Tepna as **files**, not a captured BLE stream
> (`how-to-collect/cpap-edf.md`, `CPAPDEX-PHASE9-FOLLOWUPS §2`) — so this adds a **file harvester**, not a
> new `capture.py` runner. No Dex bundle / `manifestHash` / provenance impact.
> **What this executes:** the promise already made in `how-to-collect/cpap-edf.md` §Capture B — *"put an
> ezShare Wi-Fi microSD adapter in the CPAP; the tepna box then auto-pulls `DATALOG/` over Wi-Fi each
> morning into `captures/<night>/`"* — and `CAPTURE-HOST-2026-06-29-BRIEF §3`, which lists CPAP as the
> one signal with **no** capture automation. This closes that gap.
> **Method:** protocol confirmed by reading a working implementation's source
> (`JCOvergaar/CPAP-data-from-EZShare-SD`, `ezshare_resmed.py`), cross-checked against five other
> independent projects and a reverse-engineering writeup. Nothing below is inferred from a product page.
> **Hardware in hand:** a Zyyini USB/Wi-Fi microSD adapter — an **ez Share-class** device (identified by
> the `88888888` default PSK and AP/station switching). §1.4 records why that identification matters and
> where it is **not yet verified**.

---

## 0. The one-paragraph story

The AirSense's own Wi-Fi uploads **compliance summaries only** — the flow waveform CPAPDex needs exists
solely on the SD card, which today means a manual card swap. An ez Share-class Wi-Fi SD adapter turns that
card into an HTTP file server, and six independent open-source projects already automate exactly this pull
for ResMed machines. The protocol is trivial (one HTML listing endpoint, one download endpoint). **The hard
parts are not the protocol** — they are (1) the adapter is 2.4 GHz and Vigil's dominant documented risk is
2.4 GHz contention against four BLE sensor links, (2) the card is almost certainly **AP-only**, which costs
the box its Wi-Fi radio for the duration of a pull, and (3) the specific unit purchased has a **1.9/5 star
rating over 19 reviews**, so the first deliverable is a go/no-go bench test, not an integration.

---

## 1. The adapter

### 1.1 What it actually is

ez Share is a family of Wi-Fi SD/microSD adapters that expose the card over HTTP. The product listing's
tells — default password `88888888`, AP/station mode switching, SSID/channel/IP settings — match the ez
Share firmware exactly. This matters because **ez Share is the one Wi-Fi SD card the CPAP community has
standardised on**: OSCAR ships native ez Share import support, and every project in §2 targets it.

### 1.2 The protocol (confirmed from working source, not documentation)

Neither the `iitggithub` nor `hms-homelab` README documents the API. `ezshare_resmed.py` does, by using it:

| Purpose | Request | Verified |
|---|---|---|
| Directory listing | `GET http://192.168.4.1/dir?dir=A:` → **HTML** | ✅ on our card |
| Subdirectory | same endpoint, URL-encoded backslash: `dir?dir=A:%5CDATALOG%5C20260725` | ✅ |
| File download | follow the listing's `href`, resolved with `urljoin` | ✅ |
| Association | SSID `ez Share`, PSK `88888888`, card at `192.168.4.1`, DHCP serves `192.168.4.0/24` | ✅ |

**Our firmware uses `download?file=<8.3path>`, NOT the `fname=`/`fdir=`/`ftype=` triplet** in Nelson's
2021 notes — e.g. `download?file=DATALOG%5C20260725%5C202607~4.EDF`. Do not code against the older form.

**Do not construct download URLs yourself.** The listing's `href` carries the correct 8.3 short name
(`Identification.json` is served as `IDENTI~2.JSO`), so hand-building requires reproducing FAT 8.3
truncation — and on other firmware a path-traversal trick besides. Parsing the listing sidesteps all of it.

**⚠️ Parser trap — metadata PRECEDES the anchor.** A row is:

```
   2026- 7-26    3:50:50           1KB  <a href="…202607~1.EDF"> 20260725_225050_CSL.edf</a>
   └──── mtime ────────┘        └size┘       └──── href ────┘     └──── real filename ────┘
```

The naive "label + following text" pairing yields every file's metadata **shifted by one row**, which
looks plausible and is entirely wrong — it cost a bad throughput measurement during Phase 0. Note also
the embedded spaces in dates/times (`2026- 7-26`, `3:50:50`) and a trailing `Total Entries: N Total
Size: NKB` footer that must not be parsed as a file. A working regex is in
`capture-host/deploy/ezparse.py` (Phase 1).

Client settings that working implementations converge on: **5 s timeout** on the listing, **5 retries with
0.25 backoff factor**, a deliberate inter-request `connection_delay`, and a **`day_count` sync window**
(default 5) so a pull is bounded rather than re-walking the whole card.

### 1.3 Two file-level gotchas that silently break OSCAR/CPAPDex

1. **`STR.EDF` must be written as `STR.edf`.** The card serves the 8.3 uppercase name; OSCAR expects
   lowercase. `ezshare_resmed.py` special-cases exactly this (`if link_text == 'STR.EDF'`). On a
   case-sensitive Linux filesystem, getting this wrong yields a night with per-session EDFs and **no
   summary** — which looks like partial data, not a bug.
2. **Ignore list:** `JOURNAL.JNL`, `ezshare.cfg`, `System Volume Information`. The first is device journal
   noise, the second is the adapter's own config (do not archive credentials into `captures/`), the third
   is Windows filesystem cruft.

### 1.4 ⚠️ The unverified claim that decides the architecture

Nelson's reverse-engineering notes state ez Share is **access-point only and cannot join an existing
Wi-Fi network**. The purchased product's listing explicitly advertises **station mode**. Both cannot be
true for the same firmware. This is **not a detail** — it selects the entire network design:

- **If station mode works:** the card joins the LAN, gets a DHCP address, and the box pulls over ethernet
  with its Wi-Fi radio untouched. **No 2.4 GHz contention with BLE.** This is strictly better.
- **If AP-only (assume this until proven otherwise):** the box must associate its own Wi-Fi radio to the
  card's AP for the duration of the pull. §3 is written for this case.

**Resolve this on the bench before writing any integration code** (§5, Phase 0).

---

## 2. Prior art — six projects, none directly reusable, all worth reading

| Project | Stack | What to take from it |
|---|---|---|
| [`JCOvergaar/CPAP-data-from-EZShare-SD`](https://github.com/JCOvergaar/CPAP-data-from-EZShare-SD) | Python, 36 KB | **The reference.** Real endpoints, retry/backoff, `day_count` window, `STR.edf` casing, ignore list. Read `ezshare_resmed.py` before writing ours. |
| [`iitggithub/ezshare_cpap`](https://github.com/iitggithub/ezshare_cpap) | bash, Linux/macOS | Closest platform match. Pulls `DATALOG`, `SETTINGS`, `Identification.json`, `JOURNAL.JNL`. Documents a **dedicated-adapter mode** — a second Wi-Fi NIC bound to the card so the primary network is never disturbed (§3.3). |
| [`hms-homelab/hms-cpap`](https://github.com/hms-homelab/hms-cpap) | Home Assistant service | The only one addressing **write-conflict timing**: ResMed grows `BRP/PLD/SAD/EVE` every 60 s during therapy, so it polls at **65 s** for a 5 s margin, and notes ResMed appends atomically — partial reads yield valid subsets, not corruption. |
| [`dwbrott/ezfetch`](https://github.com/dwbrott/ezfetch) | PowerShell | Windows only; reference for endpoint confirmation. |
| [`adrianRfeeger/ezShareCPAP`](https://github.com/adrianRfeeger/ezShareCPAP) | macOS GUI | UX reference only. |
| [`amanuense/CPAP_data_uploader`](https://github.com/amanuense/CPAP_data_uploader) | Python | **Different hardware** — targets *SD WIFI PRO* (ESP32-based), not ez Share. Relevant only as a §6 fallback. |

**Also:** OSCAR has built-in ez Share support. Useful as an independent oracle — if OSCAR can read a night
the harvester pulled, the pull is byte-correct.

**Why none is dropped in as-is:** every one of them targets `~/Documents/CPAP_Data` or SleepHQ upload.
Tepna's §7 integration contract requires emitting the **native ResMed layout** into `captures/<night>/` so
files route with **no new parser branch**, plus Clock-Contract-correct naming. That is a thin wrapper, not
a fork — but it is ours to write.

---

## 3. When and how often to pull — the section that is Tepna-specific

Every upstream project answers this wrong *for this box*. `hms-cpap` polls every 65 s for live dashboards;
`iitggithub` suggests every 10–15 min. **Both are actively harmful here.**

### 3.1 The constraint nobody upstream has

`CAPTURE-HOST §5` names 2.4 GHz contention as a first-order reliability risk, and
`VIGIL-OVERNIGHT-FINDINGS` cost ~110 min of a night to a radio problem. Vigil holds **four concurrent BLE
links** through the night. The ez Share adapter is **2.4 GHz-only**, and under §1.4's likely AP-only case
the box's own Wi-Fi radio must transmit on 2.4 GHz to talk to it.

**Polling the CPAP during capture would put a Wi-Fi transmitter next to the bed, in-band, competing with
the exact links whose RSSI margin is already the documented failure mode.**

### 3.2 The rule

> **Pull once daily at 13:00, only while no sensor is streaming AND the CPAP is not in use. Mirror
> everything on the card. Never poll during a session.**

**DECIDED 2026-07-26 (owner).** No on-the-fly / incremental-during-therapy pulling of any kind. The
upstream 65 s and 15 min cadences are explicitly rejected for this box.

**⚠️ 09:00 was the owner's first choice and Phase 0 measurement overturned it — 13:00 replaces it.**
The machine does not finish writing a night when therapy ends. Last-write times measured across the 14
most recent nights on the real card:

| | |
|---|---|
| earliest last-write | 08:35 |
| **median** | **08:56** |
| latest | **12:02** |
| nights still writing after 09:00 | **6 of 14** |

09:00 sits almost exactly on the *median* of that distribution — close to a coin flip per night. And the
files that land late are the large ones: on `20260725`, `CSL`/`EVE` were written at 03:50/06:42 but
`PLD`, `SA2` and **`BRP` (2229 KB — the flow waveform CPAPDex exists to read)** were all written at
**10:10**. A 09:00 pull that night would have captured two small files and missed the entire waveform,
and — worse — would have looked like a *successful* pull. **13:00 clears the latest observed write by
~1 h**; 14:00 if more margin is wanted. Re-measure if therapy habits change.

- **Schedule:** fixed **13:00 daily**, systemd timer. Not event-triggered off night completion — a wall
  clock well clear of both therapy and capture is simpler to reason about and to audit after the fact.
- **Two hard interlocks, both must pass**, else skip this run and retry tomorrow (never force):
  1. **No sensor streaming** — refuse if any device reads `connected` in `/api/state`, mirroring the
     existing `_OXYII_PAUSE` discipline (*"only pulls while the ring is OFF the finger — never interrupts
     a live capture"*, `config.yaml`).
  2. **CPAP not in use** — the machine must not be mid-therapy. §3.4's power question determines how this
     is detected; if the slot is only live while the blower runs, these two conditions conflict and the
     design must change (Phase 0 resolves it).
- **Scope: full mirror, not a window.** Pull *all* stored data — the card holds ~30 sessions of detailed
  + high-resolution flow and ~365 of summary. So **no `start_from` / `day_count`** as upstream uses;
  instead skip-if-present (name + size) makes the steady state cheap while the first run backfills
  everything the card still holds. This also self-heals a missed day with no special case.
- **Why daily is sufficient:** CPAPDex consumes whole nights. There is no live CPAP view, no `cpap` BLE
  stream, and no fusion consumer that benefits from intra-night freshness. The fast cadences buy nothing
  and cost link margin.

### 3.3 If the 2.4 GHz cost is still unacceptable

Take `iitggithub`'s **dedicated-adapter** approach: a **second, cheap USB Wi-Fi NIC** bound solely to the
ez Share AP, physically sited away from the bed, leaving the primary radio and the BLE path alone. This is
also the only way to pull *during* a session should that ever be wanted.

### 3.4 Does the card even stay powered?

The adapter draws power from the CPAP's SD slot. **Whether the AirSense keeps that slot powered in standby
is untested and determines whether a daytime pull is possible at all.** If the slot dies with the blower,
the pull window is only while the machine is running — which collides head-on with §3.2. **Bench-test this
first** (§5, Phase 0); it can invalidate the whole schedule.

---

## 4. How it lands in Tepna (the §7 contract)

1. **Emit the native ResMed layout.** Mirror `DATALOG/YYYYMMDD/*.edf` plus `STR.edf` verbatim into
   `captures/<night>/`. No flattening, no renaming beyond the `STR.EDF` → `STR.edf` fix. The `resmed-edf`
   adapter already reads this; there must be **no new parser branch**.
2. **Clock Contract.** EDF headers carry their own start datetime, parsed by explicit regex into floating
   `tMs` — the harvester **must not** stamp files with `now()` or infer a date from the pull time. The
   directory name (`YYYYMMDD`) is the device's own, and is authoritative.
3. **Never fabricate a gap-filler.** A file that fails to download is **absent**, and must surface as
   absent. Same rule as a dropped BLE packet.
4. **Idempotent + incremental.** Skip files already present with matching size; bound the walk with a
   `day_count`-style window. A re-run must never duplicate or corrupt an archived night.
5. **Failure is loud.** A pull that fetches zero files on a day the machine ran is an **alert**, not a
   silent no-op — this is the `writers.IDENTITY_FIELDS` lesson: *"remembered ✓, then silently never
   captured."*

---

## 5. Phased plan

**Phase 0 — bench go/no-go. ✅ EXECUTED 2026-07-26 from `rig-x870`. VERDICT: GO.**

| # | Test | Result |
|---|---|---|
| a | `GET /dir?dir=A:` returns a listing | ✅ HTTP 200, ResMed card root (`DATALOG`, `SETTINGS`, `STR.EDF`, `Identification.json`, plus all three ignore-list entries) |
| b | Station mode works (§1.4) | ⚠️ **Undetermined — and now moot.** The card answers every path with a 219-byte catch-all `200 Success`, so it cannot be probed over HTTP; `ezshare.cfg` serves as 0 bytes. Needs the vendor UI. **Moot because** §3.2's 13:00 idle-window schedule means AP mode costs nothing: a ~20 s transfer with zero BLE links up has no one to contend with. Pursue only if a pull is ever wanted mid-capture. |
| c | Slot stays powered in standby (§3.4) | ✅ **YES.** The card served HTTP throughout a mid-afternoon session with the machine in standby. The daytime pull window is real; §3.2 and §3.4 do not conflict. |
| d | Full night pulls and parses | ✅ **Verified against CPAPDex itself**, which is a stronger oracle than OSCAR — it is the actual consumer. Night `20260725` pulled as a 10-file card image (2.6 MB, 44 s, **zero size mismatches**) and every file round-tripped through `cpapdex-edf.js` `readEDF()`: **0 problems / 6 files**, no truncation, `recordsRead === numRecords` throughout. Parser self-test 14/14 first. OSCAR remains available as an independent check but is no longer on the critical path. |

**What the pulled night actually contains** (via CPAPDex, night `20260725`):

| File | Records | Signals |
|---|---|---|
| `BRP.edf` | 380 × 60 s = **6.33 h** | `Flow.40ms`, `Press.40ms` — 40 ms ⇒ **25 Hz**, matching `how-to-collect/cpap-edf.md` |
| `PLD.edf` | 380 | `MaskPress.2s`, `Press.2s`, `EprPress.2s`, `Leak.2s`, `RespRate.2s`, `TidVol.2s`, `MinVent.2s`, `Snore.2s` +2 |
| `SA2.edf` | 380 | **`Pulse.1s`, `SpO2.1s`** — see below |
| `EVE.edf` | 9 | device-scored events |
| `CSL.edf` | 1 | summary |
| `STR.edf` | 377 × 86400 s | 78 signals — **377 days** of daily summary |

**🔎 Unplanned finding — the CPAP is recording its own oximetry.** `SA2.edf` carries `SpO2.1s` and
`Pulse.1s` at 1 Hz for the full night. Tepna currently sources SpO₂ from the **O2Ring** (OxyDex) alone,
and `VIGIL-DEEP-ANALYSIS` records the ring spending **17 % of nights below −85 dBm** with the resulting
dropouts. This is a **second, wired, drop-free SpO₂ source over the identical interval** — a real
cross-validation opportunity for OxyDex, and a gap-filler for exactly the nights the ring loses. Out of
scope for this brief; worth its own.

**Clock Contract — verified, not assumed.** CPAPDex derived
`{"t0Ms":1785019858000,"dateAnchorMs":1784937600000,"offsetMin":null}` from the `BRP` header. **`offsetMin`
is `null`** — the instant is floating and viewer-timezone-independent, exactly as `CLAUDE.md` §🔒 requires.
The harvester copies bytes and never touches this.

**Measured, on the real card:**

- **Machine:** `AirSense11AutoSet`, serial `23221590541` (USA) — resolves open question §7.4; the AirSense
  11 is confirmed, matching `how-to-collect/cpap-edf.md`.
- **197 night folders**, `20260111` → `20260726`. The oldest still carries **full detail** (2613 KB), so
  ResMed's documented "30 sessions of detailed data" limit has **not** rotated this card — a full mirror
  really does recover ~6.5 months.
- **~2.5 MB per night**, normally **5 files** (`CSL`, `EVE`, `PLD`, `SA2`, `BRP`). **Note `SA2`, not
  `SAD`** as some upstream projects assume.
- **⚠️ Nights are not always 5 files.** `20260723`, `20260716`, `20260713` each have **10** — two sessions
  in one night. **Never assume a fixed file count**; walk the listing.
- **Throughput 130 KB/s** sustained on the 2229 KB `BRP.edf`. → first backfill ~492 MB ≈ **65 min**;
  steady state one night ≈ **20 s**. Both fit the 13:00 window comfortably.
  *(Beware micro-benchmarks: a 105 KB `STR.EDF` clocked 620 KB/s and a 91 KB file 24 KB/s. Size the job
  from a large-file measurement.)*
- **The 1.9/5 rating did not materialise as a fault.** The unit works. Keep the rating in mind for
  *durability*, not function — plan for replacement, not for debugging a dud.

**Phase 1 — standalone puller.** `capture-host/cpap_harvest.py`: associate → list → walk → download →
verify → emit into `captures/<night>/`. CLI-only, no scheduling, no capture coupling. Port the endpoint
handling and ignore list from `ezshare_resmed.py`; do not re-derive them.

**Phase 2 — interlock + schedule.** Wire the `/api/state` idle check (§3.2), the completed-night trigger,
and the systemd timer. Test that it **refuses** to run during a live session.

**Phase 3 — observability.** Surface last-pull time, file count, and failures in the Vigil monitor
alongside the BLE devices. Alert on a zero-file pull.

**Phase 4 — docs.** Update `how-to-collect/cpap-edf.md` §Capture B from *promise* to *procedure*.

---

## 6. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **2.4 GHz contention degrades BLE capture** | **High** | §3.2 daily-idle-only rule; §3.3 dedicated NIC |
| Slot unpowered in standby (§3.4) | **High** — invalidates the schedule | Phase 0 test |
| AP-only forces radio switching (§1.4) | Medium | Phase 0 test; §3.3 fallback |
| DOA / flaky unit (1.9★, 19 reviews) | Medium | Phase 0 gate before any integration |
| `STR.EDF` casing silently drops the summary | Medium | Explicit rename + assert `STR.edf` exists per night |
| Card firmware path-traversal vuln, default PSK, plaintext HTTP | Low here | AP is isolated by nature; never archive `ezshare.cfg`; do not bridge the card's AP to the LAN |
| Adapter wears/corrupts the card | Low | Card is the device's own store; `captures/` is the durable copy — mirror, never move |

---

## 7. Open questions (human calls)

1. **Station mode — real or listing copy?** (§1.4) Decides the network design.
2. **Standby power?** (§3.4) Decides whether a daytime pull exists.
3. **Accept a second Wi-Fi NIC** (§3.3) to remove 2.4 GHz contention entirely, or accept a bounded daily
   pull on the primary radio?
4. **AirSense 10 or 11?** `how-to-collect/cpap-edf.md` targets the 11; the 11's `JOURNAL.JNL` handling
   differs and `iitggithub` flags it as provisional.

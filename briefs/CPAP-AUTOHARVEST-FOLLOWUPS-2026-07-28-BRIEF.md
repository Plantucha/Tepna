<!--
  CPAP-AUTOHARVEST-FOLLOWUPS-2026-07-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-28 · **Follows:** `CPAP-AUTOHARVEST-2026-07-26-BRIEF.md` · **Reference:** `EZSHARE-CARD-INTEGRATION-2026-07-28-BRIEF.md` · **Also carries:** the four unclosed `DEEP-AUDIT-III` punch-list items (§4)

# What executing CPAP-AUTOHARVEST surfaced — and the work it does not close

The parent is DONE: all four phases shipped, the harvest runs unattended at 13:00, and the box holds
197 nights / 529 MB with a clean steady state. This brief is the residue — what the execution taught,
what it deliberately left alone, and the items from other briefs that would otherwise live only in a
chat transcript.

---

## 1 · What execution taught (the part worth keeping)

### 1.1 The completeness model, not the transport, was the bug

Five days were spent treating a **rounding assumption** as a flaky card. Every symptom pointed at the
transport — files "truncating", `.part` residue accumulating, the same file failing repeatedly — and
every one of them was the listing's `ceil(bytes/1024)` meeting a symmetric tolerance. Five consecutive
fetches of the "failing" file returned identical bytes. **Measure before believing a transport story**:
one loop fetching the same file five times and comparing lengths would have ended it on day one.

Written up in full as `EZSHARE-CARD-INTEGRATION-2026-07-28-BRIEF.md`, which is the reusable artifact.

### 1.2 A promise in a docstring is not a behaviour

`cpap_poller`'s docstring said *"Zero files on a day the machine ran is an ALERT, not a silent no-op —
the `writers.IDENTITY_FIELDS` lesson"*. The code logged a warning, and the status it published was
`ok`, so the monitor painted a green `✓ 0 files` over a harvest that had found nothing. The lesson was
correctly identified, written down, and then not implemented — and the write-up is what made it look
handled. Fixed 2026-07-28 (`barren` state + webhook). **Grep the daemon for other docstrings that
describe a guarantee, and check each one has a test.**

### 1.3 Verifying outside the sandbox proves nothing

The `/tmp` control-directory fix was verified over SSH, where `/tmp` is writable, and failed on deploy
with `[Errno 30] Read-only file system` because the unit runs `ProtectSystem=strict`. An interactive
shell is not the sandbox that constrains the daemon. **Any privilege or filesystem question must be
answered from inside the unit** — `systemd-run --property=... ` or a test that reproduces the sandbox.

### 1.4 A claim of absence must be checked against a total

"~6 h of data lost" was reported off `ls | sort -k6 | tail`, which sorted a 179 MB ECG file *above* the
tail and hid it. Nothing was lost. **Never conclude absence from a sorted excerpt** — count, or sum,
against a total.

---

## 2 · Open work from this brief's own execution

### 2.1 The CPAP is recording its own oximetry, and nothing consumes it

`SA2.edf` carries `SpO2.1s` and `Pulse.1s` at 1 Hz for the full night, on every night on the card.
Tepna sources SpO₂ from the O2Ring alone, and `VIGIL-DEEP-ANALYSIS` records the ring spending **17 % of
nights below −85 dBm** with the resulting dropouts. This is a **second, wired, drop-free SpO₂ source
over the identical interval** — a real cross-validation opportunity for OxyDex and a gap-filler for
exactly the nights the ring loses. Flagged in the parent as out of scope; still unclaimed. Probably
deserves its own brief rather than a section here.

### 2.2 The harvest has never been observed failing in the field

Every failure path — barren, short read, deadline-capped partial, a refused association — is unit
tested, and none has yet fired on the box under real conditions. The alert path in particular has
never delivered a real webhook. Worth one deliberate fault injection (unplug the card mid-afternoon)
rather than waiting to discover it during an outage.

### 2.3 Backfill throughput was measured once, on one card

`130 KB/s` sustained (parent §5) and `1.65 MB/s` (reference brief §2) are the same card measured on
different days with different methods. Neither is wrong; they are not comparable, and the brief that
quotes 65 min for a full backfill is using the slower one. If backfill time ever matters again,
re-measure rather than trusting either.

---

## 3 · Deliberately not done

- **Station mode was never confirmed.** The card answers every path with a 219-byte catch-all `200`,
  so it cannot be probed over HTTP; `ezshare.cfg` serves as 0 bytes. It needs the vendor UI. Moot for
  this deployment (the 13:00 window costs nothing in AP mode), and `reachable()` means the same build
  serves a station-mode box with no association at all — so this stays unanswered on purpose.
- **A second Wi-Fi NIC** (parent §3.3) is unnecessary here: the box's uplink is wired and `wlp1s0` sits
  idle, so there is nothing to contend with during the daily window. `deploy/enable-cpap-wifi.sh`
  covers the Ethernet-less case by refusing rather than by adding hardware.

---

## 4 · Carried from `DEEP-AUDIT-III` — four punch-list items nothing else owns

`DEEP-AUDIT-III-FOLLOWUPS` is DONE for its own §1/§2/§3 scope, and the parent `DEEP-AUDIT-III` stays
**PROPOSED** because these four sections carry no fix stamp and were never in that brief's scope. They
are recorded here so they are not lost to a cleared context. **This brief does not claim them** —
whoever takes them should split them into a MotionDex brief of their own.

| Parent § | Site | Defect |
|---|---|---|
| **3.6** | `integrator-dsp.js:1902` | `Autonomic ⟷ glycemic` publishes an **ECG-only** number under a note that says otherwise |
| **4.1** | `motiondex-dsp.js:214/220` | `sampleHz` divides count by span, so **any gap mis-scales every window** |
| **4.2** | `motiondex-dsp.js:786` | `respiratoryRate()` reports a confident rate across epochs where **the strap was off** |
| **4.3** | `motiondex-dsp.js:174` | **No plausibility bound** on IMU samples |

Three of the four are MotionDex, and §4.1 is the one with the widest blast radius — a mis-scaled
`sampleHz` corrupts every windowed metric downstream of it, not just one.

---

## 5 · Also open, fleet-wide (recorded here only so the list survives)

Not this brief's work, and each needs its own execution. Listed because they are otherwise carried
only in conversation:

1. **16 pending changesets, no release cut.** Several are compute-path changes (ECGDex staging,
   `ansBalance`, the Integrator's gap-aware hours), so per `CLAUDE.md` §🔒 `tools/release.mjs` will
   refuse until `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` runs green on a machine holding
   the real corpus. **The version bump is an owner call.**
2. **Integrator gap-aware overlap, part 2** — ECGDex/PpgDex/OxyDex emitting `recording.coverage` with
   sparse segments, plus an adversarial committed fixture. `bump: minor`; published AHI values move.
3. **REM staging §3** (`REM-STAGING-REDESIGN-2026-07-28-BRIEF.md`) — the weighted-score detector. The
   conjunction rule yields **2 of 77 epochs** on real data, and the corpus median REM is **6.5 %**
   against a physiological 15–25 %.
4. **Fold by night key** — one folder per sleep *night* (`start − 12 h`) rather than per calendar date.
   Going forward only; never retroactive.

---

## 6 · Done when

- [ ] §2.1 routed to its own brief (CPAP `SA2.edf` as a second SpO₂ source) or explicitly declined
- [ ] §2.2 one deliberate fault injection against the running box, with the webhook actually delivering
- [ ] §4 split into a MotionDex brief, after which `DEEP-AUDIT-III` can finally close
- [ ] §5.1 verified + released, or the changeset backlog explicitly parked with a reason

<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-09-05

# Vigil Bluetooth — adversarial audit (owner-ordered: "must be spotless")

Owner instruction 2026-09-05: *"Bluetooth on this machine must be spotless. do very deep adversary
testing. find errors or even potential errors and write them down."* This is that write-down: every
layer of the BLE stack attacked with measurements and adversarial code-reading, **read-only** — no
daemon restarts, no resets, no packets sent (standing vigil rules). Companion to the same-day
inventory [`VIGIL-BLUETOOTH-ADAPTERS-2026-09-05-BRIEF.md`](VIGIL-BLUETOOTH-ADAPTERS-2026-09-05-BRIEF.md),
which holds the adapter roster and the error census this audit builds on. Findings are labelled
**ERROR** (happened, evidence attached) · **POTENTIAL** (a condition that can produce one) ·
**FIXED-VERIFIED** (a prior finding checked and confirmed closed — listed so it is not re-found).
Everything measured 2026-09-05 ~17:45–18:15 UTC on the box unless dated otherwise.

## 0 · What was verified FIXED first (do not re-find these)

- Post-connect GATT setup awaits are **bounded** — `_bounded_setup` (`capture.py:313`) wraps every
  `start_notify`/auth write (`:2675, :2757, :2801`). Closes VIGIL-DEEP-ANALYSIS top-finding 1.
- The `bluetoothctl` **newline-injection via device address is closed** — `webmon.py:552/:560`
  `_valid_mac`-gates `/api/bond` and `/api/forget` before any address reaches a shell-adjacent string.
- Scan matching is **address-only** (#2232, `capture.py:1620` records the old name-contains behaviour).
- The **radio-distress failover is ARMED** — `/api/state` now carries `radio_switches` (it did not on
  2026-09-02 per RADIO-FAILOVER-DISTRESS-SIGNAL; the owner's arming decision has been taken).
- `ble_sniff.py` CRC/span defects (F1/F2 of the inventory brief) — fixed on
  `claude/ble-sniff-crcok-k4p`; the bit-flip near-miss MACs (`24:2C:AC:…` = Verity one bit off) that
  polluted earlier air analyses are instrument error, resolved.

## 1 · Hardware / USB layer

- **A1 · ERROR (happened yesterday): hci0 RTL8761BU firmware hang.** Kernel, 2026-09-04 19:12:38:
  `command 0xfc61 tx timeout` → `Resetting usb device` → `RTL: Read reg16 failed (-110)` → `Failed to
  generate devcoredump`. This is exactly the VIGIL-DEEP-ANALYSIS §2D class ("powered but deaf",
  clearable only by USB re-bind) on the UB500 — which is both the `bluetoothctl` **default** adapter
  and the best-hearing radio in the pinning brief's scan table. The kernel's own reset recovered it
  this time. One occurrence in the last 4 boots' logs; the class is why `tepna-btreset.sh` exists.
- **A2 · POTENTIAL (chronic): stale ACL handles on the capture radio.** `hci1: ACL packet for unknown
  connection handle` — **68 events in boot −2** (Aug 31→Sep 3: handles 76×42, 75×13, 70×6, 74×5,
  69×2), 4 since today's boot. The dongle keeps delivering data for links the kernel has torn down —
  a handle-desync symptom that accompanies exactly the link churn the daemon log shows (755 `wedged`
  / 24 h, attribution H10 544 · Verity 204 per the inventory brief). Not itself data loss (the ACL
  data is dropped), but it is the kernel-visible shadow of connections dying uncleanly.
- **A3 · POTENTIAL (hardware quality): the radio carrying every wearable is an anonymous CSR-clone-
  signature dongle.** `0a12:0001` (the generic ID every clone ships), `bcdDevice 82.41`,
  **`iManufacturer 0` / `iProduct 0`** (empty descriptor strings), `MaxPower 0mA`, BT **4.0**, ACL
  MTU 310 vs 1021 on both idle radios. The kernel's clone detection printed nothing (0 matches across
  all retained boots), so this is unproven counterfeit — but production capture rides on the least
  attributable, oldest-spec radio in the box while a 5.1 and a 5.4 radio sit idle. (Which device
  should ride which radio is PER-DEVICE-ADAPTER-PINNING's territory — deliberately not re-proposed
  here; this row only records the hardware-trust asymmetry.)
- **A4 · POTENTIAL (shared fate): one USB root hub carries all three radios + the sniffer + the
  ring's dock** (bus 001, xhci, 480M). A bus-level xhci reset is a simultaneous all-radio outage — 
  A1's recovery path (`Resetting usb device`) already reached one port of it yesterday. No per-port
  isolation has been measured. A cheap hedge exists unmeasured: bus 002 (USB3 root) is empty.
- **A5 · POTENTIAL (coexistence): hci2 shares the AX210 module with the box's Wi-Fi.** `wlp1s0` MAC
  `28:0c:50:0c:18:f9` = hci2's `…:fd` minus 4 — same silicon, shared 2.4 GHz front-end. Wi-Fi is
  **DOWN** today, which is the safe state: if it is ever brought up on 2.4 GHz, the CPAP's pinned
  radio inherits BT/Wi-Fi coexistence contention. Worth a standing rule: wlp1s0 stays down (or
  5 GHz-only) while hci2 carries the CPAP.

## 2 · BlueZ layer

- **B1 · POTENTIAL (pairing is unauthenticated by construction).** `bonding.py` pairs with
  `agent NoInputNoOutput` → Just Works → the LTK **encrypts but does not authenticate**: an active
  MITM present at (re-)pair time can own a Polar bond. Proximity-attacker-only, and the sensors offer
  no better (no display/keyboard) — recorded so the trust model is explicit: **bonded ≠ 
  authenticated**; the bond defends against impostors only after an unattacked first pairing.
- **B2 · ERROR (a shipped mitigation is not holding in production).** `bonding.py:199-203` untrusts
  after pairing (VIGIL-DEEP-ANALYSIS §2D: `Trusted` makes the kernel's autoconnect race bleak for the
  single ACL slot — the recorded `br-connection-canceled`). Measured on the capture adapter
  (`select 00:01:95:CC:53:02`): **H10 `Trusted: yes`, Verity `Trusted: yes`** — the exact state the
  fix exists to remove. Two hypotheses, both actionable: (a) the bonds predate the fix and nothing
  ever retro-untrusted them; (b) the timed script sets `trust` at t≈10 s and `untrust` at t≈21 s, so
  any session death in between leaks a trust flag permanently. Either way the race the fix targets is
  live on the production radio today. Cheapest closure: a one-time `untrust` of both Polars on hci1
  (owner-authorized box op), plus reordering the script so `trust` never precedes a successful `pair`.
- **B3 · POTENTIAL (all-defaults bluetoothd on a production appliance).** `/etc/bluetooth/main.conf`
  has every section empty. Nothing is tuned: no `Privacy` (adapters connect with public identity),
  default reconnect/JustWorks policy, and — load-bearing for `probe_ring_adv` — no `--experimental`,
  so passive scanning with `or_patterns` is unavailable (already documented there; this row just
  notes the config file is the reason). Not proposing values — proposing that the *decision* be taken
  deliberately once, brief-recorded, instead of inherited from the distro default.
- **B4 · trap (documented, restated):** `bluetoothctl`'s default controller is **hci0**, not the
  capture adapter — an unselected query answers about the wrong radio (this audit's own first
  bond-state read was wrong this way; the inventory brief §1 carries the warning).

## 3 · Daemon / protocol layer

- **C1 · POTENTIAL (the largest finding): the O2Ring link is spoofable end-to-end, and the threat is
  data INTEGRITY, not confidentiality.** Chain, each link verified: identity is **address-only**
  (standing ruling + #2232) → the ring's MAC is public knowledge on air (~1.6 adv/s measured, even
  docked) → the ring holds **no bond on any adapter** (checked hci0/hci1/hci2: `not available`), so
  the link is unencrypted with no LTK to prove peer identity → the application protocol is fully
  documented in this repo (`O2RING-USB-PROTOCOL`: `0xA5`+CRC-8 framing, auth = MD5 of a fixed vendor
  string — fire-and-forget, never verified by the peer — identity via **plaintext `0xE1` reply**) →
  the daemon's post-connect identity check reads that forgeable reply (`oxyii.py:730`). An
  nRF-devkit-class device within radio range advertising `D1:98:62:7C:92:B3` can therefore (a) hold
  the daemon in connect loops while the real ring goes unharvested (DoS), or (b) **serve fabricated
  SpO₂/PPG/session data into the corpus** — silent wrong data, the failure class this repo treats as
  worse than loss. The Polars resist (b): bonded peers get encrypted reconnects an impostor without
  the LTK cannot complete (subject to B1's first-pairing caveat). ⚠️ **Correction, same day:** the
  first draft proposed enabling the `O2RING-USB-PROTOCOL` §3.3 AES session on this link — that
  session is a **USB-transport** feature; the BLE auth is `0xFF` XOR-keyed with **no reply at all**
  (`oxyii.py:9-11`: "live path uses only CRC-8 + MD5 + XOR — NO AES"), so there is no BLE session
  crypto to switch on. The real mitigation ladder is in §6.2.
- **C2 · POTENTIAL (privacy, measured): physiological data and identity are broadcast.** The ring's
  live link being unencrypted means live SpO₂/PPG and `.dat` pulls are readable by any passive
  sniffer — demonstrated feasible with the hardware on this very desk (§4's captures). Both Polars
  broadcast serial-bearing names (`Polar H10 02849638`, `Polar Sense 0C301E3F`) several times per
  second all night — a persistent household-presence fingerprint (inherent to Polar firmware; the
  serials also sit in this public repo's config, so the leak is confirmatory, not novel). The CPAP
  link is unbonded too but AS11 runs app-layer AES (`as11_cipher.py`) — payload protected, presence
  metadata not.
- **C3 · POTENTIAL (watchdog as amplifier).** The adapter recovery ladder (CAP_NET_ADMIN, power-
  cycle rung) exists to clear real wedges, and 24 h shows 755 wedge mentions feeding it. Anything
  that can *induce* the wedge signature — RF jamming, connect-flooding our sensors — converts one
  adversarial stimulus into self-inflicted all-device drops on that radio. The `recover_checks`
  hysteresis (VIGIL-OVERNIGHT P1.1/P1.4) bounds flapping; the residual is sustained induction during
  a jam. Note-only: the ladder's benefit exceeds this risk; the row exists so the trade is on record.
- **C4 · POTENTIAL (deploy churn costs link continuity for zero code).** `tepna-update.sh` restarts
  the daemon whenever the deployed SHA moves and the box is idle — measured today: **13:40:45 restart
  deploying `93a17e27`, a docs-only commit**. The recording interlock protects nights, but each
  daytime restart drops live links (ring charge-sync, daytime Verity wear) and re-runs bonding —
  gratuitous churn at this repo's merge cadence (28/day measured 2026-08-16). Proposal: gate the
  restart on `git diff --name-only <old>..<new> -- capture-host/` being non-empty; docs-only deploys
  update the marker and skip the restart.

## 4 · Air layer (nRF sniffer, CRC-honest)

- **D1 · measured-clean (window-limited): no foreign initiator has connected to our devices.** Every
  crc-ok CONNECT_IND targeting our four MACs across both captures (2 h overnight + 6 min fresh) came
  from our own adapters (Sena→Verity 6, Sena→ring 1, AX210→ResMed 1). Clean — for 126 minutes of one
  night. Continuous assurance needs recurring captures; with `ble_sniff.py` now CRC-honest and
  span-reporting, a periodic capture + one-line verdict is cheap (proposal D3).
- **D2 · POTENTIAL (unattributable scan interest in our sensors).** Overnight, our four devices
  received SCAN_REQs from many *rotating random* addresses (top sources 784, 754, 726… each). These
  may be our own adapters (the kernel can scan under a non-resolvable private address) or neighbours
  actively fingerprinting — **the pcap cannot discriminate**. The discriminator is `btmon` on each
  local adapter correlated against a simultaneous air capture; `btmon` needs root, so this is a
  sudoers-roster candidate (`tepna-rssi.sh` shape: a bounded, read-only helper).
- **D3 · proposal: make the air a monitored surface.** The box owns a sniffer nothing schedules. A
  nightly N-minute capture into `/srv/tepna/captures/sniffer/` + `ble_sniff.py` verdict (now
  trustworthy) turns D1's one-off "clean" into a standing check, and would have caught the 09-04
  capture death (F2) the same night. Costs: one timer + one script; no daemon change.

## 5 · Verdict against "spotless"

The stack is **not spotless today** on five concrete counts: A1 (a firmware hang 24 h ago), A2 (68
stale-handle events in one boot), B2 (a shipped race mitigation absent from production state), C1 (a
spoofable medical-data ingest path), and the standing churn census (755 wedged/24 h) the inventory
brief owns. None is capture-fatal today; C1 is the one with silent-wrong-data potential and deserves
the first decision. The cheap, owner-authorized box ops that fall out: untrust both Polars on hci1
(B2), keep wlp1s0 down by rule (A5), probe this ring's firmware for the AES session (C1), add a
bounded `btmon` helper to the sudoers roster (D2), and the two script-sized changes C4 + D3.

Not re-proposed (owned elsewhere): per-device radio placement (PER-DEVICE-ADAPTER-PINNING) ·
distress-failover tuning (armed; RADIO-FAILOVER brief) · adapter A/B methodology (`adapter_ab.py`) ·
the maintainer-surface gaps (inventory brief §5). §6 below carries the paste-ready closure block.

## 6 · Owner closure block + C1 probe plan (added same day, coordinator-requested)

### 6.1 · Paste-ready box ops — ONE approval covers this block

Safe on live links: `untrust` only clears the kernel-autoconnect flag, it does not disconnect
anything. Expected output of the verify line: `Trusted: no` twice.

```sh
# B2 — clear the live trust race on the capture adapter (30 s):
printf 'select 00:01:95:CC:53:02\nuntrust 24:AC:AC:02:84:96\nuntrust 24:AC:AC:0C:30:1E\nquit\n' | bluetoothctl
printf 'select 00:01:95:CC:53:02\ninfo 24:AC:AC:02:84:96\ninfo 24:AC:AC:0C:30:1E\nquit\n' | bluetoothctl | grep Trusted

# maintainer tooling in one apt line — shellcheck closes check.sh's local blind spot
# (exit 127 today, CI-only verdict); rfkill enables the A5 wifi soft-block:
sudo apt install shellcheck rfkill

# A5 — wifi stays down by mechanism, not by habit (hci2 shares the AX210 front-end with wlp1s0):
sudo rfkill block wlan
```

### 6.2 · C1 probe plan — measure, don't fix; nothing here runs without the owner present

Ground truth first (source-verified): the BLE auth has **no reply** (`oxyii.py:9-11`), so no
session-crypto negotiation exists on the BLE transport — the §3.3 AES belongs to USB. Three rungs:

- **Probe A — does the ring accept LE pairing?** (owner-attended, ~60 s, the ONLY radio-touching
  step): with the ring docked and `idle_unworn`, `select 00:01:95:CC:53:02` → `pair
  D1:98:62:7C:92:B3`. Success ⇒ bond it like the Polars — link-layer encryption + impostor
  resistance in one move, zero protocol change (subject to B1's Just-Works caveat). Refusal ⇒
  recorded fact, fall to B. Risk: a failed pairing attempt can disturb the link; `unwedge.sh` is the
  documented recovery; a session must not run this unattended.
  **EXECUTED 2026-09-05 ~19:10 UTC, owner present, worn + recording (the onboard `.dat` being the
  net): `bonding.bond()` over the live Sena link → `{'ok': False, 'detail': 'auth-failed'}` — the
  ring REFUSES LE pairing** (SMP authentication failure on this firmware). The link bounced for ~1 s
  and self-healed (reconnect 15:10:14 local, recording intact, `last_error: None`); `bond()`'s
  untrust cleanup ran even on failure (Paired/Bonded/Trusted all `no` after — no residue). So the
  C1 closure is **Mitigations B + C**, and C2's on-air exposure is permanent for this hardware:
  the BLE link cannot be encrypted. Two side-measurements: the ring's advertising local name is
  `'S8-AW 2100'`, and it does not implement DIS — ⚠️ which does NOT mean firmware is unreadable
  (owner correction, same day): the vendor `GET_INFO 0xE1` reply carries the real dotted version at
  bytes `[4].[3].[2].[1]` plus hwV `[0]` and bootloader `[8]..[5]` alongside the `[9:17]` branchCode
  (`O2RING-PROTOCOL` §3, layout corrected 2026-09-02). `oxyii.parse_get_info` today exposes only the
  branchCode, under the key `"firmware"` — residue `2026-09-02-oxyii-branchcode-named-firmware` is
  the open naming fix, and exposing the version bytes there would make the daemon's
  "firmware revision unread" DIS log line obsolete.
- **Mitigation B — prefer USB harvest when docked** (code PR, no radio risk): the ring sits on the
  bus nightly (`1915:f33c`, present right now), the USB client exists (`o2ring.py`,
  O2RING-USB-PROTOCOL), and **a USB device is unspoofable by radio** — stored-`.dat` harvest over
  the dock gives the corpus a physically authenticated channel regardless of what happens on air.
  The live BLE stream stays as-is; the archival record gains integrity.
- **Mitigation C — impostor-shape alert** (code PR): fire the existing guardrails webhook on an
  `0xE1` identity whose `device_id ≠` the configured `S8AW2100`, or on repeated connects that reach
  identity but never a valid pull. Detection, not prevention — cheap and honest about it.

### 6.3 · C4 content-gate — exact rule for the PR (so nobody re-derives it)

`tepna-update.sh` owes a restart iff **marker ≠ HEAD AND `git diff --name-only <marker>..HEAD --
capture-host/` is non-empty**. Fail TOWARD restart: a missing marker, a marker sha unknown to git,
or a failing diff all restart (preserving the never-serve-stale-code guarantee); a docs-only delta
updates the marker and skips. `--force-restart` bypasses the gate unchanged. Evidence for the cost:
the measured 13:40:45 restart today deployed `93a17e27`, a docs-only commit, at a repo cadence of
28 merges/day (2026-08-16 measurement).

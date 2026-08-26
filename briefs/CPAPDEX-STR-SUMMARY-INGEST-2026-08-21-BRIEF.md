<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-26 · **Created:** 2026-08-21

# CPAPDex — ingest the ResMed STR.edf daily summary (device mode, RERA, prescription)

**One line:** CPAPDex reads only the per-session waveform EDFs (BRP/PLD/SA2/EVE) and computes everything
from them; the device's own **daily summary `STR.edf` is not ingested at all**, so three things the
waveforms structurally cannot give are being left on the table — the device-**declared** therapy mode, the
device-scored **RERA index**, and the **prescription/settings** block. This adds a pure `STR.edf` summary
parser and surfaces those, without disturbing the validated per-session pipeline.

## Source

The ResMed data-model reference used here is **`m-kozlowski/airbreak-plus`** — a ResMed firmware-mod
toolkit and protocol-documentation project (a fork of `Asmageddon/airbreak-plus`, itself descending from
**`osresearch/airbreak`**, the original ResMed reverse-engineering project). Its `docs/as11/` carries a
744-variable `var_reference.tsv` and a full `rpc_protocol.md` command reference. Only its **documentation**
is used — no firmware modification is performed or implied; Tepna's no-firmware and offline-read rules are
unchanged.

## Why (the finding, 2026-08-21)

Cross-referencing that variable map against a **real STR.edf** (`/srv/tepna/captures/cpap/STR.edf`,
decoded 2026-08-21) showed the summary carries device values CPAPDex cannot compute:

- **`Mode` [sig 5]** = `OPERATING_MODE` (var-map `0x020D` MOP) — the device's **own declaration**. CPAPDex
  today *infers* CPAP-vs-APAP from a per-window P90-envelope IQR (`classifyMode`, §F2) and correctly
  **refuses** (`null`) in the indeterminate band. That inference is validated and stays — but STR's `Mode`
  is ground truth that resolves the nulls and corroborates the calls.
- **`RIN` [sig 75]** = `RERA Index` (var-map `0x0050` RIN_SESSION). CPAPDex cannot compute RERA (needs
  arousal, absent from flow) — a distinct event class, part of RDI, not in AHI.
- **`CSR` [sig 76]** = device-scored Cheyne-Stokes. CPAPDex computes its OWN CSR from flow; STR's is the
  manufacturer's — a **free cross-check** ([[cpapdex-validated-against-str-edf]] flags CSR as the one
  unread channel).
- **`S.*` settings [sig 6–32]** = the **prescription**: `S.EPR.Level`/`.EPRType`/`.EPREnable`,
  `S.RampTime`, `S.A.MaxPress`/`.MinPress` (AutoSet range) or `S.C.Press` (fixed), `S.Mask`, `S.Tube`,
  `S.HumLevel`, `S.Temp`. Waveforms carry what *happened*; STR is the only source of what was *prescribed*.
  (And the EPR setting is the exact confound that broke the old mode rule — reading it makes that explicit
  rather than inferred.)

Decoded encodings (real file): `Date` = **days since 1970** (phys 0..24836), one record/day, +1/day;
`MaskOn`/`MaskOff` = **minutes since noon** (phys 0..1440), ≤20 sessions/day (`-1` = unused slot);
`Duration` = mask-on minutes. Redundant with the per-session pipeline (skip): `AHI/HI/AI/OAI/CAI/UAI`
(from EVE), `SpO2.*` (from SA2), `Leak/RespRate/TidVol/MinVent/MaskPress.*` percentiles (from PLD).

## What shipped

1. **Parser** — `CpapDsp.parseStrSummary(readEdfResult)`: pure, over the existing `CpapEdf.readEDF` signal
   map. Returns one record per STR day — `{ dateMs, deviceModeCode, deviceMode, deviceRera, deviceCsr,
   prescription:{…}, sessions:[{onMs,offMs}] }`. `Date` → floating `dateMs` (Clock Contract);
   `MaskOn/Off` → floating session `onMs/offMs` (noon-anchored). `-1` fills dropped, never fabricated.
2. **Mode mapping — refuses to guess.** `{0:'CPAP',1:'APAP'}`; any other code → `deviceMode:null` with the
   raw `deviceModeCode` preserved (mirrors `classifyMode`'s null-not-a-coin-flip).
3. **Attach, don't overwrite.** `attachStrSummary` matches nights by UTC day and adds
   `deviceMode`/`deviceRera`/`deviceCsr`/`prescription` as NEW fields. The inferred `mode` is untouched.
   Naming is deliberate: CPAPDex already has its own flow-shape `reraIndex`, so the device-scored one is
   `deviceRera` — a test caught that collision.
4. **Registry** — `deviceMode`, `deviceRera`, `deviceCsr`, all `measured` tier (direct device values).
5. **App** — a badged device-summary strip on the night card (declared mode, prescription, RERA, and the
   device-vs-CPAPDex CSR cross-check).
6. **Gates** — a 17-assertion suite group; full chain + `verify-fixtures` green.

**Validated end-to-end on the real box STR.edf: 19 nights, mode=APAP confirmed on every one, EPR 3 /
pressure 7–17 revealed, split nights and a 20 % CSR night parsed.**

## Addendum — the clock question, answered from the PROTOCOL REFERENCE (not inferred)

`docs/as11/rpc_protocol.md` documents the AS11 RPC layer with a per-method **permission table**, which
settles "can the CPAP clock be set locally?" with a citation rather than an inference:

| Access set | Permission VCIDs |
|---|---|
| **service** | `0x0380`, `0x0382` (CAN), `0x0780`, `0x0788` (internal/cellular) |
| **BLE encrypted** | `0x0394`, `0x0396`, `0x0398` |
| **application** | CAN + internal/cellular + **BLE encrypted** |
| **all** | every channel incl. BLE |

- **`SetDateTime` (cmd `0x05`) is `service`** — CAN and internal/cellular ONLY. **No BLE VCID is in that
  set**, so the setter is unreachable over Bluetooth *by firmware permission*, not by absence. That is
  exactly how the vendor cloud sets it (the cellular channel), and why an un-synced device drifts
  unboundedly. ⇒ "No way to set the AS11 clock without cloud or firmware" is CONFIRMED, and now has a
  mechanism: a permission bit, not a missing method. `GetRtcAndSystemClocks` is also `service`.
- **`GetDateTime` (cmd `0x04`) is `all`** — includes `0x0396`, so the clock is READABLE over encrypted
  BLE. Result is an **ISO 8601 string** (`{"dateTime":"…Z"}`); request is `jsonrpc:"1.0"` with `params`
  **omitted** (an omitted member, `{}`, and `null` are NOT interchangeable).
- **`StartStream` and `StartSpool`/`PullSpoolFragments` are `application`** — which INCLUDES BLE
  encrypted. So live waveforms (`dataIds:["PatientFlow","MaskPressure"]`, 10–65000 ms sampling) and the
  stored summary spools are both reachable over BLE. **Full CPAP capture over BLE is protocol-permitted**,
  so the vigil box — which already has the BLE radios and is paired with this device — could capture CPAP
  on its own NTP clock with no additional hardware. That is a separate work-unit; the encrypted-channel
  implementation is not part of this brief.

## Still owed

- [x] Use `deviceCsr` to actually cross-validate CPAPDex's own periodic-breathing %. **DONE (2026-08-25):**
      `csrPbCrossCheck(deviceCsr, pbPct)` in `cpapdex-dsp.js`, wired into `attachStrSummary` as
      `night.deviceCsrCheck` — a DECLARE-never-correct corroboration read (touches no metric). The band is
      **asymmetric by physiology, pre-stated before any real night** (Cheyne-Stokes ⊂ periodic breathing):
      PB ≥ CSR is benign (`pb-broader`), CSR substantially exceeding PB is the finding (`discrepancy`);
      band = max(2 pp, 50% of the larger). Registry `csrPbDelta` (measured), a reference-guide card, a
      device-summary render line, and 27 tests including the asymmetry control (same |Δ|, opposite verdict).
- [x] Apply the independently-measured clock offset to STR's device-time session boundaries
      (see `CPAP-CLOCK-LONGITUDINAL-SEGMENT-2026-08-21-BRIEF.md`).
      **BLOCKED, and the chain is named (traced 2026-08-26) — this is not unstarted work.** The applier
      itself is ~10 lines; it would have NOTHING TO APPLY. Measured, not assumed:
      `attachStrSummary(nights, strSummary)` is called with exactly two arguments
      (`cpapdex-app.js:284`), there is no offset input anywhere in `cpapdex-app.js`/`cpapdex-dsp.js`,
      and CPAPDex has **no acquisition-evidence reader** (Phase C shipped for OxyDex only, #1752). So
      building the applier now would be capability without a customer.

      | # | link | status |
      |---|---|---|
      | 1 | box reads `GetDateTime` over BLE vs its stratum-1 clock | exists (`cpap_ble_pull.py`; cmd 0x04 is `all`-access, per the addendum above) |
      | 2 | that offset rides the CPAP acquisition-evidence envelope as a NUMBER | **DONE 2026-08-26** — `acq_evidence.ClockOffset` (`offset_sec` + `measured_at_ms` + `reference` + `method`), schema 1.1.0, carried by both CPAP assemblers |
      | 3 | a CPAP-side envelope reader (CPAP Phase C) | **DONE 2026-08-26** (#1805) — joins by DAY, not filename: a CPAP night comes from SD EDFs carrying no host session id, so #1752's filename match does not transfer. Reuses `attachStrSummary`'s day rule verbatim |
      | 4 | corrected fields emitted BESIDE the raw device-time ones | **DONE 2026-08-26** — `applyStrClockOffset` emits `sessionsCorrected` + `strClockCorrection`, raw `sessions` untouched |

      🔒 **Design ratified 2026-08-25: ADDITIVE.** Raw `sessions[].onMs/offMs` stay VERBATIM (INV3);
      corrected values land beside them with the offset's provenance (INV4's shape — the reference axis
      beside the device clock, never substituting). Declare-never-correct, the pattern item 1 above
      already set in this brief. In-place correction would silently move the ~17 existing `.sessions`
      consumers (dsp 5 · render 7 · cross 2 · app 3) that currently assume device time.

### The clock box is CLOSED (2026-08-26) — what it took, and why it was not ten lines

The applier itself IS ~15 lines. It was blocked for five days not by difficulty but because **it had
nothing to apply**, and that was only visible by tracing the chain to its last link rather than its
first: `fitClockOffsetSegments` existed and was exported, which made the box look ready. It was not —
`attachStrSummary` took two arguments, no offset input existed anywhere in the CPAP path, and CPAPDex
had no envelope reader at all. Three units had to land first (#1803 the numeric offset field, #1804 the
acquisition start without which an envelope joins to nothing, #1805 the reader).

**Sign, stated once so nobody re-derives it:** `offset_sec` is POSITIVE when the DEVICE reads LATER
than the reference, so a device stamp `T` denotes reference time `T − offset`. The AS11 here runs
BEHIND (negative offset), so correction moves its stamps LATER — the direction the ~42-minute skew
finding predicts. `strClockCorrection.appliedMs` states what was ADDED, so a consumer never re-derives
it. Pinned from BOTH directions in the suite, because one example cannot distinguish a sign convention
from its inverse.

**An UNMEASURED offset yields NO corrected view** — not a copy of the raw sessions. A
`sessionsCorrected` that silently equalled `sessions` would assert that a correction had been applied
when none was, which is the fabrication this brief's whole posture exists to prevent. A MEASURED zero
is different and does yield one: 0 s is a result (the clocks agreed), not an absence.

## Deliberately NOT in scope

- **Setting the CPAP clock** — not possible on this transport (permission table above), and moot: the fix
  is correcting the data timebase.
- **No RTC read/sync over a live UART or firmware patch** — offline-read + no-firmware rule.
- **No skew detection from STR** — STR's clock is the SAME device RTC as the per-session EDFs, so it is
  shifted by the identical offset (measured ~39–42 min). The Integrator's cross-device co-occurrence check
  remains the only skew detector; STR is where an independently-measured offset would be *applied*, not
  where it is found.
- Redundant summary channels (AHI/SpO2/leak percentiles) — CPAPDex already derives these from raw.

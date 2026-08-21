<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-08-21 · **Created:** 2026-08-21

# CPAPDex — ingest the ResMed STR.edf daily summary (device mode, RERA, prescription)

**One line:** CPAPDex reads only the per-session waveform EDFs (BRP/PLD/SA2/EVE) and computes
everything from them; the device's own **daily summary `STR.edf` is not ingested at all**, so three
things the waveforms structurally cannot give are being left on the table — the device-**declared**
therapy mode, the device-scored **RERA index**, and the **prescription/settings** block. This brief
adds a pure `STR.edf` summary parser and surfaces those, without disturbing the validated
per-session pipeline.

## Why (the finding, 2026-08-21)

Prompted by `ilyakruchinin/airbreak-plus` (a ResMed firmware-mod toolkit) and its 744-variable
`var_reference.tsv`. airbreak's *mechanism* (read/set the STM32H753 RTC live over UART, `rtc::sync`
to host UTC) is excluded by Tepna's offline-read + no-firmware rules — see
`briefs/O2RING-RAW-DUAL-WAVELENGTH-...` sibling reasoning. But cross-referencing its variable map
against a **real STR.edf** (`/srv/tepna/captures/cpap/STR.edf`, decoded 2026-08-21) showed the
summary carries device values CPAPDex cannot compute:

- **`Mode` [sig 5]** = `OPERATING_MODE` (airbreak 0x020D MOP) — the device's **own declaration**.
  CPAPDex today *infers* CPAP-vs-APAP from a per-window P90-envelope IQR (`classifyMode`, §F2) and
  correctly **refuses** (`null`) in the indeterminate band. That inference is validated and stays —
  but STR's `Mode` is ground truth that resolves the nulls and corroborates the calls.
- **`RIN` [sig 75]** = `RERA Index` (airbreak 0x0050 RIN_SESSION). CPAPDex cannot compute RERA (needs
  arousal, absent from flow) — a distinct event class, part of RDI, not in AHI.
- **`CSR` [sig 76]** = device-scored Cheyne-Stokes. CPAPDex computes its OWN CSR from flow; STR's is
  the manufacturer's — a **free cross-check** ([[cpapdex-validated-against-str-edf]] flags CSR as the
  one unread channel).
- **`S.*` settings [sig 6–32]** = the **prescription**: `S.EPR.Level`/`.EPRType`/`.EPREnable`,
  `S.RampTime`, `S.A.MaxPress`/`.MinPress` (AutoSet range) or `S.C.Press` (fixed), `S.Mask`, `S.Tube`,
  `S.HumLevel`, `S.Temp`. Waveforms carry what *happened*; STR is the only source of what was
  *prescribed*. (And the EPR setting is the exact confound that broke the old mode rule — reading it
  makes that explicit rather than inferred.)

Decoded encodings (real file): `Date` = **days since 1970** (phys 0..24836), one record/day, +1/day;
`MaskOn`/`MaskOff` = **minutes since noon** (phys 0..1440), ≤20 sessions/day (`-1` = unused slot);
`Duration` = mask-on minutes. Redundant with the per-session pipeline (skip): `AHI/HI/AI/OAI/CAI/UAI`
(from EVE), `SpO2.*` (from SA2), `Leak/RespRate/TidVol/MinVent/MaskPress.*` percentiles (from PLD).

## Plan

1. **Parser** — `CpapDsp.parseStrSummary(readEdfResult)` in `cpapdex-dsp.js`: pure, over the existing
   `CpapEdf.readEDF` signal map. Returns `[{ dateMs, deviceModeCode, deviceMode, reraIndex, deviceCsr,
   prescription:{ eprEnable, eprType, eprLevel, rampMin, pressMin, pressMax, pressSet, mask, tube,
   humLevel }, sessions:[{onMs,offMs}] }]`, one per STR record. `Date` → floating `dateMs` (Clock
   Contract, `Date.UTC(1970,0,1)+days*86400000`); `MaskOn/Off` → floating session `onMs/offMs`
   (noon-anchored). Out-of-range / `-1` fills dropped, never fabricated.
2. **Mode mapping — refuse to guess.** `{0:'CPAP',1:'APAP'}` (AirSense AutoSet; this device is SX567);
   any other code → `deviceMode:null` + raw `deviceModeCode` preserved (mirrors `classifyMode`'s
   null-not-a-coin-flip ethos). Never fabricate a label for an unmapped code.
3. **Attach, don't overwrite.** When a STR summary and the per-session nights are both loaded, match
   by `dateMs` (day) and attach `deviceMode`/`reraIndex`/`deviceCsr`/`prescription` to the night as
   NEW fields. The inferred `mode` is untouched; the app shows the device declaration when present and
   falls back to the inference otherwise.
4. **Registry** — `deviceMode` (measured — device stat), `reraIndex` (measured — device-scored `/hr`),
   `deviceCsr` (measured — device-scored %), plus prescription context (`eprLevel`, `pressMin`,
   `pressMax`). All `measured` tier (direct device values), badged.
5. **App** — a prescription/device-scored strip on the night card: declared mode, EPR level, pressure
   range, RERA index, and the device-vs-CPAPDex CSR cross-check.
6. **Gates** — a `tests/dex-tests.js` group driving `parseStrSummary` over a synthetic STR record
   modelled on the decoded real one (Date decode, noon-anchored sessions incl. a split night, mode
   mapping incl. the null-on-unknown refusal, RERA/CSR/prescription extraction, `-1` fill dropped).
   Full chain + `verify-fixtures`.

## Done when

- [ ] `parseStrSummary` parses the real `/srv/tepna/captures/cpap/STR.edf` (Date/mode/RERA/settings)
- [ ] device mode attaches to matching nights; inferred `classifyMode` untouched
- [ ] registry + app surface the device-scored values, badged, no fabricated mode on unknown codes
- [ ] suite group green; full chain + verify-fixtures green
- [ ] one PR, changeset (bump: minor, type: added, nodes: [CPAPDex])

## Deliberately NOT in scope

- **No RTC read/sync** (airbreak's live-UART mechanism) — offline-read + no-firmware rule.
- **No skew detection from STR** — STR's clock is the SAME device RTC as the per-session EDFs, so it is
  shifted by the identical offset (measured ~39–42 min on 2026-07-26). The Integrator's cross-device
  co-occurrence check remains the only skew detector; STR is where the *independently-measured* offset
  would later be applied, not where it is found. (Corrects an earlier framing that implied STR could
  measure the skew.)
- Redundant summary channels (AHI/SpO2/leak percentiles) — CPAPDex already derives these from raw.

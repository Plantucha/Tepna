<!--
  O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-17

# Capture the O2Ring's live ~100 Hz PPG waveform (the finger-site pleth we currently discard)

> **What this is.** A scoped, executable plan to capture the raw **plethysmograph (PPG) waveform** the
> Wellue O2Ring-S streams live over BLE — a second optical waveform at a **finger** site, ~100 Hz, that the
> daemon currently throws away every second. It **extends** `O2RING-PROTOCOL-2026-07-17-BRIEF.md` (the OxyII
> protocol reference) and honors `CAPTURE-HOST §7`'s integration contract (existing vendor layouts,
> Clock-Contract stamps, device-id filenames — no new parser branch). Out-of-suite (`capture-host/`), like
> the rest of the daemon. Ships code across Phases 1–3; Phase 0 is a measurement.

---

## 1 · The finding (why this brief exists)

The O2Ring's live poll (`cmd=0x04`) reply is **not** just the 1 Hz summary we save. Two independent sources
confirm each `0x04` reply carries **a 24-byte status header PLUS a raw PPG waveform body at ~100 Hz**:

- **The protocol reference** (`github.com/nglessner/o2ring-s-protocol`): *"Real-time PPG waveform, ~100
  samples/sec"* in the `cmd=0x03`/`cmd=0x04` body; the layout is *"present in traffic but has not been
  decoded/validated against a reference."*
- **Our own code** (`capture-host/oxyii.py`): the reassembler exists *because* of it — *"The T8520 splits big
  live frames (24-B header + PPG body) across multiple notifications, so we accumulate until a full declared
  frame is buffered."* Our author already observed the multi-notification (large) frames on this device.

**What we do today:** `oxyii.parse_live()` reads only the header (offsets `[5]…[13]` → SpO₂/HR/motion/
battery/contact); `capture.py`'s `on_data` writes just those 1 Hz values to the ViHealth CSV. **Everything
past byte 24 — the ~100 Hz pleth — is discarded.**

**What is NOT available anywhere else:** the onboard `.dat` (decoded 2026-07-17: 36 000 × 3-byte samples =
10 h @ 1 Hz of `[SpO₂, HR, status]` + a session trailer) is **1 Hz only, no waveform**. So the ~100 Hz pleth
exists **only in live BLE traffic** — not stored on the ring, not in our capture, not in the `.dat`.

**Why it's worth capturing:** a second, **finger-site** optical waveform to sit beside the Verity's
**wrist** PPG. Enables cross-site pulse morphology, an independent PPI/HRV spine, perfusion/PI trends, and —
because both are on the one NTP host clock (Clock Contract) — genuinely simultaneous two-site comparison
(pulse-transit-ish timing, motion cross-checks). It costs us nothing extra on the radio: the bytes already
arrive every second.

---

## 2 · Phase 0 — MEASURE the frame on-device (do first; ~2 min, one link)

Before decoding anything, ground the scope in this unit's real bytes (the reference is generic; validate it):

- Log, for ~10 live `0x04` replies: **total payload length**, and the **first 40 bytes hex**. Expected if the
  reference holds: payload ≫ 24 bytes (a ~100-sample body ⇒ ~200–300 B/frame, spanning ~12–16 BLE
  notifications — consistent with the reassembler's reason to exist).
- Confirms: (a) the body is present on *our* ring, (b) its size per frame ⇒ the true sample rate (samples
  ÷ frame period), (c) whether the header preamble is the reference's `00 00 00 00 <count_lo> <count_hi>`.
- **How, without harming the overnight capture:** run it in a quiet window using the existing single-link
  discipline (stop the daemon or reuse the `_OXYII_PAUSE` seam that `/api/pull` already drives, then a tiny
  `probe_oxyii_ppg.py` mirroring `probe_oxyii.py`). **Do not run mid-precious-capture unprompted.**
- **Kill criterion:** if the body is absent/empty on our firmware, stop here and mark this brief PROPOSED
  (won't-fix, reason inline) — the capability isn't on this unit.

---

## 3 · Phase 1 — decode the PPG body layout (the real work; reverse-engineering)

The body's encoding is undocumented. Decode it empirically, not by guessing:

- **Unknowns:** sample width (u8 / u12-packed / u16), signedness, endianness, per-frame count field, whether
  samples are absolute or **delta-encoded** (the Verity PPG is delta/compressed — the O2Ring may be too), and
  any AC/DC split.
- **Method — validate against a reference we already trust:** wear the O2Ring and the Verity together; the
  Verity PPG is already decoded (`PPGDSP`) and both see the **same heartbeat**. A correct O2Ring decode must
  (a) produce a plausible pleth shape (foot → systolic upstroke → dicrotic notch), (b) yield a **pulse rate
  matching the ring's own 1 Hz HR field** and the Verity/ECG within a couple bpm, and (c) hold sample-count
  continuity across frames (no gaps/dupes at the reassembly seams). Iterate width/endianness/delta until all
  three hold. Cross-check pulse cadence by autocorrelation the way `ppgdex-dsp.js cadenceSamples` does.
- **Deliverable:** `oxyii.parse_ppg(payload) -> list[int]` (raw samples) + the documented layout appended to
  `O2RING-PROTOCOL-…-BRIEF.md`. Keep it a **node-local** parser (like ppgdex/glucodex keep theirs) — do not
  touch the Clock Contract's shared parser.

---

## 4 · Phase 2 — capture it (contract-preserving)

- **New writer** `write_o2ppg` (or a generic raw-PPG writer) emitting the **existing PSL PPG-style layout**
  (`Phone timestamp; sensor timestamp; timestamp [ms]; ppg …`) so it routes with **no new parser branch**
  (`CAPTURE-HOST §7.1`). Filename keeps the device-id convention:
  `Wellue_O2Ring-S_<id>_<YYYYMMDDHHMMSS>_PPG.txt`.
- **Clock Contract:** each sample's wall-clock ms is derived from the **host arrival time** back-timed across
  the frame by the measured ~100 Hz rate (exactly as `polar_pmd.decode_frame` back-times PMD samples) — the
  ring's own clock is unsynced (the +151 s drift, `O2RING-PROTOCOL §9`) and must **not** stamp the waveform.
  A dropped/again-empty frame is a **gap**, never fabricated samples.
- **Rides the existing single link** — no extra connection, no bond (OxyII live path is unbonded). The
  new writer honors the **periodic flush** already added to `writers.py` (bounded crash/power-loss loss).
- **Telemetry:** push the decoded waveform to a new `o2ppg` bus stream so the monitor can scope it.

---

## 5 · Phase 3 — validate + surface

- **Monitor:** a new `o2ppg` Overview card + Live-scope trace (reuse the PPG averaged-pulse morphology panel,
  now that `orient()` is ported). Two finger-vs-wrist pleths side by side.
- **Evidence tier:** the raw waveform is **measured** (direct sensor samples); any *derived* index (O2Ring
  PPI/HRV, cross-site timing) enters at the tier its method earns — **experimental** until validated, never
  upgraded on "the reference says." Every surfaced number carries a badge (COVERAGE MANDATE).
- **Round-trip check:** open the captured `..._PPG.txt` in a PPG consumer (PPGDex path) — feet/peaks detect,
  PPI HR matches the ring's 1 Hz HR and the paired ECG. This is the acceptance gate.
- **Follow-up agenda:** the cross-site pair (finger O2Ring + wrist Verity, one clock) is a natural input to
  the derivations in `MULTI-SENSOR-DERIVATIONS` (PAT-ish timing, motion-gated HRV) — but those **compute in
  the apps, never on the box**, and each is its own executable brief. This brief stops at *capture*.

---

## 6 · Risks & open questions

- **Layout may resist decoding** (packed/delta/companded with no reference) — Phase 1 is the real risk. The
  Verity cross-check is the safety net; if pulse rate can't be recovered, park the brief (PROPOSED, reason
  inline) rather than ship an unvalidated waveform.
- **Bandwidth / CPU:** ~100 Hz × a night is ~modest, but confirm the reassembly + write keeps up on the Pi
  (the box is weak-CPU; capture stays **raw, no on-box DSP**, per HEALTH-BOX-VISION §4).
- **Does the ring keep streaming the body while un-worn / low-perfusion?** Phase 0 notes contact state.
- **Firmware variance:** the layout is validated only on *this* unit (Random-Static MAC, `S8-AW 2100`); note
  it as such in the protocol brief.

## 7 · Done when

Phase 0 confirms the body on-device; Phase 1 lands a `parse_ppg` whose pulse rate matches the ring's HR + the
paired Verity/ECG; Phase 2 writes a PSL-layout `..._PPG.txt` under the Clock Contract that a PPG consumer
reads with no new parser branch; Phase 3 scopes it in the monitor with correct badges and passes the
round-trip acceptance check. Then flip this header to `DONE`, append the decoded layout to
`O2RING-PROTOCOL-…-BRIEF.md`, and spawn `-FOLLOWUPS` for anything that surfaced (or note none did).

---

## Cross-references
- `O2RING-PROTOCOL-2026-07-17-BRIEF.md` — the OxyII protocol reference this extends (live `0x04`, `.dat`, quirks); its decoded-layout section is where Phase 1's result lands.
- `CAPTURE-HOST-2026-06-29-BRIEF.md` §7 — the integration contract (existing vendor layouts, Clock-Contract stamps, device-id filenames, no new parser branch).
- `MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md` — where the finger+wrist cross-site pair feeds (apps only, each its own brief).
- `CLAUDE.md` §🔒 Clock Contract (host-arrival back-timing, gaps stay gaps) · §🎫 evidence badges · §🎙️ capture provenance.
- Code: `capture-host/oxyii.py` (`parse_live`, `Reassembler`), `capture-host/capture.py` (`run_oxyii` `on_data`), `capture-host/writers.py`, `capture-host/probe_oxyii.py`.
- Upstream: `github.com/nglessner/o2ring-s-protocol` (OxyII reference — PPG body undecoded).

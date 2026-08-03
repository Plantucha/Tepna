<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: POLAR-PMD-COMMAND-SURFACE-2026-08-02-BRIEF.md
---
The whole Verity research cycle, unattended, as one JSON record.

`probe_pmd_surface.py` sweeps the read-only control point; `probe_verity_offline.py` proves one write.
`probe_verity_survey.py` runs the **entire** cycle — identity, capability, an offline recording, the
PS-FTP pull, and a decode of the container that comes back — and hands over a single structured report.
The expensive part of this work was never the thinking; it was holding a flaky BLE link long enough to
ask forty questions in the right order without leaving the device recording.

**There is no reference implementation to check against.** `polarofficial/polar-ble-sdk` issue #556
("Accessing offline recording using python") is open and unanswered, and the main community library
(`zHElEARN/polar-python`) is streaming-only — no control point, no SDK mode, no offline recording, no
PS-FTP. The report therefore carries its own evidence.

**What it establishes, all verified by consequence rather than by an ACK:**

* **`.REC` is a self-describing container.** 17-byte header · ASCII `YYYY-MM-DD HH:MM:SS` at 0x11 · the
  PMD settings TLVs verbatim from the START at 0x26 · then **PMD data frames byte-identical to the live
  link**. `pmd.decode_frame` handles them unmodified — the offline path needs no new decoder. Verified
  across 15 files: 27 frames/24.1 s, 49/46.2 s, 300/281.9 s, single frame type `0x80`, stride 281 B.
* **The timebase is UTC**, measured not inferred: the file this run created stamps `13:12:58` against a
  host UTC start of `13:12:58` — **−0.3 s**. `polar_psftp` writes that field into
  `recording.meta.json` as **`start_local`**, which is a 4 h trap for anything that believes the name.
* **A consistent ~1.8–3.4 s latency** between the header stamp and the first data frame, on all 15
  files — the device's start-up cost, reproducible enough to correct for.
* **PPG offline is capped at 28/44/55 Hz** even with SDK mode on, while online offers up to 176 Hz. An
  onboard backup cannot record at the rate the live link streams.
* **SDK mode has persisted ~13 h** across many reconnects and adapter power cycles (`0x06` → final byte
  `01`), and while it is ON, op `0x01` returns the SDK menu — so "online vs sdk" collapses. Op `0x04`
  always shows the SDK menu regardless.

**Five wrong diagnoses of one error message went into building this, and each is now a guard:**

1. `Service Discovery has not been performed yet` was blamed on a stale BlueZ GATT cache → an adapter
   power cycle was added. It changed nothing. The comment now says so rather than claiming a fix.
2. Then on disconnect timing → a settle delay. Also nothing.
3. Then on the capture daemon holding the device's single link. That was **true once** and is now a
   precondition check (`daemon_holds_link()`) that turns four lost runs into one line of instruction.
4. Then on the control-point feature read costing the link — plausible, already true elsewhere, and the
   feature read now gets its own link. Still not the cause here.
5. The actual cause: an explicit `connect()` where `probe_verity_offline.py`'s **`async with
   BleakClient(...)`** works. A bare connect+read diagnostic showed 8 services and 21 characteristics on
   3 of 3 attempts, which is what finally separated "the radio is fine" from "my call shape is wrong".

The lesson is in the code: **the error string named BlueZ's state, not the call that raised it**, and
collapsing failures to `type: message` threw away the traceback that identified it in one read. The
retry path now keeps the frame, and a code bug (`AttributeError`/`TypeError`/…) aborts immediately
instead of spending three BLE windows re-running the same broken line.

Safety is unchanged in kind but stronger in practice: trigger writes `0x08`/`0x09` are unreachable, and
`stop_everything()` runs unconditionally at the end on its own links — it caught a stranded PPG
recording on two separate runs where a START landed and the link died before its stop could be
delivered, which is exactly the case a `finally` cannot cover.

capture-host only, out of suite — no bundle, no `manifestHash` movement, no fixture re-recorded.

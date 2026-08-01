# Third-Party Notices

**Tepna — Physiological-Signal Analysis Suite**
Copyright 2026 Michal Planicka · Licensed under Apache-2.0 (see `LICENSE`/`NOTICE`).

---

## Summary

Tepna bundles **no third-party source code** and (after the font change below)
**no third-party fonts** either. It makes **no network calls** — no CDNs, no web
fonts, no analytics, no telemetry. Everything runs locally from a single HTML
file per node. All charts/visuals across every node are hand-authored (inline
SVG, or the first-party canvas renderer `hrvdex-chart.js` in HRVDex) — there are
no charting-library dependencies.

| Category        | Status                                                            |
|-----------------|-------------------------------------------------------------------|
| Code libraries  | None bundled. No runtime dependencies.                            |
| Fonts           | System stacks only (see below). No `@font-face`, no CDN.          |
| Network         | None. 100% local / offline.                                       |
| Data files      | User-supplied recordings only (`uploads/`). Not redistributed.    |

---

## Code libraries

**None.** The suite has no runtime code dependencies. HRVDex's charts are drawn
by a first-party canvas renderer (`hrvdex-chart.js`, Apache-2.0); every other
node uses hand-authored inline SVG. (Historically HRVDex inlined Chart.js +
@kurkle/color (MIT); these were removed in June 2026 and replaced with the
first-party renderer, so no third-party code ships.)

---

## Fonts

The suite uses **operating-system font stacks only**. The names `Inter` and
`IBM Plex Mono` may still appear in CSS `font-family` declarations, but they
are *fallback labels* — when the named font is not installed they resolve to
`system-ui` / `ui-monospace`. **No font binaries are shipped, fetched, or
embedded.** There is therefore no font-license obligation.

> PulseDex historically embedded **IBM Plex Mono** and **Inter** woff2 binaries
> as inliner assets. Both were removed in June 2026 so PulseDex matches every
> other node (system `ui-monospace` / `system-ui`). **No third-party font
> remains** anywhere in the suite.

---

## Clinical & scientific references (NOT code dependencies)

The metrics, formulas, and thresholds implemented in the analyzers are drawn
from the peer-reviewed literature. These are **scholarly citations**, not
software dependencies, and carry no software license. The authoritative,
per-metric reference lists live in the node reference guides (e.g.
`OxyDex Reference.html`, `ECGDex Reference.html`) and in the preprints under
`papers/`. Each metric also carries an evidence grade
(measured · validated · emerging · experimental · heuristic).

---

## Vendor data formats (interoperability, not bundled code)

The parsers read files produced by third-party hardware/apps (e.g. O2Ring /
Wellue / ViATOM oximeters, Polar H10 + Verity Sense via the Polar Sensor Logger
app, NSRR EDF/XML polysomnography exports). Supporting a vendor's file *format*
is interoperability and creates no licensing obligation; no vendor code is
included.

---

## Device protocols (interoperability implementations — no vendor code included)

The **capture host** (`capture-host/`, out-of-suite — it is not part of any
shipped `Foo.html` bundle) talks to sensors directly over BLE. Those protocol
implementations are original Apache-2.0 code written for interoperability; no
vendor source is copied or redistributed.

| Protocol | Our implementation | Provenance |
|---|---|---|
| **Polar PMD** (Polar Measurement Data — streaming ECG/ACC/PPG/PPI/gyro/mag over service `FB005C80`) | `capture-host/polar_pmd.py` | Wire format per Polar's published PMD specification, distributed with the Polar BLE SDK. |
| **Polar PS-FTP** (RFC60/RFC76 framing over characteristic `FB005C51` — read-only listing + fetch of onboard recordings, and `SET_LOCAL_TIME`) | `capture-host/polar_psftp.py` | Wire format per the Polar BLE SDK's protocol definitions (`pftp_request.proto` field numbering and the RFC60/RFC76 framing rules). |
| **Wellue / ViATOM "OxyII"** (0xA5 framing, CRC-8, live SpO₂/PR + finger PPG, stored `.dat` transfer) | `capture-host/oxyii.py`, `capture-host/pull_session.py` | Reverse-engineered from device traffic; documented in `briefs/O2RING-PROTOCOL-2026-07-17-BRIEF.md`. |

**Polar BLE SDK** (`github.com/polarofficial/polar-ble-sdk`) — **not a
dependency.** It is proprietary (`spdx_id: NOASSERTION`;
`Polar_SDK_License.txt`), not an OSS licence, and Tepna does not link,
redistribute, or vendor any part of it. It is named here only because Polar's
protocol documentation ships with it and is the reference for the two rows
above. Polar's terms additionally state that its SDK and devices are "not
intended to be used in life critical, life supporting or medical purpose" —
consistent with Tepna's own non-device intended-use disclaimer.

Polar, Polar H10 and Verity Sense are trademarks of Polar Electro Oy; Wellue
and ViATOM are trademarks of their respective owners. Used for identification
only, with no affiliation or endorsement implied.

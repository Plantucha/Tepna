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
| **Polar PS-FTP over USB HID** (the same PS-FTP protobufs carried in 64-byte HID reports on the dock, `0da4:0008`) | `capture-host/probe_polar_usb.py` (read-only probe) | Framing corroborated against **`rsc-dev/loophole`** (MIT) — see the note below. |

**Polar BLE SDK** (`github.com/polarofficial/polar-ble-sdk`) — **not a
dependency.** It is proprietary (`spdx_id: NOASSERTION`;
`Polar_SDK_License.txt`), not an OSS licence, and Tepna does not link,
redistribute, or vendor any part of it. It is named here only because Polar's
protocol documentation ships with it and is the reference for the rows
above. Polar's terms additionally state that its SDK and devices are "not
intended to be used in life critical, life supporting or medical purpose" —
consistent with Tepna's own non-device intended-use disclaimer.

**`rsc-dev/loophole`** (`github.com/rsc-dev/loophole`, **MIT**, © Radoslaw
Matusiak) — **not a dependency, and no code is copied.** It is a Python
read-only file-access tool for older Polar watches over USB (A360, Loop, M400 —
and `0da4:0008` is literally the *Loop* product id our dock enumerates as). It
is cited because it independently documents the same USB framing Tepna derived
for `probe_polar_usb.py`: the `(len + 8) << 2` size/flags byte, the `len + 4`
RFC60 length, and the `[0x01, 0x05, packet_no]` host ACK. Being able to point at
an **MIT** implementation of those constants — rather than only at
`profanum429/v800_downloader` (**GPL-3.0**), which the probe consulted first —
keeps the provenance of Tepna's Apache-2.0 code clean. Protocol facts are not
themselves copyrightable, and the implementation is Tepna's own; the MIT
corroboration is belt-and-braces, not a licence grant either way.

Polar, Polar H10 and Verity Sense are trademarks of Polar Electro Oy; Wellue
and ViATOM are trademarks of their respective owners. Used for identification
only, with no affiliation or endorsement implied.

### Runtime libraries

The capture-host installs four third-party Python libraries at runtime.
`capture-host/requirements.txt` declares them. I read each licence from its
installed distribution.

| Library | Version | Licence | Purpose |
|---|---|---|---|
| **bleak** | 3.0.2 | MIT | Cross-platform BLE central; the capture daemon's radio interface. |
| **PyYAML** | 6.0.3 | MIT | Parses `config.yaml`. |
| **aiohttp** | 3.14.4 | Apache-2.0 AND MIT | The monitor and control surface (`webmon.py`): scan, bond, forget, and the live waveform stream. |
| **cryptography** | 50.0.2 | Apache-2.0 OR BSD-3-Clause | AES-256-CBC for the ResMed AS11 encrypted BLE channel (`as11_cipher.py`). |

---

## Development tools (not shipped)

These tools build, check, search and measure the repo. **No shipped `Foo.html`
bundles, links to, fetches or imports any of them.** The suite's runtime
dependency list stays empty with every one of them installed, so the summary at
the top of this file still holds.

Each version is the repo's own pin where one exists. Each licence was read from
the installed copy, from its own licence file, or from the tool's own output —
never from memory. Where no copy was available to read, the row says **not
verified** rather than quoting a licence.

### Build, lint, type and test

| tool | version or pin | licence | use | where it runs |
|---|---|---|---|---|
| **Node.js** | `>=18` (`package.json` engines); CI pins 20 and 22 | MIT (`Expat`, per the distribution's own copyright file) | runs the bundler, every gate and every tool under `tools/` | dev box · CI |
| **Biome** (`@biomejs/biome`) | 2.5.3, a `devDependency` | MIT OR Apache-2.0 | `npm run lint`, `npm run format` | dev box · CI |
| **ast-grep** (`@ast-grep/cli`) | 0.50.0, a `devDependency` | MIT (read from the installed package metadata) | `npm run verify:astgrep`, the four house rules over the syntax tree | dev box · CI |
| **Acorn** (`acorn`) | 8.18.0, a `devDependency` | MIT (read from the installed copy's own licence file) | parses a staged JS file in the write-time syntax guard | dev box |
| **TypeScript** (`tsc`) | 5.5.4, pinned inside `npm run typecheck` | Apache-2.0 | `tsc --noEmit` over the JS surface | dev box · CI |
| **Playwright** | 1.48.0, installed `--no-save` by the browser workflow | Apache-2.0 | drives the browser render-coverage gate | CI |
| **pytest** | `>=9.1.1` | MIT | the capture-host suite | capture box · dev box · CI |
| **pytest-cov** (with **coverage**) | `>=7.1.0` (coverage 7.15.2) | MIT (coverage: Apache-2.0) | the 100 % statement and branch floor | capture box · dev box · CI |
| **pytest-xdist** | `>=3.8.0` | MIT | runs that suite in parallel | capture box · dev box · CI |
| **pytest-timeout** | `>=2.4.0` | MIT | the per-test bound, so a hang still has a verdict | capture box · dev box · CI |
| **pytest-asyncio** | `>=1.4.0` | not verified | the asynchronous capture tests | capture box · dev box · CI |
| **Hypothesis** | `>=6.168.3` | MPL-2.0 | property tests over the clock surface | capture box · dev box · CI |
| **Ruff** | `>=0.16.9` | MIT | Python lint, and `ruff format` for style | capture box · dev box · CI |
| **mypy** | `>=2.3.1` | MIT | the ratcheting type gate | capture box · dev box · CI |
| **mutmut** | `==3.8.0`, pinned exactly | BSD-3-Clause | the diff-scoped mutation gate | capture box · dev box · CI |
| **ShellCheck** | 0.11.0, carried by the `shellcheck-py` wheel `>=0.11.0.1` | **GPL-3.0** (the wheel's own wrapper is MIT) | the shell lint in `capture-host/check.sh` | capture box · dev box · CI |
| **detect-secrets** | `>=1.5.0` | not verified | the secrets audit against the committed baseline | CI |

### Local search and local models

Rule 0 of this repo runs a search before any build, so this table covers what
that search uses. Each piece binds to the loopback interface and reaches no
network.

| tool | version or pin | licence | use | where it runs |
|---|---|---|---|---|
| **xerj** | v1.0.0-rc.93 | Apache-2.0 (read from its own repository; the binary prints none) | the hybrid index behind `tools/doc-search.mjs` | dev box, loopback only |
| the **local model runtime** (`ollama`) | 0.34.4 | MIT (read from its own repository) | serves the two models below | dev box, loopback only |
| **bge-m3** | the runtime's own tag | MIT (read from the model's own licence) | embeds a query and each document chunk for the search above | dev box, loopback only |
| **qwen3-coder:30b** | the runtime's own tag | Apache-2.0 (read from the model's own licence) | the local review baseline that `tools/dsp-review-qwen.mjs` measures | dev box, loopback only |

### Copyleft, and why it reaches nothing

**One tool here carries the GPL, and it runs as a separate program.** A shell
script invokes ShellCheck as a child process and reads its text output. Nothing
links against it, and no file of this repo derives from it. The capture-host tests
import Hypothesis, which carries MPL-2.0. Those tests ship in no bundle, and this
project redistributes none of them. No `Foo.html` carries a byte of any tool on
this page.

### What is left out, and why

- **Two licences stay unverified.** `capture-host/requirements-dev.txt` declares `pytest-asyncio` and `detect-secrets`, and CI installs both. Neither sits in the environment that supplied every other licence here, so this page quotes none for them.
- **GitHub's own workflow actions.** `.github/workflows/` names checkout, language setup, cache, artifact upload, dependency review and code scanning. They run inside the hosted runner. No box of this project installs them, and this page reads no licence for them.
- **A table row needs a caller.** This page lists no tool that the tracked tree never names. That rule kept a symbol indexer and a passage reranker out: neither appears anywhere in the tree today.

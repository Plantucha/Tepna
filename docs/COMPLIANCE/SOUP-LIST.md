<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# SOUP List — Software of Unknown Provenance (IEC 62304 §5.3.3, §8.1.2)

**Status:** REFERENCE (living) · **last-verified:** 2026-10-18 · Owner: Michal Planicka

> **Intended use (non-device).** Not a medical device; does not diagnose, treat, cure, or prevent any
> condition. Alignment artifact — no conformance claim.

SOUP is software included in the product but not developed to be part of it (third-party libraries,
runtimes) whose lifecycle you did not control. IEC 62304 requires it to be listed and versioned.

## 1 · Shipped (runtime) SOUP — **NONE, by design**

**The shipped product bundles no third-party code and makes no network calls** (`THIRD-PARTY.md`,
enforced by `no-network.html`):

- **Code libraries:** none. No runtime dependencies; charts are a first-party canvas renderer
  (`hrvdex-chart.js`) or hand-authored inline SVG. (Chart.js/@kurkle removed June 2026.)
- **Fonts:** operating-system stacks only. No `@font-face`, no font binaries, no CDN.
- **Network:** none. 100% local/offline; no CDNs, analytics, or telemetry.

This zero-runtime-SOUP posture is a deliberate architectural property, not an accident, and is
gate-verified (`no-network.html` static egress grep + runtime trap + negative-control canary). It is
the strongest SOUP position a browser app can hold.

**§1 covers what ships, and nothing else.** The capture-host is a separate
program that never reaches a bundle, and §3 lists the libraries it installs.

## 2 · Runtime platform (not bundled SOUP, recorded for completeness)

- **The user's web browser** — the execution platform. Not shipped by us; standard evergreen browser
  APIs only. No specific vendor/version is required.

## 3 · Capture-host runtime SOUP (a separate program, in no bundle)

The capture-host (`capture-host/`) is the Python daemon that records from the
sensors. It runs on the capture box as `tepna-capture.service`, which is neither
a browser nor a developer or CI machine. No released bundle links to, fetches or
imports any of it. Its libraries are still runtime SOUP **for that program**, so
62304 §5.3.3 asks for them by version.

`capture-host/requirements.txt` declares four. Those four pull in eleven more,
which makes a closure of fifteen distributions. **`THIRD-PARTY.md` § Runtime
libraries carries both tables.** It names each version, the host and venv it came
from, and the date. The licences across the closure are MIT, MIT-0, BSD-3-Clause,
Apache-2.0 and PSF-2.0 — permissive throughout, with no copyleft anywhere.

| Item | Role | Version (capture box, read 2026-10-18) |
|---|---|---|
| **bleak** | BLE central — the daemon's radio interface | 3.0.2, MIT |
| **PyYAML** | Parses `config.yaml` | 6.0.3, MIT |
| **aiohttp** | Monitor and control surface (`webmon.py`) | 3.14.3, Apache-2.0 AND MIT |
| **cryptography** | AES-256-CBC for the ResMed AS11 channel (`as11_cipher.py`) | 50.0.0, Apache-2.0 OR BSD-3-Clause |
| *eleven transitive distributions* | Dependencies of the four above | `THIRD-PARTY.md` § The runtime closure |
| **CPython** | The daemon's platform — the counterpart to §2's browser | 3.14.4 on the box, PSF-2.0 |

`requirements.txt` is the version policy for the four. One floor there goes
unmet on the box today, and `briefs/RESIDUE.md` logs that as
`2026-10-18-the-cryptography-floor-is-met-by-neither-venv`.

Adding a third-party runtime dependency to the capture-host means adding a row
here and a row in `THIRD-PARTY.md`.

## 4 · Build/test-time tooling (does NOT ship in any bundle)

These run only on a developer/CI machine and are absent from every released bundle:

| Item | Role | Version policy |
|---|---|---|
| **Node.js** | Runs `tools/build.mjs`, `tests/run-tests.mjs`, `tools/release.mjs`, `verify-manifest.mjs` | Any maintained LTS; no pinned native deps |
| **The bundler** | Inlines source into standalone bundles | **Repo-owned** (`tools/build.mjs`) — not third-party, not SOUP |

There are **no `node_modules` runtime dependencies** to enumerate: the tooling uses only the Node
standard library. If a third-party build/test dependency is ever added, it must be added to this
table with its version and purpose.

**The full build/test-time list lives in `THIRD-PARTY.md` § Development tools (not shipped)**, which
names every such tool with its version or pin, its licence and the machines it runs on. The two
entries above cover what runs the bundler itself; that section covers the lint, type, test, mutation,
search and model tooling as well. Neither list reaches a bundle.

## 5 · Clinical references are NOT SOUP

Formulas and thresholds are drawn from peer-reviewed literature (`THIRD-PARTY.md` §Clinical). These
are scholarly citations carrying no software license — not software dependencies.

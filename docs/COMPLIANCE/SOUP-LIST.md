<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# SOUP List — Software of Unknown Provenance (IEC 62304 §5.3.3, §8.1.2)

**Status:** REFERENCE (living) · **last-verified:** 2026-07-05 · Owner: Michal Planicka

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

## 2 · Runtime platform (not bundled SOUP, recorded for completeness)

- **The user's web browser** — the execution platform. Not shipped by us; standard evergreen browser
  APIs only. No specific vendor/version is required.

## 3 · Build/test-time tooling (does NOT ship in any bundle)

These run only on a developer/CI machine and are absent from every released bundle:

| Item | Role | Version policy |
|---|---|---|
| **Node.js** | Runs `tools/build.mjs`, `tests/run-tests.mjs`, `tools/release.mjs`, `verify-manifest.mjs` | Any maintained LTS; no pinned native deps |
| **The bundler** | Inlines source into standalone bundles | **Repo-owned** (`tools/build.mjs`) — not third-party, not SOUP |
| **bleak** | Capture-host BLE central (radio interface) | 3.0.2, MIT — declared in `capture-host/requirements.txt` |
| **PyYAML** | Capture-host config parsing (`config.yaml`) | 6.0.3, MIT — declared in `capture-host/requirements.txt` |
| **aiohttp** | Capture-host monitor and control surface (`webmon.py`) | 3.14.4, Apache-2.0 AND MIT — declared in `capture-host/requirements.txt` |
| **cryptography** | Capture-host AES-256-CBC for the ResMed AS11 channel (`as11_cipher.py`) | 50.0.2, Apache-2.0 OR BSD-3-Clause — declared in `capture-host/requirements.txt` |

There are **no `node_modules` runtime dependencies** to enumerate: the tooling uses only the Node
standard library. If a third-party build/test dependency is ever added, it must be added to this
table with its version and purpose.

**The full build/test-time list lives in `THIRD-PARTY.md` § Development tools (not shipped)**, which
names every such tool with its version or pin, its licence and the machines it runs on. The two
entries above cover what runs the bundler itself; that section covers the lint, type, test, mutation,
search and model tooling as well. Neither list reaches a bundle.

## 4 · Clinical references are NOT SOUP

Formulas and thresholds are drawn from peer-reviewed literature (`THIRD-PARTY.md` §Clinical). These
are scholarly citations carrying no software license — not software dependencies.

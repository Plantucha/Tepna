<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Tepna — Test Suite

Two runners, **one set of assertions** (`tests/dex-tests.js`):

| Runner | Command | What it covers |
|---|---|---|
| **Node (CI gate)** | `node tests/run-tests.mjs` | All logic + export-completeness + static/mirror checks. Headless, zero deps, exit 0/1. The GitHub-Actions gate. |
| **Browser** | open `Dex-Test-Suite.html` | Everything above **plus render-coverage** (drives real app bundles in an iframe and confirms computed values reach the DOM). |

## Run locally

```bash
node tests/run-tests.mjs        # → "✓ all N assertions passed", exit 0
```

Requires Node ≥ 18 (uses built-in `node:vm`, `node:fs`). No `npm install`.
The browser modules are loaded into a `vm` sandbox with minimal
`window` / `document` / `localStorage` shims — the same globals the apps
assign to — so the **real source files** are exercised, not copies.

## GitHub Actions

`.github/workflows/tests.yml` runs the Node suite on every push / PR.
A red assertion fails the job (exit 1); a load error exits 2.

## What is checked

1. **Clock Contract** — `parseTimestamp`: ms-fraction (the June-2026 fix),
   zoned / no-zone, DMY vs MDY, vendor O2Ring format, time-only midnight-roll,
   `garbage → null` (never fabricate `now()`), viewer-timezone independence.
2. **Cross-night significance (#1)** — a CI that *touches* 0 is **not** significant
   (the boundary fix), both as pure logic and through the live envelope.
3. **Cross-night baseline (#7)** — `crossNight()` publishes `baselineMean/Sd`; the
   z-score reconstructs from them; the envelope surfaces them.
4. **Integrator window (#2/#3)** — `adaptEnvelopeNode` honors `recording.durationMin`
   so a sparse node no longer collapses to a zero-length window / `nodesExcluded`.
5. **Integrator HRV consensus (#5)** — a motion-trashed low-quality source is pruned
   instead of fabricating a false "divergent" verdict.
6. **Metric registry** — disclosure tiers (`visibleAtTier`), non-hue evidence
   `badge()`, shared `dex_depth_tier` persistence.
7. **Envelope integrity** — `evidence` passes through; the export survives a JSON
   round-trip; `validate()` passes; no `NaN`/`Infinity` anywhere.
8. **Export completeness** — real exports in `tests/fixtures/` are validated against
   their contract: required fields present & finite, every `ganglior_event` is
   `{t:"HH:MM:SS", impulse, node, conf∈[0,1]}`, and where `tMs` is present it
   **agrees with `t`** under `getUTC*` (proves the floating clock on real data).
9. **Static / mirror consistency** — the duplicated `parseTimestamp` mirrors all
   handle fractional seconds; **no** source reintroduces the `(ci[0]>0)===(ci[1]>0)`
   boundary bug; no parser fabricates `now()`.

## Fixtures

`tests/fixtures/*.json` are committed copies of real node exports (so CI does not
depend on `uploads/`). Add more by dropping a `*.json` in that folder — the runner
auto-discovers them and applies the matching contract (node-export, OxyDex
night-array, slim ganglior-events, or fusion).

## Adding a test

Edit `tests/dex-tests.js` only — both runners pick it up. Keep assertions pure
(no DOM): the runner passes a ready `env` with the loaded modules, the fixture
JSON, and the source text. Render-coverage (DOM) assertions live in
`Dex-Test-Suite.html`.

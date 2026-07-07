<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: DEV-TOOLCHAIN-2026-06-30-BRIEF.md
---
Add the DSP reach-in allow-list gate (DEV-TOOLCHAIN Part A · A4, folding in SIGNAL-ADAPTER-FOLLOWUPS-IV §1) — a source-text house-lint in `tests/dex-tests.js` that scrubs comments/strings/regex with a real char-scanner, then asserts each `*-dsp.js` calls only {self · kernel · own `*-util` · builtins · documented reach-ins}; oxydex/hrvdex render-path reach-ins are allow-listed as a named drift-ledger for the next on-touch re-bundle. Test-layer only, no re-bundle, provenance untouched.

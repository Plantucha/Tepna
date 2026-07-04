<!--
  EXPORT-IDENTITY-FOLLOWUPS-IV-2026-06-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-29 · **Created:** 2026-06-29 · **Follows:** `EXPORT-IDENTITY-FOLLOWUPS-III-2026-06-29-BRIEF.md` · **Follow-up:** `EXPORT-IDENTITY-FOLLOWUPS-V-2026-06-29-BRIEF.md`

# Export identity — follow-ups IV (residue from gate-backing the Integrator dedup + the drift reframe)

> **Closed in the parent (-III, 2026-06-29):** §1 — the Integrator `contentId` dedup is now **gate-backed**
> in `tests/dex-tests.js` (the P1 dedup group, both runners: carries `recording.contentId`; same-contentId
> dedups across a >30 s stamp gap; different-contentId at the same stamp is kept; no-contentId exercises the
> back-compat fallback). Test-only, no re-bundle. §3/§4/§5 documented / standing. The parent's §2 (continuous
> manifestHash-drift detection) was REFRAMED on execution as a provenance/Node-CI item, NOT a behavior-suite
> add — carried here as §1.

---

## §1 — ⚠ Continuous `manifestHash`-drift detection (MEDIUM — the reframed -III §2)

**Why this exists:** EXPORT-IDENTITY-FOLLOWUPS-II *found* a PRE-EXISTING drift — at that session's start
`BUILD-MANIFEST` recorded CPAPDex `54cc94bfcdcb` / Integrator `ab5333eb44e5`, but the on-disk bundles hashed
`17315542928f` / `ab16c10c1ae5`, so verify-provenance **GATE A was silently red on both** for some unknown
window (a prior re-bundle didn't hand-update `BUILD-MANIFEST`, or vice-versa). It was only caught because -II
happened to recompute every bundle's `manifestHash` headlessly. **Nothing catches this class continuously** —
GATE A only bites when a human opens `verify-provenance.html`, and that page can't run under Node CI (the
runtime can't see its own manifest; the static `manifestHashOf` is browser-fetch based).

**Do:** add a headless/CI check that, for all 8 bundles, asserts
`manifestHashOf(Foo.html) === BUILD-MANIFEST.bundles['Foo.html'].manifestHash` (the SHA-256[0:12] of the
file's `__bundler/manifest`), exiting non-zero on any mismatch — so "re-bundled but forgot `BUILD-MANIFEST`"
(or edited the manifest without re-bundling) reds automatically. Likely shapes:
- **(a)** a tiny standalone Node script (`fs.readFile` each bundle + `crypto.subtle`/`createHash` the manifest
  body) wired into the same CI entry as `tests/run-tests.mjs` — cleanest, no browser; OR
- **(b)** factor verify-provenance's GATE-A core (`manifestHashOf` + the committed-compare) into a module both
  the page AND a Node runner import.

**Gate separation (CLAUDE.md):** keep this in the PROVENANCE lane (verify-provenance / its Node sibling), NOT
in `Dex-Test-Suite.html` — "Behavior is gated separately." Do NOT recompute bundle hashes inside the behavior
suite. (This is distinct from the standing `env.equiv` Node-CI debt at `SIGNAL-ADAPTER-FOLLOWUPS-XII §3`,
which is about *re-running compute()*; this is about *bundle↔manifest consistency*. They can share one CI
entry but are different assertions.)

## §2 — Real-EDF CPAP fixtures: confirm by EDF re-run (LOW — verify-don't-trust, carried from -III §3)

`cpapdex-2026-06-12` (`f883a8667665`) and `cpapdex-2026-06-16` (`aa93a4748331`) had `recording.contentId`
**reconstructed from their committed `recording.sessions[]`** (binary multi-file EDF can't drive a headless
`{text}` re-run here). It is faithful — the reconstruction formula was cross-checked equal to the live
`cpapBuildExport` fold on the synthetic golden (built==recon) — but the gold path is a real
`readEDF → buildSessionFromEdf → buildNight → cpapBuildExport` re-run on the committed EDF set. If a host with
the committed `*.edf` files is available, re-run and confirm only-delta `recording.contentId` (same values).

## §3 — Carried-forward (standing / product-gated — pointers, not re-opened here)
- **In-payload `generated:new Date().toISOString()`** non-determinism — `EXPORT-HYGIENE-FOLLOWUPS-II §2`.
- **§3 opt-in pseudonymous subject key** — UNBUILT by design (`-II §4(a)` decision: ride the implicit local
  grouping first; build only on a concrete cross-device longitudinal requirement, strippable-UUID-only).
- **§4(b) HIPAA/GDPR sign-off** — external human/legal call; `PHI-SURFACE-STATEMENT.md` is the evidence pack.
- **Node-CI `env.equiv` literal `node tests/run-tests.mjs`** — standing debt, `SIGNAL-ADAPTER-FOLLOWUPS-XII §3`.

## Definition of done
§1 (continuous manifestHash-drift check in the provenance/Node-CI lane) is the one actionable engineering
item. §2 is verify-don't-trust (host-gated). §3 is product/standing-gated and may stay open indefinitely. If
§1 lands with nothing new surfacing, say so in this header rather than spawning an empty `-V`.

**Executed 2026-06-29:** §1 DONE — landed in the PROVENANCE/Node-CI lane, gate-separated from the behavior
suite. NEW `manifest-gate.js` single-sources the GATE-A core (the canonical 8-bundle list, the
UUID-independent `manifestHash` PROJECTION — drop random UUID keys, hash each asset's DECOMPRESSED bytes,
sort, SHA-256[0:12] — per PROVENANCE-NONDETERMINISM §1, and the committed-vs-current compare). It is consumed
by BOTH (a) `verify-provenance.html`, refactored to DELETE its inline `_b64ToBytes`/`_sha256bytes`/`_gunzip`/
`manifestHashOf` body + hardcoded bundle list and delegate to the shared module (the `provenance-banner.js`
single-source precedent, so page ↔ CI can't drift); and (b) a NEW headless Node sibling
`tests/verify-manifest.mjs` (zero-dep, Web Crypto + `DecompressionStream`, exit ≠ 0 on any drift/missing),
wired as a SEPARATE step AFTER `run-tests.mjs` in `.github/workflows/tests.yml` — "same CI entry, different
assertion" (the bundle-hash recompute stays OUT of `dex-tests.js` / `Dex-Test-Suite.html`). `manifest-gate.js`
added to `tsconfig.json`. VERIFIED live: `verify-provenance.html` GATE A = 8/8 match, now computed by the
shared module (proving the projection is byte-identical to the canonical one and consistent with the committed
ledger); no console errors. §2/§3 carried (verify-don't-trust / standing). Discovered + fixed in passing:
`tests/run-tests.mjs` carried its `#!/usr/bin/env node` shebang on a NON-FIRST line (after the license block)
→ a `SyntaxError` under `node` that would kill BOTH tests.yml steps — moved to line 1. Residue (Node-host
re-run of both runners; a `manifestHash` projection-stability observation) → spawned
`EXPORT-IDENTITY-FOLLOWUPS-V-2026-06-29-BRIEF.md`.

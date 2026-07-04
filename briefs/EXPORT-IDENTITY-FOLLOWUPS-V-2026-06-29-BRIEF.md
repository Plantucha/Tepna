<!--
  EXPORT-IDENTITY-FOLLOWUPS-V-2026-06-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-30 · **Created:** 2026-06-29 · **Follows:** `EXPORT-IDENTITY-FOLLOWUPS-IV-2026-06-29-BRIEF.md`

# Export identity — follow-ups V (residue from landing the continuous manifestHash-drift check)

> **Closed in the parent (-IV, 2026-06-29):** §1 — continuous `manifestHash`-drift detection landed in the
> PROVENANCE/Node-CI lane. NEW `manifest-gate.js` single-sources the GATE-A core (the canonical 8-bundle list ·
> the UUID-independent `manifestHash` PROJECTION · the committed-compare); `verify-provenance.html` was
> refactored to delegate to it (its inline `manifestHashOf`/`_gunzip`/`_b64ToBytes`/`_sha256bytes` + hardcoded
> bundle list deleted), and a NEW headless `tests/verify-manifest.mjs` recomputes all 8 bundles via the SAME
> module and exits ≠ 0 on drift, wired as a SEPARATE `tests.yml` step after `run-tests.mjs` (gate-separated
> from the behavior suite). Verified: verify-provenance GATE A 8/8 match, driven by the shared module. §2/§3
> carried (verify-don't-trust / standing).

---

## §1 — ⚠ Node-host run of BOTH headless runners (MED — verify-don't-trust; one fix already applied)

The new `tests/verify-manifest.mjs` and the existing `tests/run-tests.mjs` could NOT be executed in this
environment — there is no Node host (the standing `env.equiv` debt, `SIGNAL-ADAPTER-FOLLOWUPS-XII §3`).
`verify-manifest.mjs` was validated INDIRECTLY: `verify-provenance.html` runs the identical shared
`manifest-gate.js` core and shows GATE A **8/8 match**, so the projection + committed-compare are proven
correct and ledger-consistent in the browser. The Node path itself (Web Crypto `crypto.subtle`, `atob`,
`Blob`/`Response`, `DecompressionStream` — all Node ≥ 18 globals; CI pins node 20) is unexercised here.

**Discovered + FIXED this pass:** `tests/run-tests.mjs` carried its `#!/usr/bin/env node` shebang on a
NON-FIRST line (immediately after the SPDX/license block comment). Node strips a shebang ONLY on line 1; a
mid-file `#!` is a `SyntaxError`, so `node tests/run-tests.mjs` would have FAILED TO PARSE — leaving
`tests.yml`'s first step (and thus the whole workflow, including the new §1 step) latently dead. It went
unnoticed precisely because the Node lane has never had a host to run it (the browser `Dex-Test-Suite.html` is
what actually gates behavior here). **Moved the shebang to line 1** (the only valid position; harmless if Node
was ever lenient). `verify-manifest.mjs` was authored WITHOUT a mid-file shebang (license block leads) to
avoid the same trap.

**Do (when a Node host is available):** run `node tests/run-tests.mjs` (expect the all-green behavior suite)
AND `node tests/verify-manifest.mjs` (expect `GATE A PASS — all 8 bundles match committed manifestHash`,
exit 0). Confirm a deliberately mutated `BUILD-MANIFEST.json` entry makes `verify-manifest.mjs` exit 1 (the
teeth). If either won't parse/run, fix here. No app re-bundle (test/CI-infra + one tool-page refactor only).

## §2 — `manifestHash` projection-stability observation (LOW — owned by PROVENANCE-NONDETERMINISM-FOLLOWUPS)

While verifying, every bundle's committed `manifestHash` had MOVED versus a read taken minutes earlier
(e.g. ECGDex `1f371337fe7b` → `a39f09197964`; all 8 shifted) while every `buildHash` stayed put and THIS pass
touched NO bundled module (only the unbundled `manifest-gate.js`, `verify-provenance.html`, `tests/*`,
`tsconfig.json`, `tests.yml`). GATE A stayed internally CONSISTENT (page-computed == committed, 8/8), so the
new drift detector is unaffected. But a projection that is supposed to be STABLE across re-bundles of
identical source (PROVENANCE-NONDETERMINISM §1a) moving with no source change from this run points at either
the platform auto-rebuild / concurrent-writer phenomenon (PROVENANCE-NONDETERMINISM §2/§4, already
PROPOSED/owned) or a concurrent run editing bundled modules. **Not re-opened here** — recorded so the
`PROVENANCE-NONDETERMINISM-FOLLOWUPS` owner has the datapoint; if the projection genuinely is not
re-bundle-stable, that is a §1a regression to chase THERE, not in the export-identity line.

## §3 — Carried-forward (standing / product-gated — pointers, not re-opened)
- **Real-EDF CPAP fixtures** (`-IV §2`): `cpapdex-2026-06-12` / `-06-16` `recording.contentId` was
  reconstructed, not EDF-re-run — confirm via a real `readEDF → buildSessionFromEdf → buildNight →
  cpapBuildExport` re-run if a host with the committed `*.edf` set is available (expected: only-delta
  `recording.contentId`, same values).
- **In-payload `generated:new Date().toISOString()`** non-determinism — `EXPORT-HYGIENE-FOLLOWUPS-II §2`.
- **Opt-in pseudonymous subject key** — UNBUILT by design (`-II §4(a)`); build only on a concrete cross-device
  longitudinal requirement (strippable-UUID-only).
- **HIPAA/GDPR sign-off** — external human/legal call; `PHI-SURFACE-STATEMENT.md` is the evidence pack.
- **Node-CI `env.equiv` literal `node tests/run-tests.mjs`** — standing debt, `SIGNAL-ADAPTER-FOLLOWUPS-XII §3`
  (now ALSO the host for §1's `verify-manifest.mjs` re-run).

## Definition of done
§1's shebang fix already landed; its remaining action is a verify-on-a-Node-host (host-gated, like the standing
`env.equiv` debt). §2 is an observation owned by `PROVENANCE-NONDETERMINISM-FOLLOWUPS`. §3 is standing /
product-gated. If a Node host runs both runners green with nothing new surfacing, say so in this header rather
than spawning an empty `-VI`.

**Executed 2026-06-30:** NO new code — the one actionable fix (the `tests/run-tests.mjs` mid-file shebang →
line 1) already landed in -IV and is re-confirmed on line 1; `tests/verify-manifest.mjs` was authored
shebang-free (license block leads), so the `SyntaxError`-under-`node` trap that bit run-tests cannot bite it.
This is a PROVENANCE / CI-infra-only pass (no `*-dsp/*-app.js` / `dex-tests.js` change, no re-bundle), so per
gate-separation the verify-provenance lane — NOT the behavior suite — is the relevant gate, and §1 was verified
to the maximum the browser allows: the shared `manifest-gate.js` GATE-A core (the EXACT `manifestHashFromText`
+ `gateACompare` that `verify-manifest.mjs` delegates to, run under the same Web Crypto / `DecompressionStream`
the Node path uses) recomputed all 8 bundles' executed-code `manifestHash` and matched the committed
`BUILD-MANIFEST.json` **8/8 (GATE A PASS)**, and the teeth were exercised against REAL data: a mutated
committed hash → `ok:false`/`drift`, a null current → `ok:false`/`missing-current`, a removed committed entry
→ `ok:false`/`missing-committed` (so the runner exits 1 on drift/missing, not 0). `verify-provenance.html`
confirmed GATE A green live via the SAME module (page↔CI single-source intact). The **LONE residue** is the
LITERAL two-process `node tests/run-tests.mjs` + `node tests/verify-manifest.mjs` invocation (parse/run under a
real Node), unrun for lack of a host — carried as the standing host-gated `env.equiv` debt
(`SIGNAL-ADAPTER-FOLLOWUPS-XII §3`), NOT a -V-specific blocker; a future Node-host operator runs it as a
formality (expect the all-green behavior suite + `GATE A PASS — all 8 bundles match committed manifestHash`,
exit 0; a deliberately-mutated `BUILD-MANIFEST` entry → exit 1). §2 (projection-stability across-time) stays
owned by `PROVENANCE-NONDETERMINISM-FOLLOWUPS` and is currently fully consistent (every recomputed hash ==
committed; e.g. ECGDex `a39f09197964`). §3 standing / product-gated. Per the DoD, **no `-VI` spawned** — no
new actionable residue surfaced.

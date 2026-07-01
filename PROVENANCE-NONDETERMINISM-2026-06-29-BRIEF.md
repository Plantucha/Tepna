<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-06-29 · **Created:** 2026-06-29 · **Surfaced-by:** executing `OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-II-2026-06-29-BRIEF.md` §1/§3 + `CPAPDEX-PHASE9-FOLLOWUPS-IV-2026-06-28-BRIEF.md` §2 (the paired CPAPDex/Integrator re-bundle) · **Relates:** `GENERATOR-FOLLOWUPS-II-BRIEF.md` §1 (the buildHash-strength path, deliberately not taken), CLAUDE.md "Re-bundle checklist" + "Provenance gate", `verify-provenance.html`, `BUILD-MANIFEST.json`, `FIXTURE-PROVENANCE.json`

# Provenance-gate non-determinism — the inliner's random manifest keys + platform auto-rebuild make `manifestHash` a moving target

> Surfaced while executing the paired CPAPDex/Integrator event-lexicon pass (one re-bundle each). **The pass
> itself is DONE and both gates are green right now** — this brief is the **tooling residue**: hard,
> reproduced evidence that the `manifestHash` GATE A/B scheme rests on an assumption — *"re-bundling
> identical source yields an identical hash"* — that is **FALSE** in this environment, plus a second
> mechanism (platform auto-rebuild) that drifts the ledgers with **zero human action**, plus a
> concurrent-edit hazard. None is a behaviour bug; all are **provenance-reliability** problems. **Verify,
> don't trust — every claim below has a reproduction you can re-run.**

## 0 · Why this matters — the false assumption under GATE A/B
CLAUDE.md ("Re-bundle checklist" + "Provenance gate") treats `manifestHash` as the **executed-code
fingerprint**: GATE A asserts a bundle's *current* `manifestHash` == the value committed in
`BUILD-MANIFEST.json`; GATE B (`FIXTURE-PROVENANCE.json`) says a fixture *"turns red the moment the code
that made it changes."* Both assume `manifestHash` is a **stable function of the bundled source**. It is
not — see §1. The symptom is **already in-tree**: `FIXTURE-PROVENANCE.json` is full of
**"manifestHash re-recorded … EXPORT-INERT, byte-identical, NOT regenerated"** notes. Every one of those is
a re-record forced by a re-bundle that changed the hash **without** changing exported content — i.e. the
non-determinism leaking through, paid down by hand, over and over.

## 1 · `super_inline_html` keys every manifest asset by a RANDOM UUID → `manifestHash` is non-deterministic
**Evidence (reproduced this session):** re-bundling the SAME unchanged `PulseDex.src.html` **twice**
produced `manifestHash` `4b6ceb289138` then `1b12d2897389` — different from one run to the next. The
manifest payload is `{"<uuid>":{"mime":…,"compressed":true,"data":"H4sI…"}}` and `<uuid>` is freshly
generated per build (committed bundles carry them too: PulseDex `3ed09681-…`, OxyDex `f8d642ca-…`; a fresh
re-bundle `c5d45b36-…`). `manifestHash` = `SHA-256[0:12]` of the **raw manifest-script inner text**
(method **validated**: a static recompute of the UNTOUCHED PulseDex bundle reproduced its committed
`416d161be0be` exactly — the hashing is correct; the *inputs* carry random UUIDs). So `manifestHash`
fingerprints **the build event, not the source**.

- **Consequence for GATE B:** *"reds when the code changes"* is in reality *"reds on ANY re-bundle"* (incl.
  a no-op). Every byte-identical re-bundle forces a fixture re-record (the EXPORT-INERT notes). The
  executed-code teeth CLAUDE.md advertises are weaker than stated.
- **Do (decide + document — pick one):**
  - **(a) Make the fingerprint deterministic WITHOUT owning the inliner (recommended).** Redefine
    `manifestHash` (in `verify-provenance.html` `manifestHashOf()` **and** the recording workflow) to hash a
    **UUID-independent projection** of the manifest: `JSON.parse` the manifest, drop the UUID keys, sort the
    assets by a stable logical key (the asset's resource name if the bootstrap loader maps it; else by the
    `data` payload itself), and `SHA-256[0:12]` the concatenation of `{key + decompressed-bytes}`. That value
    is invariant across re-bundles of identical source → GATE A/B regain genuine "code changed" teeth and the
    EXPORT-INERT re-record churn disappears. Update CLAUDE.md's definition + the re-bundle checklist, then
    recompute the whole fleet's `BUILD-MANIFEST`/`FIXTURE-PROVENANCE` once under the new definition.
  - **(b) Make the inliner emit deterministic keys** (content-hash each asset instead of `crypto.randomUUID()`)
    — the clean root fix, but it requires **owning `super_inline_html`**, which the suite does not (per
    `GENERATOR-FOLLOWUPS-II §1`, the inliner-bootstrap path is deliberately not taken). Record as the ideal
    if inliner ownership ever lands; otherwise infeasible.
  - **(c) Accept + document** (status quo). Keep re-recording after every re-bundle, but update CLAUDE.md to
    say plainly that `manifestHash` fingerprints the BUILD, not the SOURCE — so GATE B over-fires by design and
    an EXPORT-INERT re-record is mandatory **and** content-meaningless. Weakest; choose only if (a) is infeasible.

## 2 · The platform AUTO-REBUILDS bundles → `manifestHash` drifts with no explicit re-bundle
**Evidence:** an explicit `super_inline_html CPAPDex.src.html → CPAPDex.html` produced `17315542928f`; a
**later read with no explicit re-bundle by the agent** showed `d79dbbfb0095`, then stayed there. Two reads
2.5 s apart were identical, so it is **not** a per-read race — it is a **one-shot async rebuild that
settles**. PulseDex (source unchanged all session) never drifted. Best explanation: a build-on-change
watcher re-inlines an app after its `*.js`/`.src.html` changes, asynchronously, with fresh UUIDs (§1).

- **Consequence:** after ANY source edit, the affected bundle's `manifestHash` moves on the watcher's
  schedule — **out from under** a hand-recorded `BUILD-MANIFEST.json` value → GATE A can go RED with zero
  human action. This is the mechanism behind §3's fleet-wide drift.
- **Do (characterize + document the safe sequence):** determine empirically whether the platform
  auto-rebuilds, and whether it ALSO rewrites `BUILD-MANIFEST.json`/`FIXTURE-PROVENANCE.json` (this session
  the ledgers got synced to current hashes **without a successful manual edit by the agent** — see §4 — which
  hints the platform or a parallel run maintains them). Then:
  - if the platform maintains the ledgers → CLAUDE.md's manual re-record steps are redundant and *racing*;
    replace them with *"let the build settle, then VERIFY GATE A/B; do not hand-edit the ledger."*
  - if it does NOT → document the required ordering: **finish all source edits → wait for the watcher to
    settle → read the FINAL `manifestHash` → record → make no further source edit.** Recording before settle
    guarantees a stale value (recording `17315542928f` here would have been wrong within minutes).

## 3 · Fleet-wide ledger drift was LIVE mid-session (then re-synced) — the smoking gun for §1+§2
**Evidence:** at one point this session, 5 of 8 committed bundles' current `manifestHash` ≠ their
`BUILD-MANIFEST.json` value — OxyDex `41df56c485db`→`2ee967d6b537`, ECGDex `31f3e879d5c0`→`1f371337fe7b`,
GlucoDex `ec1eec8b3c5d`→`294ce446bb32`, PpgDex `4e84f492e091`→`e954eed9d12a`, HRVDex `bd66ba23ae09`→
`1ab25fc2df96`; only untouched PulseDex matched. Later in the **same session** all 8 matched again (ledgers
re-synced by §4's actor). **GATE A was transiently RED fleet-wide with no behaviour change** — exactly the
§1+§2 failure mode caught in the act. No action of its own (subsumed by §1/§2); recorded as proof it bites.

## 4 · Concurrent activity / ledger-authorship ambiguity
**Evidence:** `integrator-dsp.js` had `cvhr_surge` in the surge `gather()` early in the session and was
**already dropped** later — with no edit by this agent in between. `BUILD-MANIFEST.json` showed the OLD
CPAPDex/Integrator hashes early and the SYNCED current hashes later — again with no *successful* manual edit
by this agent (the manual edit FAILED precisely because the values were already correct). So **something
else wrote these files during the session** — a parallel/continuing run of the same task, or the platform's
build pipeline.

- **Consequence:** two writers race the same files; a run cannot assume a read reflects its own last write;
  *"did I change this, or did something else?"* is unanswerable from inside one run.
- **Do:** establish whether multiple agent runs / build pipelines touch this workspace concurrently. If yes,
  define an ownership/serialization convention (one run per task, or an advisory lock) and add a CLAUDE.md
  rule: *"bundles + ledgers may be rewritten out-of-band — re-read before you trust, never assume a value you
  recorded is still current, and re-verify ground truth before editing."* (This run lost ~half its budget to
  re-deriving state that early reads had shown stale.)

## 5 · `buildHash` is RUNTIME-helper-only, not statically recomputable from the template text (doc trap)
**Evidence:** `SHA-256[0:12]` of the raw `__bundler/template` inner text gives `89b657bccb77` for the
untouched PulseDex bundle, but its committed `buildHash` is `17ee0d96c509`. `verify-provenance.html` reads
`buildHash` from the **runtime helper** (`GangliorProvenance.buildHash()`, by booting the bundle in an
iframe), which parses/normalizes the template (stored JSON-encoded: `"<!DOCTYPE html>…"` with escapes)
rather than hashing the raw script text. By contrast `manifestHash` IS the raw-inner `SHA-256` (validated by
the PulseDex match). The page's own prose hint *"or hash the `__bundler/template` as this page does"* is
**misleading** — the page does not hash the raw text.
- **Do (cheap doc fix):** correct the `verify-provenance.html` prose + CLAUDE.md to state: `buildHash` is
  obtained ONLY by booting the bundle and reading `GangliorProvenance.buildHash()` (or by replicating its
  exact JSON-parse-then-hash normalization — record the algorithm); `manifestHash` is the static
  `SHA-256[0:12]` of the manifest script's **raw** inner text. Prevents the next coder recording a wrong
  `buildHash`.

## Execution (2026-06-29 — §1 option (a))
**Decision: option (a)** — redefine `manifestHash` to a UUID-independent projection. (Option (b) — make
the inliner emit deterministic content-hash keys — is the clean root fix but requires OWNING
`super_inline_html`, which the suite does not, per GENERATOR-FOLLOWUPS-II §1, so it is infeasible; option
(c) accept+document is the weakest.) Landed as a pure **TEST/LEDGER/DOC pass — zero app re-bundle**; both
gates green **by construction** (GATE A 8/8 · GATE B 13/13):
- **§1** `verify-provenance.html` `manifestHashOf()` rewritten: `JSON.parse` the `__bundler/manifest`, **drop
  the random UUID keys**, gunzip each asset, SHA-256 the **DECOMPRESSED** bytes (tagged `mime\0compressed`),
  **sort** (order-independent), SHA-256[0:12] the join → a pure function of the bundled JS/CSS. PROVEN
  deterministic: a scratch re-bundle of unchanged PulseDex drifted the OLD raw-inner hash
  `416d161be0be`→`5695f0b0eba4` (brief §1 reproduced) while the NEW projection held `eba6b7d3dcf9`≡`eba6b7d3dcf9`.
  Fleet `BUILD-MANIFEST.json` (8 bundles) + `FIXTURE-PROVENANCE.json` (13 fixtures) recomputed ONCE under
  the new definition; `_doc` + a new `_note_provenance_nondeterminism` added to both. `manifestHashOf()` is
  the SOLE recompute site (grep-confirmed — `tests/dex-tests.js` only checks 12-hex shape + valid JSON, never
  recomputes), so no second algorithm to keep in sync.
- **§2/§4** CLAUDE.md "Re-bundle checklist" gained the **record-after-settle** sequence (finish edits → let the
  async auto-rebuild settle → RE-READ the final `manifestHash` → record) + a **"re-read before you trust"**
  rule (ledgers may be rewritten out-of-band by the pipeline / a concurrent run — re-derive ground truth;
  if GATE A/B already reconcile, do NOT hand-edit the ledger).
- **§5** the misleading CI-recipe hint "or hash the `__bundler/template` as this page does" removed from
  `verify-provenance.html` (it does not); CLAUDE.md now states `buildHash` is RUNTIME-helper-only (raw-template
  SHA `89b657bccb77` ≠ committed `buildHash` `17ee0d96c509`).
- **§3** live fleet drift was evidence-only — the deterministic hash removes its mechanism; no own action.
- Residue → `PROVENANCE-NONDETERMINISM-FOLLOWUPS-2026-06-29-BRIEF.md`.

## Done when
- [x] §1 decision recorded **(a)** — `manifestHash` redefined to a UUID-independent projection in
      `verify-provenance.html` `manifestHashOf()` (= the recording workflow; no other recompute site) + CLAUDE.md,
      and the fleet's `BUILD-MANIFEST` / `FIXTURE-PROVENANCE` recomputed once (GATE A 8/8 + GATE B 13/13 green).
- [x] §2 auto-rebuild behaviour documented; the record-after-settle sequence (and "platform may maintain/rewrite
      the ledger out-of-band — re-read, don't fight an already-synced ledger") in CLAUDE.md.
- [x] §4 concurrent-writer / authorship model: a "re-read before you trust" rule added to CLAUDE.md.
- [x] §5 buildHash-is-runtime-only doc fix landed (`verify-provenance.html` CI-recipe + `manifestHash` prose + CLAUDE.md).
- [x] No app behaviour change — TEST/LEDGER/DOC pass only (no `*-dsp.js`/`*-app.js`/`*-cross.js` edit, no re-bundle);
      both gates green (the Dex-Test-Suite "Manifest JSON well-formed" group stays green — all values 12-hex, valid JSON).

### Priority summary
- **HIGH (provenance integrity):** §1 (non-deterministic `manifestHash` undermines GATE A/B) + §2 (auto-rebuild
  drifts the ledger with no human action) — one coherent fix.
- **MEDIUM (coordination):** §4 (concurrent writers race the same files; this run paid a real budget tax to it).
- **LOW / smoking-gun:** §3 (the live fleet drift — evidence, no own action).
- **LOW (doc trap):** §5 (`buildHash` is runtime-only).

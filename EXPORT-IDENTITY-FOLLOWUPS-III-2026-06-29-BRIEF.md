<!--
  EXPORT-IDENTITY-FOLLOWUPS-III-2026-06-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-29 · **Created:** 2026-06-29 · **Follows:** `EXPORT-IDENTITY-FOLLOWUPS-II-2026-06-29-BRIEF.md` · **Follow-up:** `EXPORT-IDENTITY-FOLLOWUPS-IV-2026-06-29-BRIEF.md`

# Export identity — follow-ups III (what surfaced shipping `recording.contentId` on all 7 remaining nodes)

> **Closed in the parent (-II, 2026-06-29):** §1 — **all 7 remaining nodes adopted `recording.contentId`**:
> the 6 emitters (OxyDex · ECGDex · PpgDex · GlucoDex · HRVDex · CPAPDex), single-sourced in each shared
> builder (`signal-frame.js` bundled into all 6 `.src.html`), + the **Integrator** as a CONSUMER that now
> **dedups on `recording.contentId`**. All 7 re-bundled; all 13 code-gated fixtures regenerated (only-delta
> `recording.contentId`); `BUILD-MANIFEST` (GATE A) + `FIXTURE-PROVENANCE` (GATE B) 0-mismatch. §4 decisions
> recorded: **(a)** no subject key (§3 stays OFF); **(b)** `PHI-SURFACE-STATEMENT.md` written, certification
> stays an OPEN external sign-off. Residue below.

> **Closed in THIS pass (-III, 2026-06-29):** §1 — the Integrator `contentId` dedup is now **gate-backed** in
> `tests/dex-tests.js` (the `INTEGRATOR DEDUP — stampless duplicates (P1)` group, BOTH runners): asserts
> `adaptEnvelopeNode` carries `recording.contentId` onto the record · same node + same contentId dedups
> across a >30 s stamp gap (the cross-stamp re-load the ±30 s rule missed) · different contentId at the SAME
> stamp is KEPT, not merged · the existing dated/stampless cases carry no contentId → exercise the back-compat
> fallback unchanged. Verified headlessly (4/4) + live. **Test-only, no re-bundle** (provenance gate
> untouched). §2 REFRAMED on execution (it's a provenance check, not a behavior assertion) → `-IV §1`.
> §3/§4/§5 documented / standing.

---

## §1 — ⚠ Gate-back the Integrator `contentId` dedup (MEDIUM — the one real test gap)

`dedupeRecs` now treats **same node + same `recording.contentId`** as the strongest duplicate signal
(`adaptEnvelopeNode`/`adaptOxyDex` carry `contentId` onto the adapted record; absent → falls back to the
±30 s / stampless-sig rules). This was verified headlessly (5 cases: same-cid/cross-stamp → dedup;
different-cid/same-stamp → kept; no-cid → old behavior) but is **NOT yet a committed Dex-Test-Suite
assertion** — the existing dedup group (P1) builds synthetic inputs WITHOUT `contentId`, so it only exercises
the fallback. Add a case to that group (or a sibling): two records, same node, **same `contentId`, stamps
>30 s apart → deduped to 1**; and **different `contentId`, same stamp → both kept**. Test-only, no re-bundle.

## §2 — ⚠ Pre-existing CPAPDex/Integrator manifestHash drift (root-cause + a continuous guard)

This pass **found + fixed** a drift independent of the contentId work: at session start `BUILD-MANIFEST` had
CPAPDex `54cc94bfcdcb` / Integrator `ab5333eb44e5` but the **on-disk bundles** hashed `17315542928f` /
`ab16c10c1ae5` — so verify-provenance **GATE A was already red on both** (a prior re-bundle didn't
hand-update `BUILD-MANIFEST`, or a prior `BUILD-MANIFEST` edit didn't re-bundle). The node-6/7 re-bundles
reconciled them (→ `d79dbbfb0095` / `743929a2506a`). **Residue:** nothing catches this class *continuously* —
GATE A only bites when someone opens `verify-provenance.html`. Consider a cheap CI/headless check
(`manifestHashOf(bundle) === BUILD-MANIFEST[bundle].manifestHash` for all 8) wired into the Node runner, so a
"re-bundled but forgot the manifest" (or vice-versa) drift reds without a human opening the page. Also: audit
whether the drift implies the committed CPAPDex/Integrator bundles were *behaviourally* stale before this pass
(they now reflect current source by construction — but the gap existed undetected for some window).

**Reframed on execution (→ `-IV §1`):** this is a PROVENANCE check (recompute each bundle's `manifestHash`
vs `BUILD-MANIFEST`), NOT a behavior assertion — so it belongs in `verify-provenance.html` / a Node-CI
runner, not the Dex-Test-Suite behavior gate (mixing a bundle-hash recompute into the behavior suite would
blur the gate separation CLAUDE.md keeps deliberate — "Behavior is gated separately by Dex-Test-Suite.html").
The "cheap behavior-suite add" framing was wrong; carried to `-IV §1` with the design choice (make
`verify-provenance` Node-runnable, or a tiny standalone CI script that hashes the 8 bundles).

## §3 — Real-EDF CPAP fixtures: contentId reconstructed, not re-run (LOW — verify-don't-trust)

The 2 real-EDF fixtures (`cpapdex-2026-06-12` `f883a8667665`, `cpapdex-2026-06-16` `aa93a4748331`) had their
`recording.contentId` **reconstructed from their own committed `recording.sessions[]`** (the exact fold
inputs), because the binary multi-file EDF input can't drive a headless `{text}` re-run here. This is faithful
— the reconstruction formula was **cross-checked equal to the live `cpapBuildExport` fold** on the synthetic
golden (built==recon, same pass) — but the gold path is a true `readEDF → buildSessionFromEdf → buildNight →
cpapBuildExport` re-run on the committed EDF set. If a same-origin host with the EDF files is available, re-run
to confirm byte-identity (expected: only-delta `recording.contentId`, same values).

## §4 — `cpapdex-2026-06-16.json` byte change vs the historical fusion fingerprint (LOW — documented)

Adding `recording.contentId` changed `cpapdex-2026-06-16.json`'s bytes, so
`integrator_fusion_2026-06-16.json`'s `inputs[]` sha256 fingerprint of it is now **stale-by-design**. Per
CLAUDE.md / SIGNAL-ADAPTER-FOLLOWUPS-IV §3 the integrator input fingerprints are an **immutable historical
snapshot, NOT a live gate**, so nothing fails — but the record now no longer byte-matches the file it names.
No action unless the historical snapshot is ever promoted to a live gate (then regenerate it).

## §5 — Carried-forward (standing / product-gated — not opened by this pass)
- **In-payload `generated:new Date().toISOString()`** is still non-deterministic (every node-export's
  `schema.generated`). Fixture-MOVING if frozen; tracked at `EXPORT-HYGIENE-FOLLOWUPS-II §2`. Unchanged here.
- **§3 opt-in pseudonymous subject key** — UNBUILT by design; build only if longitudinal cross-night linking
  becomes a product requirement (-II §4(a) decision: ride the implicit local grouping first).
- **§4(b) HIPAA/GDPR sign-off** — external human/legal call; `PHI-SURFACE-STATEMENT.md` is the evidence pack,
  not a certification.
- **Node-CI `env.equiv`** literal `node tests/run-tests.mjs` — standing debt (no Node host), tracked at
  `SIGNAL-ADAPTER-FOLLOWUPS-XII §3`.

## Definition of done
§1 is the only actionable engineering item (gate-back the Integrator dedup, test-only). §2 is a worthwhile
cheap guard. §3/§4 are verify-don't-trust / documented. §5 is product/standing-gated and may stay open.

**Executed 2026-06-29:** §1 DONE — Integrator `contentId`-dedup gate-backed in the P1 group (both runners;
test-only, no re-bundle). §2 REFRAMED → `-IV §1` (a provenance/Node-CI check, not a behavior-suite add).
§3/§4/§5 documented / standing. `Dex-Test-Suite.html` green (the 3 new P1 assertions pass); `verify-provenance`
GATE A/B untouched (no re-bundle). Spawned `-IV`.

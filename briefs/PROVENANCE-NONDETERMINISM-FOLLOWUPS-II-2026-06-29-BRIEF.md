<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-06-29 · **Created:** 2026-06-29 · **Follows:** `PROVENANCE-NONDETERMINISM-FOLLOWUPS-2026-06-29-BRIEF.md` (executed — decision pass: §1→(c) accept+document, §2→documented-by-reasoning, §3→fusions/pre-R1 summaries stay legacy, §4→append-only history, §5→tracked at `EXPORT-IDENTITY-FOLLOWUPS-IV §1`) · **Relates:** CLAUDE.md "Provenance gate", `EXPORT-IDENTITY-FOLLOWUPS-IV-2026-06-29-BRIEF.md` §1 (continuous GATE-A drift check), `SIGNAL-ADAPTER-FOLLOWUPS-VIII-2026-06-25-BRIEF.md` §3 (the fallback-from-sidecar derivation)

# Provenance non-determinism — follow-ups II (residue from the decision pass)

> The parent was a DOCUMENT/decision pass (no re-bundle, no fixture change). Its verify-don't-trust audit —
> recomputing GATE A from the on-disk bundles (**PASS 8/8**) and replaying GATE B over the canonical fallback
> audit set (**0 reds**) — surfaced ONE genuinely new (LOW) observation plus the standing carry-forwards.
> **No app behaviour change; nothing here blocks a node DONE.** Verify, don't trust — re-derive the verdicts
> below (`uploads/*.json` `schema.provenance.buildHash` vs the current bundle buildHashes) before acting.

## ✅ Executed — 2026-06-29 (option b · test-harness-only · NO re-bundle · NO ledger change)

- **§1 → option (b): the fixture audit is now HOST-INDEPENDENT (curated set always).** `verify-provenance.html`
  no longer enumerates `uploads/` via `fetch('uploads/')`; it ALWAYS audits the curated set
  (`FIXTURE-PROVENANCE.json` `fixtures` keys ∪ the static legacy list). So a dir-listing host and the sandbox
  now audit the IDENTICAL set, the 5 stale uploaded SAMPLE exports are never reached, and the spurious
  `stale build` rows can't appear on any host. The full-`uploads/` enumeration is intentionally DROPPED:
  uncurated samples (user exports, paper-stats JSON) are inputs/artifacts, not gated fixtures; a NEW code-gated
  fixture still appears AUTOMATICALLY via the sidecar union (the VIII §3 derivation, now the only path). Heading
  + sub-note updated to state the scope. No test asserted the old enumeration or the legacy list (grep-confirmed
  — only `pickProvenanceBanner`/`ManifestGate`/the manifest-well-formed group are tested), so none to update.
  `verify-provenance.html` is a standalone harness page (NOT bundled into any app), so this is **test-harness-only
  — NO re-bundle, NO `manifestHash`/`buildHash` move, NO `BUILD-MANIFEST`/`FIXTURE-PROVENANCE` edit.**
- **§2 → left owner-gated / revisit-if-bites** (no action): the `buildHash` lone non-determinism fixes ((a)
  module-eval snapshot, (b) inliner content-keys) stay their own deliberate fleet-wide passes; the auto-rebuild
  model stays documented-by-reasoning (open only if GATE A spontaneously reds with no human edit).
- **§3 → confirmed still tracked at `EXPORT-IDENTITY-FOLLOWUPS-IV §1`** (the continuous `manifestHashOf` ==
  `BUILD-MANIFEST` headless/Node-CI drift check, PROPOSED); no duplicate tracker.

**Verification (verify, don't trust):** replayed verify-provenance's GATE-B verdict logic over the curated set
(now the ONLY audited set) → **0 red rows** (13 code-gated reproducible · 2 Integrator fusions green-legacy ·
4 pre-R1 warn) — and it is identical on a dir-listing host because the dir-listing branch is gone. Recomputed
every bundle's `manifestHash` from the on-disk file via `manifest-gate.js manifestHashFromText` → **GATE A PASS
8/8** (unchanged — no bundle was touched).

**No `-III`:** §1 is resolved STRUCTURALLY (host-independent curated audit); §2/§3 are standing pointers already
tracked in their own briefs (`buildHash`/auto-rebuild owner-gated; continuous GATE-A at `EXPORT-IDENTITY-FOLLOWUPS-IV §1`).

## §1 (LOW) — stale-`buildHash` uploaded SAMPLE exports red ONLY on a `uploads/`-dir-listing host
`verify-provenance.html`'s fixture audit enumerates `uploads/*.json` via `fetch('uploads/')`; when that can't
dir-list (the canonical sandbox — exactly why `SIGNAL-ADAPTER-FOLLOWUPS-VIII §3` derived the fallback set
`FIXTURE-PROVENANCE.json keys ∪ a small static legacy list`), only that fallback set is audited and it is
clean (0 reds). But on a host where `fetch('uploads/')` DOES return a parseable listing, the audit also reaches
**non-sidecar, non-fallback uploaded SAMPLE exports** — and 5 of them stamp an OLD `buildHash` that matches no
current bundle, so the verdict logic returns the red `stale build — expected <current>`:

| uploaded sample | node | stamped `buildHash` | current node `buildHash` |
|---|---|---|---|
| `ECGDex_2026-06-13_1024_summary.json` | ECGDex | `446a8ecf3527` | `146ac9c8b1bd` |
| `ECGDex_2026-06-17_2040_summary.json` | ECGDex | `446a8ecf3527` | `146ac9c8b1bd` |
| `GlucoDex_2026-06-17_2121_summary.json` | GlucoDex | `8ebee9986547` | `ebb3b3ab196a` |
| `ppgdex_20260614.json` | PpgDex | `ab7d7d51ae21` | `fff8fe8b1b68` |
| `ppgdex_20260616.json` | PpgDex | `ab7d7d51ae21` | `fff8fe8b1b68` |

These are **uploaded samples, not curated fixtures** — they predate the recent builds (their export shapes have
since evolved: `recording.contentId`, the v2.0 envelope, naming migrations), so they are NOT
current-code-byte-reproducible and must NOT be dishonestly code-gated (the `OxyDex_2026-06-17_2042` /
parent-§3 rule). They are also not free to delete blindly: several are **inputs to the historical Integrator
fusions** (`ECGDex_2026-06-13_1024` → `integrator_fusion_2026-06-11`; `ECGDex_2026-06-17_2040` →
`integrator_fusion_2026-06-16`, which `GlucoDex_2026-06-17_2121` also chains). Today the exposure is **nil on
the canonical host** (never audited) and even on a dir-listing host the GATE-B *banner* stays green (it
hard-fails only on a `FIXTURE-PROVENANCE.json` parse error; per-row `stale build` is an advisory red cell, not
a banner fail — `provenance-banner.js`). So this is a latent, host-specific, cosmetic-red hazard: a future
reader on a dir-listing host would see ~5 scary red rows for files that are working-as-intended legacy uploads.
- **Do (decide; LOW):** **(a)** leave as-is + document that uncurated `uploads/*.json` samples are expected to
  read `stale build`/`no provenance` and are NOT gate-relevant (only the fallback set + sidecar are); **(b)**
  scope the dir-listing audit to the SAME `sidecar ∪ legacy` set the fallback uses (so a dir-listing host and
  the sandbox audit the identical curated set — kills the host-dependent verdict surface entirely, the
  cleanest); **(c)** prune the truly-dead samples to `docs-archive/retired-fixtures/` (only those NOT
  referenced by a historical fusion `inputs[]`, with care — destructive). (b) is likely the right call: it
  makes the gate host-independent and removes the sync hazard without touching the historical inputs.

## §2 (LOW / standing — carried from the parent, owner-gated / revisit-if-bites)
- **`buildHash` is the lone remaining provenance non-determinism** — the real fixes stay owner-gated, each its
  OWN deliberate fleet-wide pass (parent §1): **(a)** snapshot `buildSource()` at module-eval in the shared
  `ganglior-provenance.js` (re-bundle all 8 + regen `BUILD-MANIFEST` + re-record the buildHash column); **(b)**
  content-hash the inliner keys (needs owning `super_inline_html`, `GENERATOR-FOLLOWUPS-II §1`). Accepted
  status quo (parent §1 = option c): `manifestHash` is the trusted code identity.
- **The auto-rebuild / concurrent-writer model is documented-by-REASONING, not proven** (parent §2). Open a
  controlled watcher experiment only if GATE A spontaneously reds with no human edit.

## §3 (LOW — link-only, do NOT re-track)
The continuous headless/Node-CI **GATE-A drift check** (`manifestHashOf(Foo.html) === BUILD-MANIFEST`, now a
reliable signal because `manifestHash` is deterministic) is the one actionable engineering item and stays
tracked at **`EXPORT-IDENTITY-FOLLOWUPS-IV §1`** (PROPOSED), kept in the PROVENANCE lane per CLAUDE.md
gate-separation. No duplicate tracker.

## Done when
- [x] §1 resolved by a recorded decision — **option (b)**: the audit always uses the curated set, so the
      (former) dir-listing path and the sandbox agree by construction (single path); replayed verdict logic → 0 reds.
- [x] §2 left as owner-gated / revisit-if-bites (no action).
- [x] §3 confirmed still tracked at `EXPORT-IDENTITY-FOLLOWUPS-IV §1` (no duplicate).

### Priority summary
- **LOW:** §1 (host-specific stale-sample reds — cosmetic, not a gate/banner fail, nil on the canonical host).
- **LOW / standing:** §2 (`buildHash` non-determinism owner-gated; auto-rebuild model revisit-if-bites),
  §3 (continuous GATE-A, tracked elsewhere).

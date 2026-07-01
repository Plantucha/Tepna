<!--
  EXPORT-HYGIENE-FOLLOWUPS-II-2026-06-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-29 · **Created:** 2026-06-29 · **Follows:** `EXPORT-HYGIENE-FOLLOWUPS-2026-06-29-BRIEF.md` · **Sibling-of:** `EXPORT-IDENTITY-FOLLOWUPS-II-2026-06-29-BRIEF.md` — §1 EXECUTED 2026-06-29: `exportName()` (dex-export.js) gained an OPTIONAL `contentId` field — non-empty string → appended `_<contentId>` AFTER the kind segment (sanitized `[a-z0-9]`, filename-safe like `ext`); omit/empty/non-string → name UNCHANGED (non-adopting nodes + interop files untouched). PulseDex (the only node surfacing `recording.contentId`) wired it at its 3 SINGLE-recording export call sites (summary JSON, ganglior JSON, summary CSV) reading `lastResult.contentId` (set in `calculate()`); the multi-recording SERIES export deliberately gets NO suffix (contentId digests ONE recording — the span stamp is its disambiguator; comment-locked against a future "fix"). `export-naming` Dex-Test-Suite group extended (suffix present iff given; omit/empty/null → unchanged; `[a-z0-9]` sanitization). FIXTURE-INERT (a download filename is not hashed content) → PulseDex re-bundled `manifestHash 8873065887c9→416d161be0be`, `buildHash 17ee0d96c509 UNCHANGED` (external-JS only); 2 code-gated fixtures byte-identical, manifestHash re-recorded (not regenerated). OPTIONAL `contentId` is INERT for the other 7 nodes (omitted → identical output) → NOT re-bundled (BADGE_CSS precedent — re-bundling 7 for an inert shared-module add would flip every fixture). Both gates green (GATE A 8/8 + GATE B; export-naming all-pass). **§1 done flips this brief DONE.** §2 (in-payload `generated`) + §3 (carry-forward parity note) stay open per the Definition of done; the next `recording.contentId` adopter (EXPORT-IDENTITY-FOLLOWUPS-II §1) wires its SINGLE-recording call sites the same way but must keep multi/series/window exports suffix-free (the PulseDex precedent). Nothing else surfaced → no separate follow-up brief.

# Export-filename hygiene — follow-ups II (what surfaced finishing the 7-node migration)

> **Closed in the parent (-I, 2026-06-29):** §1 — the remaining 7 exporters (OxyDex, ECGDex, HRVDex,
> GlucoDex, PpgDex, CPAPDex, Integrator) all migrated to the shared `dex-export.js` `exportName()`; every
> local `_exportTs()` / `stampName()` / inline `cpapdex-` stamp is DELETED. Recording-anchored (`t0Ms` via
> `getUTC*`), span-aware (HRVDex window + every multi-record/-night/-session export now passes `spanDays`),
> controlled-vocab. `dex-export.js` wired into all 7 `.src.html` as a new external `<script src>`; all 8
> re-bundled (rode the same fleet pass as EXPORT-IDENTITY-FOLLOWUPS §2); both gates green (verify-provenance
> GATE A 8/8 + GATE B, Dex-Test-Suite all-green 88 groups). **This flipped the parent
> `EXPORT-HYGIENE-2026-06-27-BRIEF.md` to DONE** ("every exporting node migrated"). §4 interop
> non-migrations were honored. Residue below.

---

## §1 — Phase 2 of the sibling just UNBLOCKED §3: the `recording.contentId` filename suffix

The parent §3 (and EXPORT-HYGIENE-2026-06-27 §2.5) reserved an optional `_<contentId>` filename
disambiguator (`…_ganglior_a1b2c3.json`) using the content digest from EXPORT-IDENTITY, explicitly
**blocked on "a node ships `recording.contentId`."** That just happened: **PulseDex now surfaces
`recording.contentId`** (EXPORT-IDENTITY-FOLLOWUPS §1). So this is now actionable:

- Add an optional `contentId` field to `exportName({…, contentId})` in `dex-export.js`; when present and
  non-empty, append `_<contentId>` **after** the `kind` segment (`PulseDex_2026-06-13_2044_ganglior_a1610b5737c2.json`).
  Keep it OPTIONAL (omit → today's name verbatim) so non-adopting nodes and interop files are unchanged.
- Wire it at the call sites of nodes that have a `recording.contentId` in hand at export time (PulseDex
  first: `lastResult.contentId` / the compute result's `contentId`). Do NOT invent a separate id.
- Extend the `export-naming` Dex-Test-Suite group: suffix present iff `contentId` given; absent → unchanged.
- **GATE COST: fixture-INERT** (a download filename is still not hashed content) → per-node re-bundle +
  `manifestHash` re-record only, same cheap ritual as the parent §1. Do NOT rename committed fixtures.

## §2 — Still pending (fixture-MOVING — separate gated decision): in-payload `generated`

Unchanged from the parent §2 / EXPORT-HYGIENE-2026-06-27 §5: `pulsedex-app.js` (and the mirror builders)
still write `generated: new Date().toISOString()` **into** the export content (`schema.generated` + the
multi payload's top-level `generated`). UTC (not the old filename local bug) but **non-deterministic per
export**, so it leans on the equivalence gate's exclusion list. Making it deterministic
(recording-anchored, or omitted, or formally on the exclusion list) changes export *content* → **moves
fixtures** → must ride a node's next deliberate fixture regen with GATE B. Tracked; do NOT silently change
it under a filename pass.

## §3 — Carry-forward for the NEXT contentId adopter: app path must stamp it too (parity)

Discovered executing EXPORT-IDENTITY-FOLLOWUPS §1 on PulseDex, recorded here because it bites every future
`exportName` + `contentId` adopter: a node's **render-coverage `app exportGanglior() ≡ compute()` parity
gate** compares the LIVE app export against the headless `compute()`. `compute()` computes `contentId` in
the DSP; the app's export builder reads it off the app's own result object (`lastResult` / `RESULT` /
`night`), which the LIVE `calculate()`/`analyze()` path builds SEPARATELY. So when a node adopts
`recording.contentId`, it must stamp the id on BOTH paths (PulseDex did: `pdComputeResult` for compute +
`lastResult.contentId` in `calculate()`), folding the SAME raw payload + `t0Ms`, or the parity gate reds
on a `recording.contentId` mismatch (compute has it, app emits `null`). This is the same dual-path lesson
as the shared export builders; bake it into each IDENTITY-FOLLOWUPS-II §1 node migration.

## Definition of done

§1 (`contentId` filename suffix) wired into `exportName` + adopted by ≥1 node that surfaces `contentId`,
with a green `export-naming` extension. §2 (in-payload `generated`) and §3 (a carry-forward note, not a
task) may stay open / land opportunistically with the relevant node.

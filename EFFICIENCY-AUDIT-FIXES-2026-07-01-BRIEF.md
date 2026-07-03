<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-01 · **Created:** 2026-07-01 · **Executes:** `EFFICIENCY-AUDIT-FINDINGS-2026-07-01.md` (Lane A findings A1 + A2) · **Charter:** `EFFICIENCY-AUDIT-PROMPT.md`

> **✅ Executed 2026-07-01 — all 3 §§, both gates green, gate-inert (docs + unbundled `verify-provenance.html`; no re-bundle).**
> **§1 (A1)** DOCS-INDEX trim: 61 trailing `*(**DONE…**)*` changelog blocks compacted to `*(DONE <date>)*` (link/description/role preserved) → **127,645 → 86,828 chars (~31.9k → ~21.7k tokens, −32%)**, now fits one read. **§2 (A2a)** canonical "no-Node-host → browser gates authoritative, don't re-file Node-CI debt" block added to `CONTRIBUTING.md` §4. **§3 (A2b)** read-only "§3 Reconcile" panel in `verify-provenance.html` (RECONCILED/EXPORT-INERT/OUTPUT-MOVED + exact ledger edits, reusing the existing gateA/gateB results; never writes) — verified: `__provenanceOK===true`, `__reconcile={drifted:0,ok:true}`, panel reads "✓ all 8 bundle(s) reconciled". Gates: `verify-provenance.html` GATE A/B green (re-confirmed live); `Dex-Test-Suite.html?full` unaffected (docs + unbundled page — no `*-dsp.js`/`.src.html` touch). No follow-up.

# Efficiency-audit fixes (2026-07-01) — executes the Lane A punch-list

Executes the two accepted Lane A findings from `EFFICIENCY-AUDIT-FINDINGS-2026-07-01.md`. Lane B was
clean (measured), no action. **All three changes are gate-inert** — docs + one unbundled harness page
(`verify-provenance.html`); no `*-dsp.js`/`.src.html` edit, no re-bundle, no fixture move → the behavior
suite + GATE A/B are unaffected by construction. Both gates were green going in; re-confirmed after.

## §1 (A1) — trim `DOCS-INDEX.md`'s inline execution changelog → role/status/date
**Finding.** The index was ~31,400 tokens; 31 % (≈9,700 tokens) was inline DONE-narrative parentheticals
duplicating each brief's own `**Status:** DONE …` header — it exceeded the 25k single-read limit, so
orienting cost two reads. **Change.** Programmatically compact every trailing status parenthetical
`*(**DONE — <date> — <long narrative>**)*` down to `*(DONE <date>)*` (status keyword + first date),
preserving the row's "what it is" description, file link, and role cell. The narrative stays canonical in
each brief's header + body (the CLAUDE.md "one home"). **Done when:** `read_file DOCS-INDEX.md` fits one
call; every row keeps its link + description + role; no brief loses information (it's in the brief).

## §2 (A2a) — one canonical "no-Node-host → browser gates are authoritative" note
**Finding.** The fast-loop toolchain (`check-dex.mjs`/`reconcile-provenance.mjs`/`verify-manifest.mjs`/
`run-tests.mjs`) is Node-CLI-only; this authoring environment has no Node host, so "standing Node-CI
debt" is re-derived across ≥15 briefs (the -IV…-XII chain + node followups). The resolution is settled
(the browser suite runs the identical `tests/dex-tests.js` superset) but never canonicalized as a
*closing* statement. **Change.** Add one compact block to `CONTRIBUTING.md` §4 (after "Try the live gate
first") that closes the item: browser gates ARE authoritative here, `node tests/*.mjs` is a CI mirror,
**do not re-file per-brief "Node-CI debt."** **Done when:** the note exists in the one home; future briefs
can point to it instead of re-deriving.

## §3 (A2b) — browser reconcile-reporter mode in `verify-provenance.html`
**Finding.** `reconcile-provenance.mjs` (the read-only reconcile reporter that kills the ledger-dance
figuring-out) is Node-only, so the browser-only agent hand-reasons the reconcile after every re-bundle —
even though `verify-provenance.html` already recomputes every bundle's `manifestHash` statically and reads
both ledgers. **Change.** Add a read-only "§3 · Reconcile" panel that reuses the already-computed
`gateACompare` + `gateBEvaluate` results to classify each bundle `RECONCILED / EXPORT-INERT /
OUTPUT-MOVED` and print the EXACT `BUILD-MANIFEST.json` / `FIXTURE-PROVENANCE.json` edit — mirroring the
Node reporter's verdicts. **NEVER writes** (PROVENANCE-NONDETERMINISM §2/§4 — an auto-writer races the
out-of-band rebuild). Additive only: does not touch the existing GATE A/B logic or `window.__provenanceOK`.
**Done when:** on the current green tree the panel reads "✓ all reconciled — nothing to do"; a simulated
drift would print the exact edits; `verify-provenance.html` GATE A/B verdict unchanged (`__provenanceOK`
still true).

## Gates
`verify-provenance.html` re-run (GATE A 8/8 + GATE B green, `__provenanceOK===true`) after the §3 edit;
`Dex-Test-Suite.html?full` unaffected (docs + unbundled page). No re-bundle. Stamp DONE only once both
gates are re-confirmed green.

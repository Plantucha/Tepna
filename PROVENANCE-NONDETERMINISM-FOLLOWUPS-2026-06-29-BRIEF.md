<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-06-29 · **Created:** 2026-06-29 · **Spawned:** `PROVENANCE-NONDETERMINISM-FOLLOWUPS-II-2026-06-29-BRIEF.md` · **Follows:** `PROVENANCE-NONDETERMINISM-2026-06-29-BRIEF.md` (executed — `manifestHash` made deterministic, option a) · **Relates:** `GENERATOR-FOLLOWUPS-II-BRIEF.md` §1 (the owner-gated inliner path), CLAUDE.md "Provenance gate" + "Re-bundle checklist", `EXPORT-IDENTITY-FOLLOWUPS-IV-2026-06-29-BRIEF.md` §1 (continuous GATE-A drift check)

# Provenance non-determinism — follow-ups (what's left after `manifestHash` was made deterministic)

> The parent made **`manifestHash`** a UUID-independent, content-coupled projection (drop the inliner's
> random UUID keys → gunzip → hash the decompressed bytes → sort → SHA-256[0:12]), recomputed the fleet
> ledgers once, and both gates are green by construction. This brief is the **residue**: one MEDIUM item
> (`buildHash` is now the lone remaining non-determinism) and four LOW/standing items. **No app behaviour
> change; nothing here blocks a node DONE.** Verify, don't trust — re-run the parent's scratch-rebuild
> determinism check before assuming anything below.

## ✅ Executed — 2026-06-29 (decision pass · NO re-bundle · NO fixture change · DOC/decision-only)

This was a decision + verification pass: §1/§2/§4/§5 are recorded decisions, §3 is a verified determination.
Nothing here touched a `*.js`, a `.src.html`, a bundle, or a fixture, so the gates are unaffected by
construction — confirmed anyway below (verify, don't trust).

- **§1 → decision (c): ACCEPT + DOCUMENT (status quo).** `manifestHash` is the trusted executed-code
  identity; `buildHash` is informational/coarse. The lone remaining non-determinism (`buildSource()` racing
  injected CSS) is now SOUND to tolerate because `manifestHash` is deterministic (the parent's fix). The two
  stronger fixes stay **owner-gated and each its OWN deliberate fleet-wide pass — NOT folded here** (CLAUDE.md
  "snapshot `buildSource()` … must be done as its own deliberate pass"): **(a)** snapshot `buildSource()`
  synchronously at module-eval (touches shared `ganglior-provenance.js` → re-bundle all 8 + regen
  BUILD-MANIFEST + re-record the buildHash column) — the available cheap fix; **(b)** content-hash inliner
  keys — needs owning `super_inline_html` (`GENERATOR-FOLLOWUPS-II §1`), recorded as the ideal if inliner
  ownership ever lands.
- **§2 → left DOCUMENTED-BY-REASONING (revisit-if-bites).** No controlled auto-rebuild experiment run: it
  would mean editing a throwaway source file and risking an async auto-rebuild that moves a `manifestHash`
  and reds GATE A — churn for a doc pass — and the CLAUDE.md safe sequence (record-after-settle +
  re-read-before-trust + don't-fight-an-already-synced-ledger) is correct under BOTH branches. Open only if
  GATE A spontaneously reds with no human edit.
- **§3 → VERIFIED + DECIDED: every legacy (non-sidecar) fixture stays legacy/historical; none is honestly
  code-gateable, none needs retiring.** Determined by reading each fixture's `schema`/`provenance`/`inputs`:
  - **Integrator fusions** (`integrator_fusion_2026-06-09/-11/-13/-16/-08-08`) stay **HISTORICAL** — all
    stamp the current Integrator `buildHash 78e04e861cce` so they read green `reproducible ✓
    (buildHash-only/legacy)`, but their `inputs[]` are explicitly-historical fingerprints (CLAUDE.md /
    FOLLOWUPS-IV §3) and several inputs are uncommitted or retired (e.g. `-06-13` → uncommitted
    `ppgdex_20260613.json` + `ECGDex_2026-06-13_1659_summary.json`; `-06-16` → the RETIRED
    `OxyDex_2026-06-17_2042_summary.json`), so re-fusing through the current Integrator would NOT reproduce
    them byte-identical → **never dishonestly code-gate** (the `OxyDex_2026-06-17_2042` precedent).
  - **Pre-R1 summaries** (`PulseDex_2026-06-12_0821`/`-13_1055`/`-13_1701`, `HRVDex_2026-06-17_2055`,
    `ppgdex_20260610`) stay **LEGACY** — they predate the provenance/`contentId` system (the PulseDex ones
    aren't even node-exports — they're the app's internal dashboard-state dump: `t0Ms`/`mode`/…), and the
    export shapes have since evolved, so a current re-run is NOT byte-identical. They verdict `no provenance
    (pre-R1)` (warn, never red) and remain useful as tolerant-reader legacy inputs, so **no retirement
    needed**. "Fusions stay historical" (the brief's anticipated decision) **recorded** — and extended to the
    pre-R1 summaries.
- **§4 → left as APPEND-ONLY HISTORY (no rewrite).** The umbrella `_note_provenance_nondeterminism` in
  `FIXTURE-PROVENANCE.json` already declares the per-fixture `note_*` prose (which quotes pre-redefinition
  hashes) superseded, so the gate is correct and the history is intact. No per-fixture annotation added
  (the umbrella note suffices; the brief made it optional "if a future reader trips on it").
- **§5 → CONFIRMED tracked at `EXPORT-IDENTITY-FOLLOWUPS-IV §1`, no duplicate tracker.** That brief's §1 IS
  the continuous `manifestHashOf(Foo.html) === BUILD-MANIFEST` headless/Node-CI drift check (the now-reliable
  signal), kept in the PROVENANCE lane per CLAUDE.md gate-separation; it is the one actionable engineering
  item there and is still PROPOSED. Not re-tracked here.

**Verification (verify, don't trust):** recomputed every bundle's `manifestHash` from the on-disk file with
the canonical `manifest-gate.js` projection (`manifestHashFromText`) and compared to `BUILD-MANIFEST` →
**GATE A PASS 8/8** (all match) — which also confirms the deterministic projection still agrees with the
ledger, a churn-free stand-in for the parent's scratch-rebuild determinism check (the parent already PROVED
the re-bundle-stability property: old `416d…→5695…` drifts, new `eba6…≡eba6…` holds; re-bundling again here
would be exactly the unnecessary churn this brief warns against). Replayed verify-provenance's GATE-B verdict
logic over the canonical fallback audit set (sidecar ∪ static-legacy — what runs when `fetch('uploads/')`
can't dir-list, the canonical sandbox) → **0 red rows** (13 code-gated reproducible · 2 fusions green-legacy ·
4 pre-R1 warn).

**Residue → `PROVENANCE-NONDETERMINISM-FOLLOWUPS-II-2026-06-29-BRIEF.md`:** the verify-don't-trust audit
surfaced 5 *uploaded SAMPLE* exports (NOT curated fixtures) that stamp OLD buildHashes
(`ECGDex_2026-06-13_1024`/`-06-17_2040` `446a8ecf3527`, `GlucoDex_2026-06-17_2121` `8ebee9986547`,
`ppgdex_20260614`/`_20260616` `ab7d7d51ae21`) → they would verdict RED `stale build` ONLY on a host that can
dir-list `uploads/`; the canonical sandbox can't, so the fallback list never audits them (0 canonical reds).
Latent, host-specific, pre-existing — captured for a deliberate prune-vs-exclude decision, not acted on here
(several are inputs to the historical fusions). Plus the standing carry-forwards (§1(a)/(b) owner-gated, §2
revisit-if-bites, §5 tracked elsewhere).

## §1 (⚠ MEDIUM) — `buildHash` is now the LONE remaining provenance non-determinism
The parent fixed `manifestHash`. It did **not** touch `buildHash`, which stays both **coarse** (moves only
on an inline-`<script>`/`<style>` `.src.html` edit) AND occasionally **non-deterministic**: `buildSource()`
in `ganglior-provenance.js` hashes whatever `<style>` text is in the DOM when it runs, which can race
injected badge/synth CSS → a fixture can flip red↔green with no code change (CLAUDE.md "Interim `buildHash`
caveat"). Today this is mitigated by *trusting `manifestHash` (GATE A) as the real signal* and treating a
lone `buildHash` red as suspect — which is now SOUND, because `manifestHash` is deterministic. So the
practical exposure is low, but the gate still carries one non-deterministic fingerprint.
- **Do (decide + document — owner-gated, do NOT fold into an unrelated change):**
  - **(a)** Snapshot `buildSource()` **synchronously at module-eval** (pre-CSS-injection) instead of
    deferring to `DOMContentLoaded` — the cheap fix named in CLAUDE.md. Touches the SHARED
    `ganglior-provenance.js` → forces re-bundling **all 8** apps + regenerating `BUILD-MANIFEST` (now cheap
    and churn-free since `manifestHash` is deterministic) + re-recording the buildHash column. Its own pass.
  - **(b)** The clean root fix — make the inliner emit deterministic content-hash keys so even the raw text
    is stable — requires **owning `super_inline_html`** (per `GENERATOR-FOLLOWUPS-II §1`, deliberately not
    taken). Record as the ideal if inliner ownership ever lands; it would also let `buildHash` be a real
    fingerprint and could retire the `manifestHash` projection entirely.
  - **(c)** Accept + document (status quo): `manifestHash` is the trusted code identity; `buildHash` is
    informational. Weakest, but currently in force and adequate.

## §2 (LOW — revisit if it bites) — the auto-rebuild / concurrent-writer model is documented-by-REASONING, not proven
The parent §2/§4 evidence (a CPAPDex `manifestHash` that moved with no explicit re-bundle; ledgers that
re-synced with no successful manual edit) is real, but this pass **did not run a controlled experiment** to
prove (i) the platform auto-rebuilds on a `*.js`/`.src.html` edit, (ii) on what schedule, or (iii) whether
it ALSO rewrites `BUILD-MANIFEST.json` / `FIXTURE-PROVENANCE.json`. CLAUDE.md now documents the **safe
sequence** (record-after-settle + re-read-before-trust + don't-fight-an-already-synced-ledger), which is
correct under BOTH branches, so a definitive characterization isn't required to be safe. Open only if GATE A
spontaneously reds again with no human edit.
- **Do (if it bites):** edit ONE throwaway source file, watch its bundle's `manifestHash` + the ledger
  values over ~60 s, and record whether the platform (a) auto-rebuilds and (b) maintains the ledger. Then
  tighten CLAUDE.md to the proven branch (drop the redundant manual step if the platform maintains it).

## §3 (LOW) — legacy buildHash-only fixtures still lack the deterministic `manifestHash` teeth
The 13 sidecar fixtures are code-gated on the deterministic `manifestHash`. The fixtures NOT in
`FIXTURE-PROVENANCE.json` — the Integrator fusions + pre-R1 PulseDex/ppgdex summaries — still fall back to
the coarse (and possibly non-deterministic, see §1) `buildHash` chain in `verify-provenance.html`'s `legacy`
list. They pass today, but they get no executed-code teeth.
- **Do:** for each that is genuinely current-code-reproducible, code-gate it (re-run the producing app on
  committed inputs → confirm byte-identical → add `{bundle, manifestHash}` to the sidecar). Honor the
  house rule (CLAUDE.md / `OxyDex_2026-06-17` precedent): if it is NOT faithfully regenerable (e.g. an
  Integrator fusion whose input set isn't committed), RETIRE it — never code-gate a reproducibility that
  isn't true. Integrator fusion input fingerprints are explicitly historical, so most fusions stay legacy.

## §4 (LOW — cosmetic) — per-fixture `note_*` lines quote pre-redefinition hashes
The recompute changed only the structured `manifestHash` fields; the append-only `note_*` prose in
`FIXTURE-PROVENANCE.json` still narrates the OLD hash transitions (e.g. "GATE B asserts … still equals
`2ee967d6b537`"). The new top-level `_note_provenance_nondeterminism` declares these superseded, so the
gate is correct and the history is intact — but a grep for an old hash will surface stale-by-design prose.
- **Do (optional):** leave as append-only history (house pattern) OR, if a future reader trips on it, add a
  one-line `note_provenancenondeterminism` per fixture pointing at the umbrella note. Do not rewrite history.

## §5 (LOW) — a continuous headless/Node-CI GATE-A drift check is now reliable
Because `manifestHash` is deterministic, a headless check ("for each bundle, `manifestHashOf(file)` ==
`BUILD-MANIFEST` value") is now a STABLE signal — a "re-bundled but forgot the manifest" drift (the kind
that shipped PRE-EXISTING on CPAPDex/Integrator and sat red until a human opened `verify-provenance.html`)
would red automatically without the iframe-reach-in flakiness. This is exactly the ask already tracked at
`EXPORT-IDENTITY-FOLLOWUPS-IV §1`.
- **Do:** implement there (keep it in the PROVENANCE lane, not the behaviour suite — gate separation);
  reuse `manifestHashOf()` verbatim. Cross-linked, not re-tracked here.

## Done when
- [x] §1 decision recorded — **(c) accept + document**; (a)/(b) remain owner-gated, each its OWN deliberate fleet-wide pass (not executed here).
- [x] §2 explicitly left as "documented-by-reasoning, revisit-if-bites" (no controlled experiment run).
- [x] §3 **"fusions stay historical" decision recorded** + extended: pre-R1 summaries stay legacy; verified none is honestly code-gateable (historical/uncommitted/retired inputs · pre-provenance · evolved shapes) and none reds in the canonical audit so none needs retiring.
- [x] §4 left as append-only history (umbrella `_note_provenance_nondeterminism` already supersedes the stale per-fixture prose); no history rewrite.
- [x] §5 confirmed tracked at `EXPORT-IDENTITY-FOLLOWUPS-IV §1` (the one actionable continuous-GATE-A item, PROPOSED); no duplicate tracker.

### Priority summary
- **MEDIUM:** §1 (`buildHash` is the lone remaining provenance non-determinism; real fix owner-gated).
- **LOW / standing:** §2 (auto-rebuild model unproven), §3 (legacy fixtures), §4 (stale note prose), §5 (now-reliable continuous GATE-A, tracked elsewhere).

<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-09-17 · **Executes:** `MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md` §1 + §2 (its first Done-when item: *"§1+§2 contract brief spawned, executed, gates green"*) · **Owner:** unassigned — any session may pick this up · **Unblocked by:** owner ruling **2026-09-15** (`OWNER-DECISION-QUEUE-2026-09-03-BRIEF.md` D5 — the schema-bump timing decision the roadmap was parked on) · **Relates:** CLAUDE.md §🔒 Clock Contract, §🎫 evidence ladder, §🔏 provenance gates, §📦 release ledger

> Spawned 2026-09-17 by an architecture review that asked whether Tepna should become a general
> scientific measurement platform. The answer was that it already is one, and that its single genuine
> architectural gap is the one this unit opens: **provenance is airtight at artifact granularity and
> absent at instance granularity.** A bundle can prove it produced an export from an input, byte for
> byte, years later. Nothing can answer the same question about one number *inside* that export.

---

## §0 · RECONNAISSANCE — mandatory, and not a formality

The roadmap's §0 requires this of every phase brief, and the two rules that matter most here:

- **Read from `origin/main`, never the root checkout** (it drifts — `stale-root-is-the-default`).
- **Verify every claimed-built item in the files themselves.** This brief names specific files and
  properties below; re-measure them rather than trusting this text. The numbers in §2 were measured
  on 2026-09-17 and a later commit can invalidate any of them.

Baseline before touching anything: `npm run check` green, and the `docs-ledger` + `release-ledger`
groups green (this unit touches neither DSP nor bundles, so the expensive legs are informational).

---

## §1 · SCOPE — what this unit is, and what it deliberately is NOT

**IS:** the measurement-instance block *specified*, a *validator* for it, and a *test group* that
proves the validator rejects the things it must reject.

**IS NOT:** any node emitting the block. The roadmap is explicit — §1's Done-when ends with *"no node
emits it yet (that's §3)"*. Resist the pull to wire one node "since it's nearly free"; that is §3, it
re-records that node's fixtures, and bundling it here destroys this unit's zero blast radius.

The block shape is **already specified** in roadmap §1 and is not restated here. Read it there. The
anti-duplication rule is hard (roadmap §0): *a competing vocabulary is a defect, not a design.*

---

## §2 · WHY THIS IS THE RIGHT FIRST UNIT — blast radius measured, not assumed

Every other phase moves fixtures. This one moves none, and that is checkable rather than hopeful:

| artifact | measured 2026-09-17 | consequence |
|---|---|---|
| `docs/LEXICON.md`, `docs/EVENT-LEXICON.md` | **AUTHORED, owned by nobody** — `tools/build-docs.mjs`'s own header records that `--check` still reports *current* after modifying them and a full run does not restore them | editing them stales no generated tree |
| `tests/dex-tests.js` | **not inlined into any bundle** (`grep -c 'data-inline-src="tests/dex-tests.js"' *.html` → zero everywhere) | no `manifestHash` moves |
| every `*-dsp.js` | **untouched by this unit** | no `computeHash` moves, so no `verifiedUnder` is invalidated and no fixture needs regenerating |
| `FIXTURE-PROVENANCE.json` | **no record changes** | no `verify-fixtures` lap owed |

⚠️ **Ask the builder, never guess, which `docs/` paths are generated.** `node tools/build-docs.mjs
--list-owned` prints exactly what a full run would rewrite. That flag exists because `rebase-safe`
once treated the whole `docs/` prefix as generated, auto-resolved a conflict in an **authored** spec
by discarding one side, and then did not restore it — a silent revert reported as ✓ (DEEP-AUDIT-V,
2026-08-05). If you need to know whether a `docs/` file is yours to edit, run the flag.

---

## §3 · THE WORK

### 3.1 · A new CORE module — `measurement-block.js`

**Mirror `signal-frame.js` exactly; do not invent a second pattern.** That file is the standing
precedent: a CORE module whose `validateFrame(frame) → {ok, errors[]}` is *"the schema authority"* for
the canonical intermediate. This unit's `validateMeasurement(block) → {ok, errors[]}` is the same idea
one layer down.

- **A NEW file, not an edit to `dex-export.js`** — and that is the load-bearing choice. `dex-export.js`
  is inlined into **8 of 8** bundles, so touching it would move eight `manifestHash` values and, if the
  function lands inside the compute closure, eight `computeHash` values too. A new module that no
  bundle inlines yet costs nothing until §3 of the roadmap inlines it deliberately.
- DOM-free and `node:vm`-loadable, like `signal-frame.js`. No `localStorage`, no rendering.
- **`null` + a reason, never a fabricated value** — §∅ applies to every field the block carries. In
  particular `spreadMs`, `uncertainty` and `evidence.inputHash` are `null`-with-reason when unmeasured,
  and `unknown` is a *valid state*, not a failure.
- **`basis` is NOT the evidence ladder.** `basis` is per-instance derivation kind
  (`measured|derived|estimated`); the ladder is per-metric epistemics. The roadmap calls conflating
  them a red. The validator must therefore reject a `basis` that carries a ladder value
  (`validated`/`emerging`/`experimental`/`heuristic`) — that specific confusion is the one a reader
  will actually make, so test it by name.

### 3.2 · Two ⚠️ steps that are easy to miss and will red the gate

1. **Register the new module for source visibility.** The `cohesion · source-visibility · ratchet`
   group asserts every runtime source layer is readable by at least one lane, and it reads inlined
   files for free by walking each bundle's `data-inline-src`. A new root `*.js` that **no bundle
   inlines** is invisible by construction, and the ratchet *reds immediately* on one more unreadable
   file — by design. So add `measurement-block.js` to the lane inventories (`env.sources` in
   `tests/run-tests.mjs`, and the browser lane's `SOURCE_FILES`) in the same PR. Verify by running the
   group, not by reasoning about it.
2. **Join the mutation `DEFAULT_FLEET`** — roadmap §9 requires it of new modules. A validator that no
   mutant can kill is a validator that asserts nothing.

### 3.3 · Specify the block where readers look

- `docs/LEXICON.md` — the block's fields and their semantics.
- `docs/EXPORT-SHAPES.md` — how the block sits *inside* `ganglior.node-export`, alongside the existing
  per-node shape table. It is a **new block inside the export**, not a sibling artifact.
- `docs/EVENT-LEXICON.md` — §2's event additions only. `impulse` stays the type vocabulary and that
  file **owns** it: extend there, never fork.

### 3.4 · §2 — events, additively

Add per event, all optional so `t`-only legacy consumers keep working: `tMs` (the Clock Contract §6
*SHOULD* — make it real), `endTMs` for durative events, `clockDomain`, `evidenceRef`,
`detector: {manifestHash}`. **No event-bus changes and no new event kinds in this phase.** The goal is
narrow: a desaturation event can name the night and the code that produced it.

---

## §4 · TESTS — the negative table is the deliverable

A schema nobody emits yet is tested through its **validator**. One positive case is nearly worthless;
the negative table is where the value is, and it is taken verbatim from roadmap §9:

> missing `evidenceRef` · invalid unit · impossible timestamps · unknown `clockDomain` · missing code
> identity · malformed provenance · `NaN`/`Infinity` · zero-length window · negative duration · absurd
> ranges · duplicate event ids

Plus the two this brief adds for reasons named above: a `basis` carrying a ladder value (§3.1), and a
`metricId` absent from any node registry (the block resolves quantity/unit/label/tier **from the
registry** and must never carry them inline — an unresolvable id is the fabricated-identity failure
one layer down from `no-fabricated-tier`).

🔴 **Every negative test carries a planted control verified to FIRE for the mechanism under test.**
This is the control-vacuity rule and it is not optional. The repo's dominant defect class is a check
that ran and examined nothing: a negative test whose input never reaches the branch it targets passes
for the wrong reason and reads identical to a real pass. Watch each control fail before you accept the
green — and watch it fail *for the stated reason*, not merely fail.

⚠️ **Anti-vacuity legs, in the group itself:** assert the validator was actually loaded and that a
well-formed block PASSES. Without the second one, a validator that rejects everything scores a perfect
negative table.

---

## §5 · BACK-COMPAT, and where the schema version bump belongs

The block is additive, so **consumers tolerating its absence is the contract** — gated the same way
the `t`-only event tolerance already is.

**Decision (mine, 2026-09-17 — flagged as such): the MINOR `schema.version` bump lands with §3's first
emitter, NOT here.** The roadmap files the bump under §1 while its Done-when excludes emission, so the
two readings have to be reconciled. A version that announces a block no node writes is a claim about
the artifact that the artifact does not honour — the same shape as a fabricated tier or an
export-inert *assertion*. Ship the spec and the validator at the current version; bump when bytes
actually change. If a later session disagrees, that is a fine thing to overrule — but overrule it
explicitly rather than discovering the ambiguity again.

---

## §6 · WHAT THIS UNIT DELIBERATELY DOES NOT DECIDE

- **Which nodes migrate, and in what order.** Roadmap §3 names OxyDex first, deliberately, and lists
  the rest at its close as one brief each.
- **How uncertainty is computed.** The block carries `uncertainty` as *a value with a named method, or
  `null` + reason*. Choosing methods per metric is scientific work, not schema work, and the roadmap's
  §7 is explicit that this is architecture, not a statistics framework.
- **Whether the Integrator rewrites anything.** Roadmap §8: consume, don't rewrite.
- **Anything about `docs/` interop adapters.** Roadmap §11 stays a doc until someone needs the adapter.

---

## Done when

- [ ] `measurement-block.js` exists as a CORE module mirroring `signal-frame.js`'s validator pattern,
      DOM-free and `node:vm`-loadable, inlined into **no** bundle.
- [ ] The block and §2's event additions are specified in `docs/LEXICON.md`,
      `docs/EXPORT-SHAPES.md` and `docs/EVENT-LEXICON.md`.
- [ ] A schema test group is live and green, carrying the full §4 negative table, **each negative with
      a planted control watched failing for its stated reason**, plus the two anti-vacuity legs.
- [ ] `measurement-block.js` is in both lanes' source inventories and the
      `cohesion · source-visibility · ratchet` group is green (it reds on an unreadable new file, so a
      green here is the proof the registration landed).
- [ ] The module is in the mutation `DEFAULT_FLEET`.
- [ ] **No fixture moved and no `manifestHash` changed** — assert it rather than assume it:
      `node tools/build.mjs --check` reports every bundle current, and `git diff` touches no
      `provenance/*.json`. If either is false, something was wired that belongs to §3.
- [ ] `npm run check` green. A changeset is owed **only if** code moved into a bundle — under the scope
      fence above it did not, so the honest state is docs + tests + one un-inlined module. Re-check
      `release-ledger` check 7 rather than reasoning from this sentence.
- [ ] The roadmap's first Done-when item is ticked **in the roadmap**, and this brief's header flipped
      to DONE in the same session (§📌 — a triage that leaves the header untouched has thrown away its
      own product).

---

## Cross-references
- Parent: `MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md` (§R reconciliation · §1 block shape ·
  §2 events · §9 tests · SEQUENCING) — read §R first; it halves the work.
- Acquisition half of the chain: `ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF.md` (the `envelopeRef` target).
- Precedent to mirror: `signal-frame.js` (`validateFrame` as schema authority) · `signal-spec.js`.
- Unblocking ruling: `OWNER-DECISION-QUEUE-2026-09-03-BRIEF.md` D5, 2026-09-15.

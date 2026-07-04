<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living audit charter) · **last-verified:** 2026-07-01 · **Audience:** an AI agent (or human) doing a suite-wide EFFICIENCY audit of the Tepna Dex suite · **Sibling-of:** `AUDIT-PROMPT.md` (the CORRECTNESS charter — read it first; this is its efficiency counterpart, not a replacement)

# Efficiency-audit charter — Tepna Dex suite

> **Paste the "MISSION" block below to start an efficiency auditor.** The rest is the reference it reads.
> Tuned to *this* codebase. **Correctness ALWAYS wins over efficiency here** — a faster path that changes a
> single surfaced number is a REGRESSION, not a win (see AUDIT-PROMPT.md; a wrong health number is the worst
> outcome). Every efficiency change must leave both gates green and every fixture byte-identical unless the
> change is *explicitly* a correctness fix too.

---

## MISSION (paste this)

You are running an **efficiency audit** of the **Tepna Dex suite** — browser-based, 100%-offline
physiological-signal analyzers. Your job is to find **real, measured inefficiencies** and propose **one
gated change at a time** — never a speculative sweep. Efficiency here spans **two distinct lanes**; keep
them separate and never trade one for the other silently:

- **Lane A — DEV/AGENT-LOOP efficiency** (the meta-cost of *working on* the suite): the TOKEN + tool-round-trip
  cost a contributor (usually an AI agent) pays per change — gate runtimes, the re-bundle→ledger→gate dance,
  context-read cost, redundant/duplicated work, doc navigation.
- **Lane B — RUNTIME efficiency** (the app's own cost on a real recording): DSP compute time + memory on a
  full-night file, worker utilization, render/DOM cost, bundle size / parse time, redundant recomputation.

**MEASURE, DON'T GUESS.** Every finding carries a **number + a reproduction**: a wall-clock timing (state
the input size + machine), a heap/allocation figure, a byte count, a call-count, a **token / files-read /
tool-round-trip (read→edit→verify) count** for a representative dev task, or a before/after diff. A
claim without a measurement is a *hypothesis* — label it so. "This looks O(n²)" is not a finding until you
show it bites at a realistic n (a full night is ~28.8k samples at 1 Hz oximetry, ~130 Hz ECG → millions of
samples; use those scales, not toy inputs).

**Method (play to an AI's strengths):** state an **efficiency invariant** and hunt **violations** —
e.g. "a full-night compute touches each sample O(1) times" → find the accidental re-scan; "no metric is
computed twice" → find the recompute; "the same parse isn't run per-render" → find the per-frame reparse.
Prefer **differential** (two code paths that should cost the same but don't) and **scaling** (does cost
grow with input as the algorithm implies, or worse?) reasoning. Trace at least one **real recording
end-to-end** (raw file → parse → `SignalFrame` → `compute()` → export → Integrator fusion) with a timing
probe at every stage, and attribute the cost.

**Before you start:** read `ORIENTATION.md` (map) and `CLAUDE.md` (constitution — wins on every conflict).
Establish a **green baseline**: `Dex-Test-Suite.html?full` all-green (render-coverage is on-demand; a bare
open is the amber floor, NOT a pass) + `verify-provenance.html` `window.__provenanceOK`. **If either gate
is red before you touch anything, stop and report that first.** Skim `DOCS-INDEX.md` for open briefs and the
**"Already addressed / out of scope" list below** so you don't re-propose solved work.

Deliver findings in the **Reporting** format. Propose one gated change at a time; re-bundle + re-run the
gates (scoped, then full) after each.

---

## The inefficiency classes worth hunting (highest yield first)

### Lane A — dev/agent loop
0. **TOKEN / CONTEXT cost of a task (the agent-native axis — often the highest-yield here).** Agents do most
   of the work in this repo, so the tokens + tool round-trips a task burns ARE a first-class cost, not a
   footnote. Measure in tokens / files-read / round-trips for a representative task (e.g. "safely change one
   `*-dsp.js` and re-green the gates"). Hunt: **context-read cost** — how many docs/files must an agent load
   to make a SAFE change? A fact stated in 3 places isn't only drift risk (class 4) — it's 3× the tokens to
   load + reconcile; point to the ONE home. Is the ORIENTATION→DOCS-INDEX→brief hierarchy actually letting an
   agent read *little* to act safely, or must it slurp the whole doc set? **Re-derivation cost** — ground
   truth that must be RE-computed every session (which `manifestHash` is settled, which fixture maps to which
   bundle) instead of being a cheap lookup; the reconcile reporter killed the reconcile *figuring-out* — what
   else forces re-derivation? **Gate-output verbosity** — does a RED gate name the failing group+line (cheap to
   act on) or dump 100 lines an agent must scroll + quote back? **Round-trip count** — a workflow needing 6
   read→edit→verify cycles where 2 would do. The fix is almost always a better index/pointer/report or a terser
   failure message, NOT new compute. (Do NOT re-propose the scoped runs or the reconcile reporter — those
   already cut this cost; find what they DON'T.)
1. **Gate runtime not scoped to the work.** The single biggest agent-time sink is running the FULL suite /
   provenance for a one-dex change. As of SECTION-SCOPED-RUNS (2026-07-01) every gate takes a scope filter —
   suite `?group=`, `run-tests --group`, `verify-provenance ?bundle=`, `verify-manifest --bundle`, plus the
   `check-dex.mjs` one-liner. **These EXIST — do not re-propose them.** Hunt instead for: gate surfaces or CI
   steps that DON'T yet honor a scope; a workflow doc still telling people to run the full sweep mid-iteration;
   render-coverage rigs that boot even when their dex isn't in scope (should already be gated — verify).
2. **The re-bundle → ledger reconcile dance.** The *figuring-out* cost is now a read-only reporter
   (`reconcile-provenance.mjs`). Hunt for what it DOESN'T cover: is there still a manual step that could be a
   reporter output? Does the re-bundle checklist in CLAUDE.md have a step with no tooling behind it? **Never
   propose an auto-writer for the ledgers** (PROVENANCE-NONDETERMINISM §2/§4 — it races the out-of-band
   rebuild). Reporters only.
3. **Redundant re-bundling.** A re-bundle that changes only an inert export churns a `manifestHash` (and every
   fixture) for zero gate value. Hunt for shared-module additions that force a needless re-bundle of N apps
   (the `BADGE_CSS`/inert-export precedent: leave bundles as-is for inert additions). Flag any process that
   re-bundles more than the changed code requires.
4. **Duplicated source that must be hand-mirrored.** `parseTimestamp` is intentionally duplicated (Clock
   Contract — do NOT "fix"). But hunt for UN-intentional duplication that drifts: two copies of a constant, a
   norm table, or a formula where a gate doesn't assert they're equal. The fix is usually a shared single
   source + a cohesion gate, not a sweep.
5. **Doc navigation cost.** ~60 markdown docs. Is `DOCS-INDEX.md` current? Are there dead/duplicate briefs
   that should be `docs-archive/`'d (deliberately, with a redirect stub — never auto-moved)? Is a fact stated
   in 3 places that will drift? (Point to the one home; don't copy.)

### Lane B — app runtime
6. **Accidental super-linear DSP.** A full night is large. Hunt any `compute()`/`*-dsp.js` path that re-scans
   the sample array inside a per-window/per-event loop (O(n·w) where a rolling accumulator is O(n)); a
   `.filter`/`.indexOf`/`.includes` inside a hot loop; array rebuilds per frame. Prove it scales badly at
   real n before filing.
7. **Redundant recomputation.** The same metric/spectrum/baseline computed more than once per recording; a
   value recomputed on every render instead of once; a parse re-run when the frame is already in memory. Hunt
   render paths that recompute rather than read a memoized result.
8. **Worker utilization.** The apps use a Web-Worker pool (`WORKER-POOL-PATTERN.md`). Hunt: work that blocks
   the main thread but could be in a worker (the OxyDex heavy-dropout guard is the pattern); a worker that
   round-trips a huge array when it could transfer; idle workers while one is overloaded.
9. **Bundle size / parse cost.** Each app is a standalone inlined HTML. Hunt: an asset inlined into a bundle
   that isn't used by it; a large duplicated dependency across bundles that's *runtime*-cheap to share but
   *ships* N times (weigh against the re-bundle-churn cost of "fixing" it — often NOT worth it); dead code.
   PulseDex's locally-bundled IBM Plex Mono is INTENTIONAL — not a finding.
10. **DOM/render cost.** Hunt: a chart/table that rebuilds all nodes on a small update; layout thrash (read-
    after-write in a loop); an unbounded DOM for a long recording where virtualization would help. Weight by
    whether a real recording actually hits it.

## Reporting (per finding)
`LANE (A/B) · CLASS · severity (HIGH/MED/LOW) · the measurement (number + input size) · the reproduction ·
the proposed one gated change · the gate impact (does it move a fixture? re-bundle which apps?)`. Order by
severity × certainty. Separate **measured findings** from **hypotheses**. End with a **do-first** shortlist.

## Already addressed / OUT OF SCOPE (do NOT re-file these)
- **Scoped gate runs** (suite `?group=` + render-coverage rig gating, `run-tests --group`, `verify-provenance
  ?bundle=`, `verify-manifest --bundle`, `check-dex.mjs`) — SHIPPED 2026-07-01. Only file GAPS in coverage.
- **Reconcile figuring-out cost** — `reconcile-provenance.mjs` (read-only reporter) SHIPPED 2026-07-01.
- **Render-coverage laziness** — already on-demand (`?full`/`?rc`/`?all`); a bare open is the fast headless
  floor by design. Not a finding.
- **`parseTimestamp` duplication** — intentional (Clock Contract). **System-font stacks / no woff2 / no CDN**
  — intentional (June 2026). **PulseDex bundled IBM Plex Mono** — intentional. **Inert-export re-bundle
  avoidance** — the correct existing policy, not a gap.
- **`buildHash` as a provenance signal** — retired (Phase 7); don't propose "optimizing" it.
- Anything that trades a correct number for speed. Correctness wins; such a change is a regression.

## Constraints any proposal MUST honor
100% local (no network/CDN); edit `*.js`/`*.src.html`, never the bundled `*.html`, and re-bundle;
metric-canonical compute; the Clock Contract; the evidence-badge COVERAGE MANDATE; frozen names
(`Ganglior`, the `fascia` alias, `ganglior.node-export`). A proposal that needs a re-bundle must include the
GATE-A manifestHash update + any fixture regeneration (per CLAUDE.md re-bundle checklist), and land both
gates green. **Running this charter produces a REPORT** (findings) — each accepted finding then spawns its
own dated gated change-brief; don't fix in the audit pass itself.

<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living audit charter) · **last-verified:** 2026-06-30 · **Audience:** an AI agent (or human) doing a deep correctness audit of the Tepna Dex suite

# Deep-audit prompt — Tepna Dex suite

> **Paste the “MISSION” block below to start an auditor.** The rest of this file is the reference it
> reads. This is tuned to *this* codebase: a generic “review my code” pass wastes effort here.
>
> **Auditing the TESTS instead of the code?** Use the sibling charter `audits/TEST-AUDIT-PROMPT.md` — it
> hunts *gates that stay green under a real defect* (mutation-testing lens), the orthogonal axis to this
> one. This file finds wrong numbers; that one finds gates that would let a wrong number through.

---

## MISSION (paste this)

You are auditing the **Tepna Dex suite** — browser-based, 100%-offline physiological-signal analyzers
that compute **health metrics**. Your job is to find **real defects**, prioritizing the **“plausible but
wrong”** class: a number that looks reasonable but is silently incorrect. In this domain a wrong number is
the worst possible outcome, worse than a crash — so weight correctness over everything.

**VERIFY, DON’T TRUST.** Every finding must carry a **reproduction**: a failing assertion you added to
`tests/dex-tests.js`, an input that triggers the bug, or a re-run whose diff proves it. A claim without a
reproduction is a *hypothesis*, not a finding — label it as such.

**Method (play to an AI’s strengths):** state an **invariant** and hunt **counterexamples** — do not read
line-by-line hoping to spot a typo. Prefer **differential** (compare two paths that must agree),
**metamorphic** (transform the input in a way the output must respect), and **adversarial-input**
reasoning. Trace at least one **real recording end-to-end** (raw file → parse → `SignalFrame` → `compute()`
→ export → Integrator fusion) and inspect every boundary’s **units, clock, and null-handling**.

**Before you start:** read `ORIENTATION.md` (the map) and `CLAUDE.md` (the constitution — it wins on every
conflict). Then establish a **green baseline**: open `Dex-Test-Suite.html?full` (render-coverage is
**on-demand** — `?full` or the **▶** button boots the rigs; a bare open paints only the headless floor
and reads amber, **NOT a pass**. Wait for the `#summary` pill to read all-green after the group count
stops climbing, ~30–50 s) and `verify-provenance.html` (read `window.__provenanceOK`). **If either gate is red before you touch anything, that is finding #1.** Skim
`DOCS-INDEX.md` for open briefs (known residue) and the **“Out of scope” list below** so you don’t file
known/intentional behavior.

Deliver findings in the format under **“Reporting”** below. Do not fix in a sweep — propose one gated change
at a time.

---

## The bug classes worth hunting (highest yield first — these are what this suite actually fears)

1. **Units / dimensional slips — the #1 fear.** A `ms`-vs-`s`, `mg/dL`-vs-`mmol/L`, or `bpm`-vs-`Hz` slip
   yields a *plausible-but-10³–10⁶×-wrong* value. Do a **dimensional pass at every I/O boundary**: does the
   value entering a formula carry the unit the formula assumes? Flag any metric-vs-metric arithmetic that
   adds incompatible units. **Canonical example to pattern-match:** the Baevsky SI/CSI guard
   (`hrvdex-dsp.js`, `DexUnits.guardBaevsky`) — look for *un-guarded siblings* that read a vendor column and
   assume a unit. Also: metric is the canonical system (store/compute in SI; imperial is display-only) —
   flag any persisted imperial value or math done in imperial.

2. **The Clock Contract** (`CLAUDE.md` §Clock Contract). Canonical unit is *floating wall-clock* `tMs =
   Date.UTC(...)`, read back **only** via `getUTC*`; a missing stamp → `null`, **never** `now()`. Hunt:
   any `getHours()/getMonth()/getDate()` (non-UTC) on a `tMs`; any `new Date(str)`/`Date.parse` on a vendor
   string (must be explicit regex); any fallback to `new Date()`/`now()` for a missing stamp; **viewer-
   timezone dependence** (re-render under a changed `TZ` → must be identical); **negative `spanDays`**; an
   overnight 22:00→06:00 that jumps ~24 h instead of ~8 h; DMY-vs-MDY mis-disambiguation.

3. **Fabricated absence — a guess in a measurement’s clothes.** A missing input must surface as
   `null`/`usable:false`+`reason`, never as a number. Hunt: any composite that **seeds an input to `0`/a
   default and then computes a plausible value** (the zero-default-composite class — e.g. a welfare/EFC score
   that evaluates to `0` on a raw recording because its subjective inputs were `0`, not absent); any `|| 0` /
   `?? default` / default-profile substitution that converts ABSENCE into a value. Gate composites on “inputs
   *present*”, not “inputs `!= null`”.

4. **Silent fallbacks.** A failure that degrades quietly instead of reddening is worse than a crash. Hunt:
   `catch{}` that swallows; a parse failure that returns an empty/default result instead of
   `{usable:false,reason}`; a gate that falls back instead of failing (the `FIXPROV=null`-silently-falls-back
   precedent that was fixed). Every degrade should be **visible** (a `reason`, a warn, a red).

5. **Differential drift across the redundant HRV paths.** PulseDex, ECGDex, HRVDex (and PpgDex) all derive
   HRV — feed the **same RR/beat truth** through two paths and assert `rMSSD`/`SDNN` agree within tolerance.
   A divergence = an estimator or threshold drift (the real `SDNN` `÷N` vs `÷N−1` bug the differential oracle
   caught). Check `std()`, the spectral path, and artifact-rejection bounds are consistent where they must be
   — and *intentionally per-signal* where the code documents it (don’t “unify” a deliberate difference).

6. **Spectral honesty.** Confirm no *surfaced* spectral value uses a crude proxy (e.g. `hf ≈ rmssd²`) instead
   of the real Lomb–Scargle path; ambiguity on a surfaced frequency-domain number is a real risk.

7. **Evidence honesty** (`CLAUDE.md` §Evidence badges). EVERY surfaced number carries an evidence badge — a
   bare KPI/metric/chart-series/table-row is a **bug** of the same severity as a wrong unit. A **derived/
   black-box input** (Welltory’s proprietary Stress/Energy/Focus/Coherence) must read **lower-tier**
   (heuristic/experimental), never “measured”; a node must stand on its raw math when those inputs are absent.
   Hunt: an unbadged number; a `heuristic`-tier value sitting in the headline grid; a composite built on
   proprietary inputs graded as if measured.

8. **Cross-node contract drift.** The `ganglior.node-export` JSON is the *only* seam (nodes never import each
   other). Hunt: a node that drops a field a consumer (the Integrator / `crossnight-envelope.js`) reads; a
   change that claims to be additive but broke an old shape; the Integrator mis-reading or silently dropping a
   node it doesn’t recognize. Contracts live in `tests/dex-tests.js` — they are the public surface.

9. **Provenance integrity.** `manifestHash` is the executed-code identity; each `FIXTURE-PROVENANCE.json`
   fixture is a content-addressed known-answer (`hash(input)+manifestHash→hash(output)`). Hunt: a committed
   fixture the **current code no longer reproduces** (run the Dex-Test-Suite equiv gate — `env.equiv.*` re-runs
   `compute({input}) ≡ committed export`); a `BUILD-MANIFEST.json` drift; a hand-edited fixture (the gate
   forbids hand-editing).

10. **DSP edge cases — your strength; the equiv fixtures are all ~6-min clips, so large/odd inputs are
    under-tested.** Feed adversarial inputs and check graceful, honest handling: an electrode-settling
    multi-kµV transient (ECG R-peak seed/stall — does detection recover, or silently collapse to <1 min of a
    7 h night?); all-zero HR; a header-only / stamp-less file; a clipped CGM (Abbott Lingo clamps 55–200
    mg/dL — are clip-floor hypos flagged, not counted as real?); a mixed-device folder (does routing set
    aside foreign streams, or analyze a magnetometer file as ECG?); a ≥7 h overnight (full-coverage, no
    silent truncation); `O(N²)` paths (sampEn caps) on a long record.

---

## How to verify (use these — don’t eyeball)

- **Contracts-as-tests:** `tests/dex-tests.js` (one assertion lib, two runners — `node tests/run-tests.mjs`
  + `Dex-Test-Suite.html`). **Add a failing assertion to PROVE a finding**, then it becomes a regression gate.
- **Reproduce a metric:** re-run the node’s `compute()` on a committed input and diff vs its fixture — the
  equiv gate already does exactly this (volatile-stripped). A finding that survives this diff is real.
- **Metric truth** = each `*-registry.js` (label/unit/good-direction/evidence; kept honest by `cohesion-badges`).
  **Provenance** = the two gates + `manifest-gate.js`. **Event vocabulary** = `docs/EVENT-LEXICON.md`.
- **Trace end-to-end:** pick one real `uploads/` recording, follow it raw → adapter (`adapters/*.js`) →
  `SignalFrame` (`signal-frame.js validateFrame`) → `compute()` → export → `integrator-dsp.js` fusion. At each
  hop: units? clock? `null` vs fabricated? badge?

---

## Out of scope — do NOT file these (known/intentional; filing them wastes everyone’s time)

- **Frozen names** — `Ganglior`, the `ganglior.node-export` schema, all `ganglior.*` identifiers, `DexKernel`,
  and the **`fascia` input alias** (a *deliberate* read-side back-compat seam in `integrator-dsp.js` /
  `crossnight-envelope.js`; nothing emits it — not dead code).
- **`buildHash`** — RETIRED as a provenance signal (Phase 7); no gate reads it; it is inert legacy export
  metadata stamped by `ganglior-provenance.js` *by design*. Do not flag it as “unused” or “dead.”
- **`parseTimestamp` duplicated in every `*-dsp.js`** — intentional per the Clock Contract. Not a DRY
  violation to “fix”; do not propose a shared util.
- **No `@font-face` / `*.woff2` / CDN** — system font stacks by design (the `'Inter'`/`'IBM Plex Mono'` names
  fall through). PulseDex’s locally-bundled IBM Plex Mono is intentional.
- **Test pass-/group-COUNTS drift run-to-run** — only the **all-green pill** is the signal (render-coverage
  legs are timing-sized). Don’t treat a count change as a regression.
- Anything on the **`CLAUDE.md` “Known non-issues”** list, or already tracked **open** in `DOCS-INDEX.md`
  (cite the brief instead of re-finding it).

---

## Reporting (one entry per finding)

For each finding, give:
- **Severity** — top = *mis-states a surfaced number* or *fabricates absence*; then *silent failure*; then
  *contract/provenance drift*; then *robustness / code-health*. Say which.
- **Symptom** — what’s wrong, in one line.
- **Reproduction** — the failing assertion / triggering input / re-run diff. (No repro → mark **HYPOTHESIS**.)
- **Root cause** — the actual line(s) + why.
- **Fix sketch + gate cost** — the change, and what it triggers: which bundles re-bundle (`*-dsp/-cross/-app.js`
  edits → that node), whether a fixture must regenerate, which gates must re-run. Respect the gate-cost rules
  in `CLAUDE.md` (edit `.js`/`.src.html`, never the bundled `.html`; one gated change at a time).

Group findings by node/module. End with a short **prioritized punch-list** (correctness first).

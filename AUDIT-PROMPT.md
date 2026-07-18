<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living audit charter) · **last-verified:** 2026-07-18 · **Audience:** an AI agent (or human) doing a deep correctness audit of the Tepna Dex suite

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

**Start one hop EARLIER than feels necessary.** The trace above begins at "raw file" — but something *wrote*
that file. Read `capture-host/` (the writer) alongside the adapter that parses it, and ask whether the file's
**shape honestly reflects the hardware**. A whole defect class lives only in that seam and is invisible to any
amount of in-suite checking (see bug class 11).

**A comment is not a measurement. A brief marked DONE is not a measurement.** In this repo a code comment
describing a defect, a `Status: DONE` header, and observed behaviour are three different things, and only the
third is evidence. Comments describing *already-fixed* bugs are common here — one is a post-fix regression
note that reads exactly like a live defect report. Before acting on any defect claim you did not execute
yourself, execute it. (Precedent: a 29-agent verification pass found **6 of 14** candidate findings did not
survive execution.)

**Verify the MECHANISM, not the correlation.** When an experiment shows that changing X moves output Y, trace
*how* before concluding what it means — otherwise you will credit a defect as a feature. Real precedent:
adding a gyro stream measurably changed MotionDex's body-position output, which was recorded as "gyro
contributes to a metric". It does not: gyro reaches no positional code path, and the only thing it changed
was a shared `durSec` denominator that then diluted the result with sample-less epochs. The experiment was
sound; the interpretation inverted a bug into a feature.

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
   **3a — the per-epoch SERIES variant (the one that keeps recurring).** A time-series that feeds a fusion
   must be **TRI-STATE** — `true` / `false` / **`null` = the sensor was not recording** — and null epochs must
   leave the **DENOMINATOR**, not just the numerator. This variant is nastier than the classic form because
   nothing looks null: the epoch returns a perfectly plausible measurement. Ask of every series: *what does
   this field say when the sensor was off?* If that equals a real reading, it is wrong. Instances found so
   far, all the same shape: `EVENT-COUPLING` §2's ×0.72 artifact (apneas during oximeter downtime scored as
   MISSES); MotionDex `actigraphy()` scoring an epoch with **zero ACC samples** as `counts=0 → moving=false
   → immobile` (a recording gap fabricating *stillness*, which then inflated a motion-gated HRV confidence);
   and the effort/posture series feeding apnea typing, where “no chest-ACC” must read UNTYPED, never CENTRAL.
   Consequence in each case is a **manufactured clinical finding**, so treat it as top severity.

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

11. **Fabricated redundancy — a consensus statistic over inputs that are not independent.** *(Added
    2026-07-18: this class was missed by a 16-hunter audit that was explicitly hunting evidence honesty.)*
    Any statistic whose meaning is **agreement** — n-of-m consensus, channel agreement, inter-estimator
    concordance, cross-validation between two paths — is honest **only if its inputs are independent**. When
    an upstream producer replicates one source into many, the statistic measures a value against *itself*,
    renders as a perfect score, and is graded `measured`. **Hunt:** any `nAgree` / `agreementPct` /
    `nOf3` / `consensus*` / `concordance` metric — then go **upstream of the file** and confirm the channels
    are physically distinct. Check the honest early-return (`nCh < 2` and friends) actually fires for
    degenerate input. **Canonical example:** `capture-host/capture.py` writes the O2Ring's single-photodiode
    pleth as `write_ppg(ph, ns, 0.0, (v, v, v), 0)` — one 8-bit sample replicated across three PSL channels
    — so `ppgdex-dsp.js consensusBeats` sees `nCh = 3`, never takes its `nCh < 2` return, and reports
    `ledAgreementPct: 100` at **`measured`** tier across five surfaces, for hardware that has one photodiode.
    ⚠️ **Why the badge sweep cannot find this:** the number *is* badged and its tier *does* match the
    registry. What is false is the registry's own claim. Checking badge-vs-registry consistency will report
    green forever. You must read the producer.

12. **Filename-derived semantics — unanchored regexes over names.** A surprising amount of meaning is
    extracted from *filenames* (date, device id, stream kind, night grouping), and a regex that is correct
    on a synthetic name silently matches the wrong digits on a real one. **Hunt:** every regex applied to a
    filename — is it **anchored**? Execute it against **real corpus names**, not invented ones. **Canonical
    example:** `signal-orchestrate.js:397` `fnameStampMs` is unanchored, so on
    `Polar_H10_02849638_20260617_010616_ACC.txt` it matches the **8-digit device serial** before the date
    and returns year 0292 — collapsing two nights three days apart to an identical stamp and silently
    disabling a nearest-stamp tiebreak. Device-shape-dependent: the Verity id contains letters and parses
    fine, so a single-device test proves nothing. **Note the anchored sibling one file over
    (`dex-ingest.js:42-47`) — see class 14.**

13. **The missing instance — what ISN'T there.** A per-file sweep is structurally blind to an *absent*
    one: you cannot grep for the cross-night envelope a node never emits, the regen tool that was never
    written, or the registry entry a rendered number lacks. **Hunt by building a matrix** — every node in
    the roster × every cross-cutting surface (crossnight envelope · `tools/regen-<node>-goldens.mjs` ·
    registry entry per surfaced metric · equiv/GATE-C leg · render-coverage rig · adapter) — **and report
    the empty cells.** Precedent: three nodes emit no crossnight envelope; MotionDex has no regen tool and
    no registry entry for a number it renders; four surfaces have zero behavioural coverage. Each was found
    by enumeration, none by reading code.

14. **Sibling divergence — the in-repo precedent is your fix AND your proof.** This is a fleet of near-clone
    nodes, so almost every function has 3–8 siblings doing the same job. **When you find a defect, grep the
    siblings immediately: if they differ, one of them is wrong, and if one is right you have a correct
    implementation to port plus proof the fix is achievable.** Conversely a lone divergent implementation is
    itself a strong lead. **Canonical examples:** PpgDex derives `fs` from the **median** sensor-ns delta
    (correct) while ECGDex infers it from a **single** ms delta (parses 130 Hz as 143/167) — the fix is a
    port, not a design. `dex-ingest.js` anchors its filename stamp regex; `signal-orchestrate.js` does not.
    `actigraphy` got a coverage fix (`3e9792f`) that `bodyPosition` never received. `d_pns_eff` gates
    `_pnn50 >= 1`; its neighbour `d_otr` gates `>= 0` and `null >= 0` is `true`. **A divergence between
    siblings is the single highest-yield grep in this codebase.**

---

## How to verify (use these — don’t eyeball)

- **Contracts-as-tests:** `tests/dex-tests.js` (one assertion lib, two runners — `node tests/run-tests.mjs`
  + `Dex-Test-Suite.html`). **Add a failing assertion to PROVE a finding**, then it becomes a regression gate.
- **Reproduce a metric:** re-run the node’s `compute()` on a committed input and diff vs its fixture — the
  equiv gate already does exactly this (volatile-stripped). A finding that survives this diff is real.
- **Metric truth** = each `*-registry.js` (label/unit/good-direction/evidence; kept honest by `cohesion-badges`).
  **Provenance** = the two gates + `manifest-gate.js`. **Event vocabulary** = `docs/EVENT-LEXICON.md`.
- **Trace end-to-end:** pick one real `uploads/` recording, follow it **producer (`capture-host/`) →** raw →
  adapter (`adapters/*.js`) → `SignalFrame` (`signal-frame.js validateFrame`) → `compute()` → export →
  `integrator-dsp.js` fusion. At each hop: units? clock? `null` vs fabricated? badge? **and does the file's
  shape honestly reflect the hardware?**
- **Build the coverage matrix** (class 13): roster × cross-cutting surface, and report the empty cells. This
  takes ten minutes and finds defects no amount of reading will.
- **Grep the siblings** (class 14) the moment you find anything. Divergence between near-clone nodes is the
  highest-yield signal in this repo.

### Declare your scope — and name what you did NOT cover

Both 2026-07-18 audits skipped the same three things while reporting confidently on everything else. State
explicitly, in the report, whether you covered: **(a)** the browser lane (`Dex-Test-Suite.html?full`,
`verify-provenance.html`, render-coverage rigs — a headless `node:vm` audit covers **none** of it); **(b)**
`capture-host/` (Python, out-of-suite, its own pytest CI); **(c)** the **Integrator's fusion arithmetic** —
the noisy-OR posterior, `effConf`, the Poisson null models, the event-coupling surrogate machinery. (c) in
particular has now been left unaudited by two consecutive passes that both examined the Integrator's *ingest
and presentation* and stopped there. **A green area you did not look at must not read as a verified one.**

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

### Also report what you REFUTED — this section is mandatory

A claim you investigated and **disproved by execution** is a deliverable, not a discard. Add a
**"What NOT to chase — investigated and REFUTED"** section listing each dead claim with the evidence that
killed it. Without it the next auditor spends a day re-deriving a bug that was fixed six days ago — which is
exactly what happens here, because stale comments and premature DONE stamps keep re-seeding the same false
leads. Give the refutation the same evidentiary standard as a finding.

Two cautions learned from doing this:
- **Refute the claim, not the underlying concern.** State precisely what was disproved. A row reading "false
  — X does affect Y" can be literally true while the *mechanism* is itself a defect (see MISSION, "verify the
  mechanism"). If you refute a claim but find something adjacent, say so in the same row.
- **A refuted claim is not a cleared area.** "This specific bug is not real" never implies "this code is
  correct."

### Cross-check against concurrent audits before filing

Several audits may run in the same week against different slices. Before finalising, `grep` `briefs/` and
`audits/` for passes dated within ~a week and reconcile: **(1)** does anything you filed appear in *their*
REFUTED list (resolve it — one of you is wrong); **(2)** did you each find a **different half of one bug**
(the 2026-07-18 pairing defect was found from both ends by two audits, neither seeing the other's half —
merge them or a partial fix ships); **(3)** does their evidence *demonstrate* one of your findings under a
different reading. Convergence between independent passes is the strongest signal available here — and
**where two passes overlapped in 2026-07-18 they agreed, with zero contradictions across 72 findings.**

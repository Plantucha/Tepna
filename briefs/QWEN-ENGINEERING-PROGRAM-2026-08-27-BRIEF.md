<!--
  QWEN-ENGINEERING-PROGRAM-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — drain triage, Kestrel: a PROGRAM PLAN awaiting owner ratification; the only piece that runs without it is the P0 idle-lane DSP review, which is already the standing qwen idle behaviour and needs no brief to continue. Owner: the owner (ratify or decline); next step: none for the fleet until ratified. Previously: program plan for owner ratification; P0 items are idle-lane-safe to start) · **Created:** 2026-08-27 · **Owner-issued charter** (direct, 2026-08-27 — condensed capture in the Appendix) · **Interlocks:** `MUTATION-FLEET-EXPANSION-2026-08-25-BRIEF.md` (§0 invariant), `OPERATIONAL-MATURITY-ROADMAP-2026-08-27-BRIEF.md` (§22 echoes its charter), `DEVELOPMENT-METHODOLOGY-2026-08-27-BRIEF.md` §7

# The qwen engineering program — Tech Lead audit + plan

> **The charter in one line:** with effectively free local inference at ~Haiku-class quality,
> use qwen where it is *cheap, tireless, parallelizable, and verifiable* — never as an authority.
>
> **The response in one line:** the existing stack already implements the charter's §0 shape
> (search-only, verified-by-construction); what is genuinely missing is not more workers but a
> **findings ledger with precision tracking** — without §16/§17, every new worker adds unmeasured
> noise, so the ledger is P0 and most new workers are gated behind it.

---

## 1 · Audit of existing qwen use (charter §1)

Everything below was built and calibrated 2026-08-25 → 27; measurements are from those runs.

| existing use | what it does | measured value | verdict |
|---|---|---|---|
| **mutation probe + draft** (`mutation-crawl.mjs` → `mutation-suite.mjs --draft`) | qwen proposes distinguishing inputs and drafts assertions; every expected value is the REAL code's recorded output, machine-verified to discriminate real from mutant | **48 drafts** (across 7 of 9 DSPs — glucodex and motiondex produced header-only files; this cell said "57 across all 9" until the adoption pass counted actual draft blocks: 57 was a grep token count, the examined-nothing family). Adoption #1860: **44 adopted, 4 excluded** — 2 crash/NaN-pins caught by human read, and **2 whose recorded expected values the code cannot produce in the suite realm** (see the amendment below §2.1) | **KEEP** — the flagship. The only lane where correctness is verified *by construction*. EXPAND: widen the projection charset to quoted-bracket keys (`out.EprPress["2s"]` is currently rejected wholesale — measured: `_synthEdfSet` yields kept 0 on 61 killables); build the recompute-fallback for the 24 truncation-refused killables |
| **house-rules DSP review** (`dsp-review-qwen.mjs`) | per-function review against Clock Contract / honesty / signal-flow rules; journaled findings with model-written draft fixes | not yet run at scale (correctly queued behind the crawl) | **RESTRICT then EXPAND** — its single generic prompt is exactly the charter §3 anti-pattern ("review everything"). Convert to the narrow-lens runner (§4 below) before its first big run, so its precision is measurable per lens from day one |
| **adversary mode** (same tool, 5 attack lenses) | concrete-attack review: "only report attacks you can state concretely — the input and the wrong output" | not yet run at scale | **KEEP** — already lens-shaped; absorb into the lens runner |
| **read-only agent** (`qwen-agent.mjs`) | jailed tools (read/grep/list/doc-search), live-distilled CLAUDE.md, forced tools-off final round | 3-run calibration: 0/2 correct before the structural rails, 1/1 after (exact line citations, honest no-change verdict) | **RESTRICT** — bounded, known-shape questions only. Its best fit is charter §8's contract audit format (RULE → CODE PATH → verdict), one contract × one path per run. Never open-ended investigation |
| **idle driver + timers** (`qwen-idle-driver.sh`, `qwen-idle.timer`, `bge-reindex.timer`) | session-independent work when quota is dead; GPU-aware yielding (both levels, fixed 2026-08-27) | verified firing; the GPU-aware refinement recovered hours of idle windows | **KEEP** — this is the execution substrate for everything below |
| **bge doc-search** | retrieval embeddings (different model), mandated pickup step | found existing machinery twice in one week that grep missed | **KEEP** — not a qwen use per se; listed for completeness |

**Is current usage producing measurable value? Honestly: material, not yet realized.** The 57
drafts are adoptable but value lands only when they land in `tests/dex-tests.js` and kill mutants
in CI. The first adoption batch is therefore both the proof and the metric (§6). Nothing gets
REMOVED or REPLACED: the stack is two days old and shaped correctly; its gap is measurement, not
machinery.

## 2 · Design principles (from the calibration, not from taste)

1. **Verify-by-construction beats verify-by-review.** The draft pipeline is the quality ceiling:
   qwen picks *where to look*; recorded real outputs supply *what is true*. Every new worker
   should be pushed as far toward this shape as its domain allows.
   **AMENDED 2026-08-27 (adoption pass #1860, measured):** the claim is narrower than first
   written — expected values are verified by construction **in the drafting realm**, and 2 of 48
   drafts (4 %) recorded values the real code cannot produce under the suite's co-load
   (`computeMOS(null)` recorded 3, real result 1, unreachable without `K.MOS_LONG`;
   `getFilteredRows(null)` recorded length 58 where the suite realm throws). A further 4 recorded
   the literal `"undefined"` where the suite's own comparator tags `"@undef"` — the values do not
   round-trip. Both filed (ledger `6da536d03472`, `cf6482e19e8d`). **Consequence, now P0: drafts
   are re-executed in the suite realm before any adoption batch, converting the claim to
   "verified by construction, in the realm that will run it".**
2. **Rails, not prompts.** The agent calibration showed prose instructions do not change qwen's
   failure modes; structure does (tools-off final round). Workers get structural constraints —
   schemas, jailed tools, forced formats — not longer prompts.
3. **Narrow lens, one question** (charter §3). A worker with one question has measurable
   precision; "review everything" does not.
4. **Nothing ships on qwen's word** — §0 of `MUTATION-FLEET-EXPANSION` verbatim: the model
   widens what is SEARCHED, never what DECIDES. This charter's §13 restates it; adopted as-is.
5. **Precision is tracked or the worker doesn't run** (charter §16/§17). Pre-stated bands, house
   style: a lens with <30 % confirmed findings after 30 triaged is narrowed or retired; a lens
   earns Level 2 (auto-PR of proposals) only after ≥20 triaged findings at ≥60 % confirmed.

## 3 · The ten highest-value continuous jobs (the charter's FINAL QUESTION, answered)

Ranked by (value × verifiability ÷ false-positive risk). "cs" = capture-host, "JS" = the DSP/suite side.

1. **Mutation draft pipeline** (exists; JS) — keep feeding it; the only by-construction lane.
2. **Diff-scoped narrow-lens commit audit** (new; cs+JS) — every push to `main`, ~6 lenses ×
   changed files only: resource leaks · silently-stopped-acquisition paths · transitions without
   recovery · swallowed exceptions · duplicate/contradictory state · Clock-Contract misuse.
   Diff-scoping keeps each run small, current, and cheap to verify.
3. **State-machine adversary** (new; cs) — the acquisition state machines are mostly *pure
   functions* (`oxy_presence.probe_justified`, transfer/flush gates, recovery ladders), which
   makes this the most verifiable new lens: qwen enumerates states/transitions and proposes
   illegal/missing/dead ones; each finding is checkable by reading one function, and each
   confirmed finding becomes a pytest case. Charter §7's "apparently healthy but actually dead"
   is the exact class the witness/evidence work already hunts by hand.
4. **Test-gap detector** (new; cs+JS) — inventory public functions/branches vs the tests that
   name them; propose the *smallest* test per gap with the invariant it proves. Cheap to verify
   (the gap either exists or doesn't); output feeds the normal PR workflow.
5. **Failure-mode enumeration** (new; cs) — the charter §4 perturbation set (timeout, disconnect,
   duplicate/delayed/missing event, device vanish/return, restart, partial transfer, corrupt
   artifact, resource conflict, stale state, clock anomaly) run per acquisition path, findings in
   the §15 schema with a proposed test each.
6. **Fault-scenario generation** (new; cs) — qwen writes scenario + expected invariant; the
   existing pytest harness decides survival. Model generates, CI verifies — clean §0 split.
7. **Contract audit** (new; railed `qwen-agent`) — one contract × one code path per run, forced
   RULE → CODE PATH → OBSERVED → verdict → EVIDENCE-NEEDED format; contracts from the charter §8
   list (Clock Contract, device identity, artifact transactions, evidence tiers, provenance).
8. **Nightly ops-log anomaly scan** (new; cs telemetry) — witness/evidence JSONL vs the pattern
   of known-good sessions: repeated reconnects, long gaps, abnormal artifact sizes, unexplained
   transitions. Every finding must cite the log lines; it is an *operational* anomaly detector,
   never a physiological one (charter §9 adopted verbatim).
9. **Doc-drift audit** (new; docs) — stale docs vs current code, both sides cited. Feeds the
   existing brief-hygiene machinery as proposals; pairs with the standing unwired-machinery
   audits rather than duplicating them (charter §11, RESTRICTED to proposals).
10. **Scientific adversary on new briefs** (new; docs) — for each new claim-bearing brief:
    hidden assumptions, confounders, what evidence would falsify it. Output is a review the
    coordinator triages; it never edits the brief (charter §10 adopted verbatim).

**Deliberately NOT on the list:** §12 long-run supervisor — memory growth, queue growth and
latency trends are *plain numeric code* (an LLM reading numbers is `defined-is-not-informative`
territory); build the counters in Python, let qwen only *name* anomalous patterns the counters
flag. §20 hardware observatory — P3 until the box's travel pattern settles and §19's nightly
report proves itself on local telemetry first. §14's fourteen named workers — start with the ~8
lenses above and let the precision ledger decide which specializations earn existence
(charter §14's own "benchmark whether specialization improves findings").

## 4 · The smallest practical system (three components, two of them extensions)

- **C1 — findings ledger (P0, the only genuinely new component).**
  `.git/tepna-mutation/findings/ledger.jsonl` + `tools/findings-ledger.mjs`. Schema = charter
  §15 verbatim (ID, category, severity, confidence, component, evidence, failure scenario,
  affected invariant, suggested verification, suggested fix, status). Dedup key:
  `hash(root-cause-class + file + invariant)`. Status lifecycle: new → confirmed | rejected |
  duplicate | fixed | regression. Emits per-lens precision (`confirmed / triaged`) so §2.5's
  bands are computable. Every worker below writes ONLY through this.
- **C2 — lens runner (P0, generalize `dsp-review-qwen.mjs`).** The existing tool already has
  chunking, journaling, resume, busy-yield, selftests; convert its two hardcoded prompts into a
  lens table (`{id, scope-glob, question, schema}`) covering jobs 2–5. Diff-scoped mode reads
  `git log --since=24h --name-only`.
- **C3 — nightly audit step (P0, extend `qwen-idle-driver.sh`).** After the existing
  draft/review/adversary chain: run diff-scoped lenses on the last 24 h, one state-machine
  adversary rotation slot, test-gap on changed files; then render ONE deduplicated report
  (`REVIEW-REPORT.md` already exists — extend it to answer §19's six questions: what changed,
  what got riskier, what is newly untested, what could fail silently, what to test next, what is
  merely speculative).

Jobs 6–10 are additional lenses/modes on C1+C2 once precision data exists — no new machinery.

### Priority map (charter §21)

| rank | item | frequency | verification | automation |
|---|---|---|---|---|
| P0 | C1 findings ledger + precision metrics | per-finding | coordinator triage writes status | L1 |
| P0 | C2 lens runner conversion | nightly + per-push | per-lens, per §2.5 bands | L1 |
| P0 | draft-pipeline fixes (projection charset, recompute-fallback) | with each crawl | by construction | L1→L2 |
| P0 | suite-realm re-verification of drafts before adoption (amendment §2.1 — 2/48 realm-divergent, 4/48 non-round-tripping) | per adoption batch | re-execution in the consuming realm | L1 |
| P0 | adopt the 57 existing drafts (realizes the pipeline's value; the first metric datum) | once | `npm run check` + mutation re-run | normal PR |
| P1 | state-machine adversary (job 3) | nightly rotation | read-one-function check → pytest case | L1 |
| P1 | test-gap detector (job 4) | per-push | gap is binary-checkable | L1→L2 |
| P1 | nightly report (C3, §19) | nightly | it IS the triage surface | L1 |
| P2 | failure-mode enumeration + fault scenarios (jobs 5–6) | weekly rotation | pytest harness | L1 |
| P2 | contract audit via railed agent (job 7) | weekly rotation | evidence-needed column | L1 |
| P2 | ops-log anomaly scan (job 8) | nightly, local logs | cited log lines | L1 |
| P3 | doc-drift + scientific adversary (jobs 9–10) | weekly | cited both sides / coordinator | L1 |
| P3 | hardware observatory (§20) | after §19 proves out + box home | — | L1 |
| P4 | LLM long-run supervisor (§12 as stated) | — | superseded by plain counters | — |

## 5 · Trust boundaries and automation levels (charter §13, §18)

§13 is adopted verbatim — it restates the standing §0 invariant and the methodology brief's
containment section; no daylight between charter and house rules. Levels, with pre-stated
promotion bands (house rule: bands before data):

- **Level 1 (observe)** — where every worker starts and where most stay. Findings → ledger →
  coordinator triage.
- **Level 2 (propose: auto-opened PR, never merged by qwen)** — earned per lens at ≥20 triaged
  findings with ≥60 % confirmed. Note Kodiak merges green PRs automatically, so Level 2 PRs MUST
  carry the `do-not-merge` label at creation; the coordinator removes it after review — the
  label, not the bot, is the human gate.
- **Level 3 (controlled auto-fix)** — **closed this quarter, deliberately, including for
  "trivial" classes.** Scientific algorithms, acquisition behavior, synchronization, evidence
  logic and recovery policy are below autonomous merge authority per the charter; everything
  else stays below it too until the ledger has a quarter of precision history. Revisit with data.

## 6 · Metrics (charter §17)

Tracked in C1, reported in the nightly report: findings generated / confirmed / rejected /
duplicate per lens; drafts adopted into the suite (the flagship metric — **44 of 48** landed 2026-08-27 via #1860,
with the 4 exclusions and one surviving planted mutant recorded there); mutants killed by adopted drafts; pytest cases born from
state-machine findings; regressions caught. Explicitly NOT success metrics, per charter: token
counts, agent counts, finding counts. Kill criteria per §2.5.

## 7 · Done when

- [ ] Owner ratifies the priority map (or amends ranks in place).
- [ ] C1 + C2 + C3 built and the first nightly report produced.
- [ ] The 57-draft adoption PR lands (value realized, metric unblocked).
- [ ] First precision numbers exist for ≥2 lenses; §2.5 bands applied once.
- [ ] Follow-up brief records what the first month of precision data says about which
      charter sections earned expansion.

---

## Appendix — the owner's charter (2026-08-27), condensed capture

*Every section and every list item is preserved; phrasing is compressed. This is a faithful
condensation, NOT a byte-verbatim transcript — the original as issued lives in the coordinator
session transcript of 2026-08-27. Section numbers above refer to this structure.*

```
TEPNA — TECH LEAD PROPOSAL: TURN LOCAL QWEN INTO A CONTINUOUS ENGINEERING/QA RESOURCE

ROLE: Act as Tepna Technical Lead. The project has access to effectively free local Qwen
inference. Current local testing suggests Qwen is approximately Haiku-class for this project's
coding/review workload. Do NOT assume Qwen is a senior architect. Instead, determine where
massive amounts of inexpensive inference can produce the greatest engineering benefit while
keeping correctness externally verifiable. The goal is NOT "use AI everywhere." The goal is:
use Qwen where it is cheap, tireless, parallelizable, and verifiable.

1. AUDIT HOW QWEN IS ALREADY USED — read the repo, recent PRs, CI/test infrastructure, agent
   instructions, existing machinery. Classify each existing use: KEEP / EXPAND / RESTRICT /
   REPLACE / REMOVE. Determine whether current usage produces measurable value.
2. PROPOSE A QWEN ENGINEERING PROGRAM — prioritize tasks that are high volume, repetitive,
   parallelizable, adversarial, cheap to verify, difficult to exhaust manually, useful over
   long periods. Avoid tasks where Qwen's judgment becomes sole authority.
3. CONTINUOUS CODE AUDITING — recurring audit of new commits/changed files/acquisition paths/
   state machines/error handling/resource ownership/concurrency/artifacts/numerical code/
   protocol handling. Each worker has ONE narrow question (find resource leaks; find paths that
   leave the daemon apparently healthy while acquisition stopped; find transitions without
   recovery; find exceptions that terminate acquisition silently; find duplicate or
   contradictory state). No generic "review everything" agent.
4. FAILURE-MODE ENUMERATION — per state machine: timeout, disconnect, duplicate/delayed/missing
   event, device disappearance/return, restart, partial transfer, corrupt data, resource
   conflict, stale state, clock anomaly, unexpected device state. Each credible finding names:
   component, trigger, expected behavior, actual/possible behavior, severity, proposed test.
   No automatic production changes.
5. TEST GENERATION — find behaviors not actually verified; propose the smallest useful test and
   the invariant it proves; implement only through the normal workflow. Prioritize state
   transitions, recovery, races, resource conflicts, malformed inputs, duplicate events,
   restart, artifact integrity. Test externally meaningful behavior, not implementation trivia.
6. FAULT INJECTION — generate scenarios + expected invariants (BLE disconnect at each phase,
   adapter unavailable/renumbered, Wi-Fi loss, device disappearance, incomplete/corrupt
   artifact, host restart, process crash, duplicate/late events, busy resources). CI/hardware
   tests determine survival.
7. STATE-MACHINE ADVERSARY — per machine: enumerate states and legal transitions; search for
   illegal, missing, dead, impossible states; recovery loops; "apparently healthy but actually
   dead". Concrete test whenever possible. Recurring automated audit.
8. CONTRACT / POLICY AUDIT — compare implementation to contracts (Acquisition Evidence,
   Execution Witness, clock contract, device identity, artifact transactions, evidence tiers,
   synchronization, provenance). Output: RULE → CODE PATH → OBSERVED BEHAVIOR → COMPLIANT /
   POSSIBLE VIOLATION → TEST OR EVIDENCE NEEDED. Qwen may not redefine rules.
9. REAL-DATA ANOMALY REVIEW — batches of real acquisition logs/evidence: unusual timing,
   unexpected state sequences, repeated reconnects, long gaps, contention, failed harvests,
   abnormal artifact sizes, divergence from successful sessions. NOT physiological truth; an
   operational anomaly detector; findings point to observable evidence.
10. SCIENTIFIC ADVERSARY — attack claims: hidden assumptions, counterexamples, confounders,
    edge cases, experiments, falsification criteria (timing assumptions, PPG interpretation,
    PAT inference, event boundaries, signal quality, artifact rejection, synchronization).
    Always a hypothesis/review, never silently truth.
11. DEAD CODE / COMPLEXITY AUDIT — unused code, unreachable paths, duplicate abstractions,
    obsolete compat layers, contradictory config, unnecessary wrappers, stale docs, tests that
    no longer test production behavior. Nothing auto-deleted; verify by search + tests + human.
12. LONG-RUN TEST SUPERVISOR — inspect output of 100/1k/10k acquisition-recovery cycles for
    memory growth, leakage, connection accumulation, queue growth, stale state, latency growth,
    recovery degradation, rare failures. Numerical evidence required.
13. QWEN MUST NOT BECOME THE AUTHORITY — may inspect/classify/propose/generate tests and
    scenarios/identify anomalies/suggest/challenge; must not decide scientific truth, production
    correctness, release readiness, safety-critical behavior, architecture, evidence
    sufficiency. Acceptance stays with tests, measurements, contracts, physical experiments,
    human/strong-model review.
14. MULTI-AGENT STRATEGY — parallel specialized workers over one giant context (BLE, CPAP,
    O2Ring, state-machine, recovery, resource, artifact-integrity, timing auditors; DSP
    adversary; test-gap; documentation; security/input; dead-code; long-run anomaly).
    Structured, deduplicable findings. No agents for appearance; benchmark specialization.
15. FINDINGS FORMAT — ID, category, severity, confidence, component, evidence, failure
    scenario, affected invariant, suggested verification, suggested fix, status. Prefer "here
    is a reproducible failure" over "this looks suspicious".
16. DEDUPLICATION AND FALSE-POSITIVE CONTROL — group by root cause/file/invariant/mechanism;
    track new/confirmed/rejected/duplicate/fixed/regression; measure precision over time;
    narrow, re-prompt, de-scope or remove low-precision workers.
17. MEASURE WHETHER QWEN IS HELPING — findings confirmed, false positives, bugs found before
    tests/physical testing, useful tests and scenarios, regressions detected, developer time
    saved. NOT prompts/tokens/agents/finding counts. Success = Tepna improves.
18. AUTOMATION LEVELS — L1 observe; L2 propose (PRs, cannot merge); L3 controlled auto-fix for
    extremely low-risk categories only, with explicit rules; science/acquisition/sync/evidence/
    recovery below autonomous merge unless specifically approved.
19. NIGHTLY AUDIT — recent changes, changed tests, state-machine attack, failure paths,
    contract comparison, test gaps, operational logs, unresolved findings → ONE deduplicated
    report answering: what changed, what became riskier, what is newly untested, what could
    fail silently, what should be tested next, what is merely speculative.
20. CONTINUOUS HARDWARE OBSERVATORY — consume capture-box telemetry (daemon logs, Execution
    Witness, Acquisition Evidence, BLE events, device state, resources, harvest results,
    artifact metadata); flag deviations from successful patterns; never alter hardware behavior
    on an LLM conclusion alone.
21. IMPLEMENTATION PROPOSAL — per workload: purpose, input, prompt, output schema, frequency,
    verification, expected value, compute cost, false-positive risk, automation level, owner.
    Rank P0–P4.
22. MOST IMPORTANT CONSTRAINT — do not turn Tepna into an AI project. Tepna remains an
    acquisition system, scientific instrument, evidence system. Qwen is infrastructure around
    it. Increase coverage, skepticism, testing, failure discovery, observability, maintenance
    capacity — not architectural complexity, undocumented behavior, autonomous decision-making,
    or false confidence.

FINAL QUESTION — the 10 highest-value continuous jobs, then the smallest practical system that
implements them. The goal is an inexhaustible, skeptical, automated QA/engineering assistant
that constantly tries to find what the humans missed.
```

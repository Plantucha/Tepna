<!--
  DEVELOPMENT-METHODOLOGY-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — methodology description, owner-requested 2026-08-27) · **Created:** 2026-08-27

# How this project is coded — the Tepna development methodology

> **Audience.** Two readers at once: an AI coding agent picking up work in this repo (read this
> after `ORIENTATION.md`, before your first edit), and an outside engineer studying how a
> solo-owner, multi-agent AI development operation runs in practice. Everything here is
> *descriptive of what already exists* — the normative sources remain `CLAUDE.md` (which wins on
> every conflict), `CONTRIBUTING.md`, and the gates themselves. Nothing in this brief adds a rule.

> **Provenance.** Consolidated 2026-08-27 by the coordinator session from `CLAUDE.md`, the brief
> corpus, the session-memory index, and a year of measured incidents. Dates and numbers below are
> quoted from those records, not re-measured here; where a number matters to a decision, re-measure
> it (`brief-numbers-need-remeasuring` is a standing memory for a reason).

---

## 0 · The one-paragraph model

One human owner. Several concurrent AI coding sessions (Claude) with different standing roles.
One free local model (qwen3-coder:30b on the owner's GPU) doing background search-and-propose
work. One repository that is simultaneously the product, the coordination medium, and the shared
memory. Safety and quality come **not from trusting any agent** but from three structural choices:

1. **Determinism** — the build is owned and reproducible, so code identity is a hash, and "did
   anything change" is computable.
2. **Written-down failure** — every operational rule is bought by a specific measured incident and
   recorded with its date and numbers, in the exact place the next agent will read before
   repeating it.
3. **Claims become computed values** — wherever a human or agent used to *assert* something
   ("export-inert", "this doc matches the code", "this commit is a release"), machinery now
   *computes* it, and CI reds when the computation disagrees.

## 1 · The actors and their trust model

| actor | role | trust boundary |
|---|---|---|
| the owner | ratifies contracts, issues charters, holds the corpus and the hardware | final authority; some decisions are explicitly "the owner's to accept" |
| coordinator session ("Mutator") | the owner's deputy for lower-level decisions; triages, assigns, lands PRs, stewards the queue | may decide anything below owner-level; postpones what is genuinely above it |
| worker sessions (hardware box, papers/statistics, brief runner) | execute briefs, own their worktrees and PRs | peers to each other; take coordinator direction as the owner's |
| qwen (local model) | mutation-test drafting, DSP review, adversary audit, bounded read-only Q&A | **hard invariant: widens what is SEARCHED, never what DECIDES** — see §7 |
| CI (GitHub Actions) | agent-neutral detection layer | the only enforcement that applies to *whoever* opened the PR |

Two load-bearing facts about this table:

- **Sessions cannot see each other's context.** Coordination happens through files (briefs,
  CLAUDE.md, ledgers), through git, and through explicit messages. A claim made in a peer message
  is *ungated* — it passed no test — and the receiving session must verify it before acting on it.
  Both directions of that failure have occurred (a false negative ordering redundant work; a false
  RED propagating faster than any false green would have).
- **Model output is never a verdict.** This applies to the strongest session as much as to qwen:
  the suite decides, the gates decide, the recorded output of real code decides. An agent's
  confidence carries no information about its correctness — that sentence is in the memory system
  because it was measured, painfully.

## 2 · Product shape: chosen so that verification stays tractable

The suite is a fleet of single-signal physiological analyzers (SpO₂, HRV, raw RR, CGM, raw ECG,
CPAP EDF, IMU), a frozen-name event bus, and a fusion layer. Deliberate constraints:

- **Every app ships as one standalone HTML file** bundled from plain `.js` modules by a repo-owned
  deterministic bundler (`tools/build.mjs`). No network at runtime, no CDNs, no fonts beyond
  system stacks. A bundle is a *pure function of its source*.
- Because of that purity, **`manifestHash`** — SHA-256 over the sorted set of inlined asset texts —
  is the sole executed-code identity. It moves only on a real code change. The retired
  alternative (a runtime `buildHash`) was non-deterministic and is kept only as inert legacy
  metadata; no gate reads it.
- **Three generated trees** (the 11 owned bundles, their served `docs/` copies, the 10 analysis
  tools) each have a builder and a drift-checker, and `npm run check` runs all of them. The
  historical failure this prevents: a fleet re-bundle green on every local gate that redded CI on
  seven stale served copies nobody had rebuilt.

The domain rules (metric-only units; the floating wall-clock Clock Contract; evidence badges on
every user-facing number; literature use with mandatory checkable citations) are all instances of
one meta-rule: **honesty is structural**. A missing timestamp is `null`, never `now()`. A number
without a citation keeps the suite's own evidence tier, never an upgraded one. A statistic is
quoted with its window and sample size or it is not a measurement.

## 3 · Documentation as the memory of a multi-agent system

- **`CLAUDE.md`** is the constitution: loaded by every session, authoritative on conflict. Its
  distinctive genre is the *failure-dated rule*: not "don't blanket-stage" but "a blanket add
  swept a concurrent session's files into commit `cabd7f7`, permanently — stage by explicit path."
  Several passages explicitly preserve their own falsification ("this sentence used to say X;
  measured on DATE, X is false for three of eight bundles; the CLAIM marker below is now
  machine-checked"). The corrected error is kept *visible* because the correction is the lesson.
- **Briefs** (`briefs/*-YYYY-MM-DD-BRIEF.md`) are the unit of work: ADR-style immutable dated
  filenames, status in a header line (exactly five values: PROPOSED · IN-PROGRESS · DONE ·
  REFERENCE · CHECKPOINT), `Supersedes:`/`Superseded-by:` links, follow-up briefs spawned by
  execution. Renaming or moving a brief is forbidden — filenames are cross-reference targets.
- **`DOCS-INDEX.md`** is the dashboard view; the `docs-ledger` test group machine-checks the whole
  lifecycle (stray briefs, malformed statuses, dead links, one-sided supersede pairs,
  filename↔date mismatches).
- **Session memory** (per-machine, outside the repo) holds distilled *method* lessons — "measure
  the thing, not a proxy", "an empty result is not a negative", "pre-state the threshold before
  the measurement" — each one an incident distilled to the transferable rule.
- **Semantic search before building** (`tools/doc-search.mjs`, local bge-m3 embeddings over ~14k
  chunks) is a mandated pickup step: grep finds only your own vocabulary, and twice in one week a
  session nearly rebuilt machinery that existed under other names. ⚠️ Primary dev machine only —
  never pointed at CI, clones, or other users; no gate may read its output.

**Why so much writing?** Because in a fleet of context-free agents, anything not written down is
re-derived — at best expensively, at worst wrongly. The repo optimizes for the *next* session's
first ten minutes.

## 4 · The gate stack — layered by what each layer can see

| layer | gate | what it proves |
|---|---|---|
| behavior | `tests/dex-tests.js` via Node CI **and** `Dex-Test-Suite.html` (same assertions, plus browser render rigs driving real bundles in iframes) | the modules honor their public contracts; a signature change reds both lanes |
| code identity | GATE A (`verify-provenance.html` / `tests/verify-manifest.mjs`) | every shipped bundle's `manifestHash` equals the ledger |
| artifact integrity | GATE B — content-addressed fixtures: `hash(input) + manifestHash → hash(output)` | committed inputs, outputs, and producing code are all still the recorded bytes |
| reproducibility | GATE C — equivalence legs: `compute(committed input) ≡ committed export` | *current* code still reproduces the shipped exports; a moved output reds |
| commit shape | `tools/commit-shape.mjs` in CI | no commit carries the blanket-add/ref-move corruption shape (0 false positives over all releases; refuses on shallow clones rather than reporting green) |
| docs | `docs-ledger`, `claude-md-claims`, `citation-ledger` | brief lifecycle intact; `CLAIM`-marked numbers in CLAUDE.md match the builders; every reader-facing DOI sits beside its real first author |
| release | `release-ledger` + changesets | code that moved requires a pending changeset; versions computed by tool from a green tree, never hand-picked |
| python lane | `capture-host/check.sh`: ruff · shellcheck · pytest with a **100 % branch-coverage floor** | and the floor is *evaluated*, not assumed — a pytest line without `--cov` doesn't fail the floor, it never examines it |

Two design principles inside this stack:

- **Prevention is agent-coupled; detection is agent-neutral.** Hooks (`.claude/hooks/*`) run only
  for a Claude Code client in a checkout that pulled them — one client, one checkout. So the
  serious guards are CI checks that read *properties of the resulting commit*, which apply to
  whoever opened the PR. Where neither works (a rebase silently reverting source), the answer is
  prevention-only tooling (`tools/rebase-safe.mjs`, which asks the *builders* which paths are
  generated and fails closed) plus a verification habit: after any rebase, grep your own change
  in `git show HEAD` before pushing.
- **Denylist over allowlist for closures.** The export-inertness projection (`computeHash`) treats
  any *unknown* asset as inside the compute closure: an allowlist that forgets a module fails
  open (the gate goes blind); a denylist that forgets one merely over-flags. False alarms are
  accepted; a gate that cannot see is not.

## 5 · The epistemics: the named defect class and its counter-rules

The dominant recurring defect, across independent tools and sessions, has one shape:

> **A check that ran, and reported success about something it never examined.**

Measured instances: `pytest | tail -20` reporting `tail`'s exit code while coverage failed;
`gh pr checks | tail` cutting the two failing checks out of the listing; a test filter matching
nothing and reading as a pass; an `npx` with no binary exiting 0; a "sync check" comparing refs
while the tree was 214 files stale; a probe whose own filter's blind spot read as a finding about
the file. The standing counter-rules, each earned:

1. **Never read a verdict off a truncation.** Aggregate (`grep -c`, JSON `--jq` group-by, a TOTAL
   row); tail only for detail afterward.
2. **Capture the command's own exit code before any pipe.**
3. **An empty result is not a negative** until you've proven the query examined the population —
   state your filter *with counts*.
4. **Pre-state the threshold before the measurement.** Decision bands written after seeing data
   are not decisions. (This governs the statistics work as much as the engineering.)
5. **Measure the thing, not a proxy.** Authorship metadata is not content evidence; a ref
   comparison is not a tree comparison; a file's presence is not the data's presence (194 nights
   of SpO₂ headers; 193 were a `-1` fill).
6. **A number without its window and sample size is not a measurement.** The same repo yielded
   "median merge gap 8.6 min" and "13.1 min" in the same hour from different windows.
7. **Never wait on a process by command-name pattern** — `pgrep -f` matches the waiter itself (13
   shells found mutually deadlocked). Own the PID or use a `$$`-unique sentinel; prefer harness
   background-task notification over polling at all.
8. **If two populations look inseparable, run the query before writing "inseparable".** Five
   reviewers falsified such a claim in minutes with one `git log`; the resulting detector now
   runs in CI.

## 6 · Concurrency: how N agents share one repo without destroying it

- **Private worktrees** off `origin/main` for any change touching bundles, ledgers, or DSPs. The
  shared root is assumed stale-by-default and is fast-forwarded by a sync timer; "the ref is not
  the tree" is a section heading in CLAUDE.md because a plumbing ref-move once produced 47
  phantom deletions that a blanket add would have committed.
- **Stage by explicit path, always.** No `-A`, no `.`, no `-a`. Files you don't recognize belong
  to a concurrent session; finished-looking orphan work gets a temp-index *rescue snapshot*, never
  a merge and never deletion.
- **Serial queue drain.** Branch protection requires up-to-date branches, and auto-merge does not
  update them — so an armed, green, behind PR is a *deadlock*, not a wait (14 PRs once sat a full
  day, all green, nothing moving). The protocol: update ONE green PR → let it merge → update the
  next. Tools (`land-pr`, `queue-doctor`) encode the four states needing opposite responses.
  WIP cap ≤ 4 open PRs; one PR per *work-unit*, not per increment (one fix once shipped as five
  PRs and paid five CI races for it).
- **Versioning without coordination.** Parallel coders never pick a version number: each work-unit
  drops a collision-free changeset file; `tools/release.mjs` folds them, computes the SemVer once
  from a green tree, and refuses to release while any corpus-backed fixture is unverified.
- **Brief edits check for concurrent answers first** (hook + fetch): the one artifact several
  sessions reach for at once merges *cleanly* when two sessions answer the same section — the
  absence of a conflict is the signature of the bug, not reassurance.
- **Branch names collide across sessions deriving the same slug** — plain `--force` is forbidden;
  `--force-with-lease` turned the one real collision into a near-miss.

## 7 · The local-model lane: containment by architecture

qwen3-coder:30b runs free on the owner's GPU and is treated as an *instrument with a known error
model*, not a colleague. The design invariant (ratified, written into the fleet-expansion brief):

> **The model widens what is SEARCHED, never what DECIDES. Local inference stays out of every
> verification path.**

Concretely:

- **Mutation pipeline** (`mutate.mjs` → `mutation-crawl.mjs` → `mutation-suite.mjs --draft`):
  mutants are generated and probed mechanically; qwen proposes distinguishing inputs and drafts
  assertions — but every *expected value* in a draft is the real code's **recorded output**, never
  a model claim, and every projection is machine-verified to discriminate real from mutant before
  a human reads it. A draft can still pin a *bug* in place (one of 56 pinned a TypeError its prose
  mislabeled as "validation"), which is exactly why drafts are proposals with a mandatory human
  read, not patches.
- **DSP review + adversary audit** (`tools/dsp-review-qwen.mjs`): house-rules review and
  concrete-attack lenses over every DSP function, findings journaled as untriaged proposals with
  model-written draft fixes explicitly marked "never apply blind".
- **Read-only agent mode** (`tools/qwen-agent.mjs`): jailed tools (read/grep/list/doc-search — no
  write, no shell, no network, path-confined), the live CLAUDE.md distilled into its system
  prompt. Calibration finding (measured, three runs): the model investigates competently but
  cannot reliably *conclude* — it narrates next steps instead of answering and ignores prose
  instructions to stop. The fix was structural, not prompt-side: the final round is issued with
  no tools attached, so answering is the only possible move. General lesson: **small-model
  agentic failure modes are fixed with rails, not with better prompts.**
- **Idle automation**: a systemd timer runs the draft → review → adversary chain whenever the
  pipeline is idle, so model work accumulates while paid-session quota is exhausted; a second
  timer keeps the embedding index fresh. Both yield to the pipeline (VRAM is the contended
  resource) and both fail soft.

Honest capability rating (owner-requested, 2026-08-27): roughly Haiku-class judgment on bounded
single-shot tasks under a verifying harness; below that agentically without rails; poor
calibration — it never says "could not establish" unprompted. Correctly sized for this role and
only this role.

## 8 · Physical grounding

The suite is validated against a real multi-device corpus (O2Ring, Polar H10, Polar Verity Sense,
CPAP EDF; ~100 foldable nights across several trees). Standing rules born from it: derive HR from
raw waveforms, never from device summary files (two devices' summaries were measurably dishonest);
a device timestamp column can be *drawn* (synthesized from sample index) rather than measured, and
provenance of a timebase is computed, not assumed; clock comparisons go through the host-axis
machinery (running median over anchor pairs, refusal bounds, no extrapolation past the last
measurement) rather than any single-number ppm. The corpus itself is gitignored; CI sees committed
*synthetic twins* built adversarially (a 14-hour-gap CGM night, etc.), because a real gappy night
would have been invisible to CI — **an adversarial committed twin beats a real one**.

## 9 · What generalizes (the publishable core)

For an outside reader, the transferable ideas, ranked by how hard they were to earn:

1. **Turn claims into computed values.** Every place an agent asserts a property, ask what
   machinery could compute it and red on disagreement. This is the single highest-leverage habit.
2. **Failure-dated rules.** Write the incident into the rule, with numbers, at the point of use —
   and when a rule is falsified, keep the correction visible instead of silently rewriting.
3. **Prevention is agent-coupled; detection is agent-neutral.** Budget accordingly: hooks for the
   client you control, commit-property CI checks for everyone else.
4. **Name your dominant defect class and build culture around it.** Here it is
   "examined-nothing"; yours will differ, but it exists.
5. **Contain cheap models by architecture.** Verified-search-only roles extract real value from a
   local 30B with zero trust required; recorded-real-output beats model-claimed-expected every
   time.
6. **The repo is the coordination medium.** Context-free agents re-derive whatever isn't written;
   optimize documents for the next agent's first ten minutes, and machine-check the documents.
7. **Serialize what must serialize; make everything else collision-free.** Changesets for
   versions, per-app ledger fragments, explicit-path staging — the goal is that parallel work
   *composes* rather than races.

**Publication scope note (owner decision pending):** the repo is public already; a methodology
write-up is consolidation, not disclosure. Keep out: device serials, night-level health data,
tailnet IPs/hostnames, and anything from `uploads/`. Everything in this brief clears that bar.

## 10 · Done when (for the REFERENCE lifecycle)

Not executable — this brief has no acceptance items. It is re-verified by reading: when a claim
here drifts from `CLAUDE.md` or a gate, fix THIS file (CLAUDE.md wins), and stamp the header's
`last-verified` date on any substantive re-check.

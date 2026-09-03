<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** CHECKPOINT (living — last-verified 2026-09-03) · **Created:** 2026-09-03

# The owner decision queue — 8 calls that unblock ~44 briefs

**One-line: the brief backlog is majority-blocked on decisions only the owner can make, and those
decisions collapse into EIGHT — of which one, a scheduling request rather than a judgement, unblocks
thirteen briefs on its own.**

This is a **CHECKPOINT**, not a work-plan: it is a living index of work-state, it holds no "Done when"
of its own, and it is deliberately **not** a `PROPOSED` brief — a backlog index that counted itself as
backlog would be measuring its own tail. Re-verify and restamp `last-verified` rather than closing it.

---

## 0 · The predicate, stated first — because three sessions got three different counts today

Counting open briefs produced **73 · 78 · 85** in one afternoon, from three sessions reading the same
repo. Every discrepancy was a predicate, not a disagreement about facts, so the predicate goes at the
top and every number below is computed under it:

> **OPEN := the first whitespace-delimited token after `**Status:**` is `PROPOSED` or `IN-PROGRESS`,
> over `git show origin/main:<file>` for `briefs/*-BRIEF.md`.**

Under it, on 2026-09-03: **487 briefs · 383 DONE · 41 PROPOSED · 32 IN-PROGRESS · 31 REFERENCE ·
1 CHECKPOINT** ⇒ **73 open**.

The three ways it went wrong are worth keeping, because each is cheap to repeat:

| count | what it actually measured |
|---|---|
| **78** | a session's own **working tree**, which was the shared root and stale. The tell was not the file delta — it was the `IN-PROGRESS`/`PROPOSED` split flipping 51/27 → 32/41 |
| **85** | `REFERENCE`/`CHECKPOINT` counted as open (**+30** living docs that can never close), and a substring test for `DONE` that silently closed **18** genuinely-open briefs whose parentheticals merely mention the word |
| **73** | the predicate above |

**Living docs are not backlog.** 32 of the 487 are `REFERENCE`/`CHECKPOINT` by design; including them
inflates the backlog by nearly half the target and can never be worked off.

## 1 · Why the count target cannot be met by triage — and this does not depend on the count being exact

- **Closure rate, measured by `DONE —` stamp date: 6 on 2026-09-02** (a fleet-wide drain day, several
  sessions triaging all day) and **1 on 2026-09-03**. A 78 → ≤20 target is ~58 closures in two days,
  **~29/day against a measured best of 6.**
- **Even closing everything unblocked leaves >3× the target.** Only **10** open briefs name no blocker
  at all in their header; close all ten and **63** remain.
- **Triage does not close briefs — it converts *unknown* into *known-blocked*.** **52 of the 73** open
  briefs already carry a 2026-09-01..03 triage stamp; only **21** are genuinely un-triaged. That
  conversion is the thing that stops re-derivation, and it is valuable, but it does not move the count.
- ⚠️ **The metric has a mandated creation term.** `CLAUDE.md` §📌 requires spawning a follow-up brief
  after executing one, so **executing briefs creates briefs**. Creation by filename date around the
  last drain campaign: **08-23: 13 · 08-24: 9 · 08-26: 9 · 08-27: 12**. A target expressed as a raw
  open count, against a corpus with a structural creation term, is a treadmill — the argument is about
  the metric, not about effort.

**Composition, corrected 2026-09-03:** ~**44 of 73 (60 %)** are owner-gated. An earlier figure of
**85 %** was wrong: the regex matched the word "owner" anywhere in the header, and `**Owner:** Heron`
is a **field naming who owns the brief**, not a blocker. That mistake — and the two beside it in the
table above — are all one failure: *a token was matched, and a different question was answered.*

---

## 2 · The eight decisions

⚠️ **Bucket assignments are read off each brief's own status header, which is a CLAIM and is not
re-verified here.** A stamp-date filter cannot find the mis-triaged: `DELIVERY-PROCESS-OVERHAUL` is
stamped and its header contradicts its own ticked boxes. Treat this as an index of what the briefs
*say* blocks them.

### 🥇 D1 · Attended box time + a wear schedule — **unblocks 13**

The highest-leverage line on this page, and the cheapest to say yes to: it is a **scheduling request,
not a judgement**. Several items are a single worn night; the three Polar items are one
strapped-idle-H10 window.

`CPAP-ACQ-P4-SPOOL-TRANSACTION` · `CPAP-SPOOL-ACQUISITION` · `KNOWN-CLOCK-ADVERSARIAL-CAPTURE` ·
`VIGIL-COEXISTENCE-FOLLOWUPS` · `ZEPHYR-INSTRUMENT` · `O2RING-PRESENCE-TRIGGER-IMPL` ·
`POLAR-OFFLINE-DOWNLOAD` · `POLAR-ONBOARD-BACKUP` · `POLAR-ONBOARD-BACKUP-FOLLOWUPS` ·
`O2RING-RAW-DUAL-WAVELENGTH-FOLLOWUPS` (needs daylight) · `O2RING-BUZZ-FIDUCIAL` ·
`OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS` · `OXYII-PRESENCE-MODEL`

### D2 · Vigil deploy/config authorization — **4**

One authorization over a **named set** of box touches. Deploys to `vigil` are owner-authorized only and
no peer relay changes that boundary, so these cannot be self-served however small each one is.

`CAPTURE-HOST-FOLLOWUPS-II` (`deploy/enable-clock-control.sh`) · `DEVICE-RATE-TRUTH` ·
`RADIO-FAILOVER-DISTRESS-SIGNAL` (the config key) · `OXYII-ACQUISITION-CHARTER`

### D3 · Metric-identity / evidence-tier rulings — **4**

`R5-HR-TRIPLET-FOLLOWUPS` (`median`→`mean` moves a **published field**; needs a ruling on
`hrStatMixed` semantics) · `PPGDEX-ALGORITHM-DEEP-DIVE` (its eight open items are **one** question) ·
`DEEP-AUDIT-V-FOLLOWUPS` · `AUDIT-FOLLOWUPS`

### D4 · Purchases — **3** (a "no" closes them as negatives, which is why they are cheap)

`O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` (a second O2Ring) · `R5-HR-TRIPLET-REFERENCE` (the owner has
confirmed no ResMed oximeter module exists — a purchase, not a cable) · `CROSS-DOMAIN-METHODS-FOLLOWUPS`

### D5 · Programme greenlights — **3**

`QWEN-ENGINEERING-PROGRAM` (awaiting ratification; only the P0 idle-lane DSP review runs without it) ·
`SPORT-CAPTURE-ANDROID` (no fleet session owns an Android toolchain) · `MEASUREMENT-PROVENANCE-ROADMAP`
(none of its six done-when items can start before the call)

### D6 · The box privilege model — A/B/C

`VIGIL-AUTO-UPDATE-FOLLOWUPS` — nothing else in that brief moves until the pick is recorded, and
`VIGIL-OFFLOAD-AND-RETENTION` sits downstream of it.

### D7 · The trio-hat statistical judgement — **2, and they are one call**

`TCH-FUSED-ROBUST-HAT` · `TRIO-POWER-N15-FINDINGS` — the new-generation fused triple
(σ 2.87/1.18/0.68, ρ\* 0.576) is with the owner as a planted-sigma check.

### D8 · Scope/gate calls

`O2RING-RAW-DUAL-WAVELENGTH` — decide whether a two-channel ingest is wanted **before** anyone builds
it, which is the cheapest possible moment to ask.

---

## 3 · Not the owner's — 18 briefs waiting on SESSIONS

This is the half that effort can move, and it was hidden by the same regex that inflated D1–D8. Most
carry a next step of the form *"one corpus run"* or *"one work-unit, no new code"*.

| owner | briefs |
|---|---|
| **Osprey** (13) | `MUTATION-COVERAGE-SELECTION` · `MUTATION-PIPELINE-INTEGRITY` · `MUTATION-PROGRAM` · `MUTATION-PROGRAM-FOLLOWUPS` · `MUTATION-SUITE-FOLLOWUPS` · `RUN-POLAR-MUTATION-PASS` · `PAT-FORENSICS-AXIS-LEG-ASYMMETRY` · `PAT-FORENSICS-FIDUCIAL-JITTER` · `PAT-FORENSICS-WINDOW-ORACLE` · `PAT-FORENSICS-WINDOW-REGIMES` · `PAT-NO-VALID-ANCHOR` · `PAT-OFFSET-ESTIMATOR-FOLLOWUPS` · `CROSS-DEVICE-DRIFT-AND-CLOSURE` |
| **Heron** (4) | `AS11-AUTO-SESSION-DETECTION` (*"no hardware needed, only the analysis"*) · `PYTHON-TYPES-AND-FORMAT` · `VIGIL-OVERNIGHT-FINDINGS` (*"write P3.1's decision down"*) · `O2RING-PHASE4-PREMISE-REVIEW` |
| **Kestrel** (1) | `VIGIL-SELF-SUSTAINED-FOLDING` |

**Arguable, listed rather than counted:** the three owner-**issued** charters (`MUTATION-ACCOUNTING-LOOP`,
`PAT-ROOT-CAUSE-FORENSICS`, `OPERATIONAL-MATURITY-ROADMAP`) are owner-authored but session-executed;
`PER-DEVICE-ADAPTER-PINNING` is deployment.

## 3b · The pattern behind every number on this page — a query that answered a different question

Five instances on 2026-09-03, across three sessions, all one shape: **the query ran, matched exactly
what it was asked to match, and answered a different question than the one being asked.** None of them
errored, and in most the wrong answer was *plausible*, which is why none looked like a mistake:

| the query | what it answered | what was being asked |
|---|---|---|
| `git status` on the working tree | the **shared root's stale** copy | the state of `origin/main` |
| substring `DONE` in the status line | headers that **mention** the word | briefs that **are** done (closed 18 open ones) |
| `/owner/` anywhere in the header | briefs whose **`**Owner:**` field names anyone** | briefs blocked **on the owner** (inflated 60 % → 85 %) |
| the filename `20260902_232214` | a **device stamp**, ~21 min ahead of the box | a wall-clock instant (made a restart artifact read as a false start) |
| `gh pr checks` SUCCESS count | how many checks **passed** | whether any **failed** — 22 green hid one FAILURE |
| `SESSIONDETECT.csv` state column | what the detector **reported** | whether therapy **ran** — it read `Standby`/`0.1` through a proven 7 h night |
| a `capture.py` line number | where a statement sits in the **shared root** | where it sits on `origin/main` — the root is **103 commits behind**, so every coordinate was +10 |
| `^capture-host/[a-z_]+\.(py\|sh)$` | files whose names are **lowercase and underscores** | which runtime files shipped — `[a-z_]+` excluded a digit and a hyphen, dropping `o2ring.py` and `tepna-update.sh` |

**The guard is the one this document models: state the predicate beside the number.** A count without
its predicate is not a measurement, and every row above is legible the moment the predicate is written
down next to the result.

🔴 **And the sharpest one, because it is the only guard that failed while WRITTEN DOWN: a KNOWN
constraint with an UNKNOWN failure signature.** `AS11-AUTO-SESSION-DETECTION`'s own header already
schedules probes *"OUTSIDE a capture night because of the AS11 single-connection"* — the constraint was
documented, and documenting it bought nothing. Nobody had written down what contention **looks like**,
and it does not look like a failure: the detector does not error, time out, or fall silent. It answers
`Standby` with `mask_pressure=0.1`, which is **byte-identical to a quiet night**. That is why six days
passed with the file logging 1700 rows a day and nobody reading them as wrong.

> **Documenting a constraint is not documenting its failure mode, and only the second one is
> detectable.** A constraint tells you what not to do; a signature tells you how to notice it happened
> anyway. Where a mechanism can produce a plausible wrong answer rather than an error, write down what
> that answer looks like — otherwise the constraint is a note, and the failure is invisible.

⚠️ **The last two rows are operational, not rhetorical, and the first is a live hazard.**

- **The shared root checkout `/home/michal/Tepna` was measured 103 commits behind `origin/main`
  on 2026-09-03**, tree clean against its own HEAD — pure staleness, not anyone's in-flight edit. Its
  `capture.py` differs from main by 30 insertions and **259 deletions**. Any session reading a code
  fact there is citing a hundred-commit-old tree, and the failure is silent because the code is still
  *present*, just at different offsets and occasionally with different content. Two files that happened
  not to have drifted made two of four citations check out — an accident, not a method. **Read code
  facts with `git show origin/main:<path>`, or from a worktree off `origin/main`.**
- **Cite by SYMBOL, not by line number.** A line number is a fixed offset into a moving file; a symbol
  survives every edit above it. This is the same unit error as a fixed-width source scan, which
  re-scopes silently whenever the text above it grows — three of those were found in one file the same
  afternoon.

Two further corollaries earned the same day:

- **Count the reds, never the greens.** `[.[]|select(.bucket=="fail")]|length` cannot hide a failure;
  a success count always can.
- ⚠️ **An empty result is not a zero.** Writing that first corollary, the obvious form —
  `--json conclusion --jq '[.[]|select(.conclusion=="FAILURE")]|length'` — returned **empty** for every
  PR, because `conclusion` is not a field `gh pr checks` exposes and `2>/dev/null` swallowed the error.
  Empty reads exactly like "no reds". The fix is to make the **denominator visible**: report
  `total=27 fail=0`, never a bare `0`, so a query that examined nothing cannot present as a clean bill.

## 4 · The one brief this checkpoint tried to close, and why it stays open

`PAT-RESIDUAL-ATTRIBUTION` was going to be flipped to `DONE` here, on the argument that a brief left
open because its answer was "no" is miscounted. **That flip was made, hit a merge conflict, and has
been WITHDRAWN — the objection was right and this section was wrong.**

Osprey re-verified that brief the same day, in its own family, and recorded: *"the parked wording is
correct and deliberately not 'deferred' — leave it … **No stamp change is the correct outcome**;
re-verified so the next triager does not re-derive it."* Reading it against the actual content:

- **Its question is NOT answered.** *"What spends the last 20–40 ms"* has no answer; what is declined
  is the **acquisition route**, and n=0 is a measured statement about the corpus, not about the
  physiology. "Closed as a negative" describes a brief whose question was resolved in the negative,
  which this is not.
- **`PROPOSED` + an inline reason IS the sanctioned park.** `CLAUDE.md` §📌 states it in those words.
  The brief was already in the correct form, and the vocabulary was not the problem.
- So the count it contributes is **honest**: it is genuinely open work that nobody can start. Closing
  it would have made this checkpoint's own denominator prettier by mislabelling one brief — the exact
  bar-moving §0 exists to prevent.

⚠️ **Recorded because the near-miss is the lesson, not the outcome.** Two sessions agreed on a change
to a third session's brief; only a **merge conflict** surfaced that its owner had re-verified it hours
earlier with an explicit *leave it*. `CLAUDE.md` §📌 warns that brief overwrites usually produce **no**
conflict at all — answers land in different sections and the squash silently keeps the newer text. This
one collided only because both edits touched the same status line. **Agreement between two sessions is
not a substitute for reading the owning session's most recent stamp**, and a checkpoint that indexes
other people's work is exactly where that mistake is easiest to make.

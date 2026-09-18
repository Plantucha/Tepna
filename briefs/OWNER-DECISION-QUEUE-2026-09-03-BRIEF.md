<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** CHECKPOINT (living — last-verified **2026-09-17**) · **Created:** 2026-09-03 · **Owner rulings 2026-09-15 (Kestrel, one batch):** **D2 AUTHORIZED** — the named set of four, PLUS a new rail-keyed sidecar rule in `capture-host/writers.py` (floor 5, alongside `rule=stuck` at 200); authorization does NOT generalise to other box touches. **D4 — all three DECLINED**, closed as negatives, not deferrals. **D5 — all three RATIFIED.** **D8 — YES**, build the two-channel dual-wavelength ingest. ⚠️ **D6 WAS ALREADY DECIDED ON 2026-09-07 (option C) and this file still listed it as open** — the queue was `last-verified 2026-09-03` while the ruling landed four days later, so it manufactured a re-ask. **Still open: D3 and D7** — and as of **2026-09-17** BOTH have moved: **D3 is ONE call** (re-verified,
below), and **D7 is RULED — derive the mechanism first**, which converts it from a pending decision
into an analysis unit with no owner. **D6-adjacent note:** `BLE-TRANSPORT-REDESIGN` §1.1 was also ruled
on 2026-09-17 (**BUILD**, promoted to `GATT-HANDLE-MAP-2026-09-17-BRIEF.md`), and the fleet-wide
refuse-vs-annotate question was ruled the same day and recorded in `CLAUDE.md` §∅ rather than here,
because it is doctrine and not a queue item. ⚠️ **AND D3 IS NOT FOUR BRIEFS — RE-VERIFIED 2026-09-17 (Kestrel), brief by brief: two of its four were ANSWERED on 2026-09-06, nine days before the 2026-09-15 restamp, which did not re-read them.** `PPGDEX-ALGORITHM-DEEP-DIVE` was answered directly (*"YES, PpgDex's exported values MAY move, and all eight open punch-list items are approved"*) and is an engineering programme now, not a decision; `AUDIT-FOLLOWUPS` §4.4 was ratified the same day and its header reads **`Owner: none`**. What is actually left is **ONE genuinely parked call** — `R5-HR-TRIPLET-FOLLOWUPS` §3's `hrStatMixed` semantics — plus `DEEP-AUDIT-V-FOLLOWUPS` §1's three tiering POLICY calls, which that brief itself marks **no longer urgent** because `no-fabricated-tier` now runs at `KNOWN_UNREGISTERED = 0` (the 94-label backlog was discharged 2026-08-16 with 65 tiers owner-ratified). **This is the SECOND time this file has listed an answered question as open** — D6 was the first, and is recorded above. The cause is the same both times and is worth naming: this queue's per-item state is DERIVED from brief headers, so a restamp that re-reads only the queue re-verifies nothing. A restamp must re-read the briefs.

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

> ✅ **AUTHORIZED 2026-09-15** — the named set below. Authorization covers these touches only.
>
> ⚠️ **THE SECOND HALF OF THIS AUTHORIZATION WAS ASKED FOR ON A WRONG FRAMING AND IS WITHDRAWN
> (2026-09-17).** It read *"plus a new rail-keyed sidecar rule in `capture-host/writers.py` (floor 5)
> so its sidecars record BLANKING and not only stalls"*. The measurement behind it was sound — the live
> sidecar writes ~3 rows/night at floor 200 while ~56 rail-pinned runs of ≥5 exist — but the conclusion
> was not: `PPG-ABSENCE-AS-VALUE` §3 assigns the `pinned` rule to the **end-of-night back-check**,
> *"which has the whole recording, no deadline and no P0 exposure"*, and **it is already built there**
> (`nightqc.py` `rail_value`/`clip_regions`/`class_b_runs` at `_CLIP_MIN_RUN = 5`, wired, and publishing
> `class_b` into `QC-SUMMARY.json` — it caught a 141-sample ECG clip on the 2026-09-16 night).
>
> The two layers are complementary, not redundant: `T_STUCK = 200` is CORRECT for the live question
> *"is this stream stuck right now"* under a constraint that forbids windows on the notification path.
> **Nothing was built against the withdrawn half, so the cost was the authorization itself.** Residue
> `2026-09-17-sidecar-floor-row-was-mis-framed`.

One authorization over a **named set** of box touches. Deploys to `vigil` are owner-authorized only and
no peer relay changes that boundary, so these cannot be self-served however small each one is.

`CAPTURE-HOST-FOLLOWUPS-II` (`deploy/enable-clock-control.sh`) · `DEVICE-RATE-TRUTH` ·
`RADIO-FAILOVER-DISTRESS-SIGNAL` (the config key) · `OXYII-ACQUISITION-CHARTER`

### D3 · Metric-identity / evidence-tier rulings — ~~**4**~~ **1 parked + 1 non-urgent** (re-verified 2026-09-17)

| brief | re-verified 2026-09-17 |
|---|---|
| `R5-HR-TRIPLET-FOLLOWUPS` | 🔴 **GENUINELY PARKED — this is the whole of D3.** §3's `median`→`mean` moves a **published field** and needs a ruling on `hrStatMixed` semantics. ⚠️ Its header flags the read as *per Heron's, not independently re-verified* — so the ruling should be asked with that caveat, not presented as settled analysis. |
| `PPGDEX-ALGORITHM-DEEP-DIVE` | ✅ **ANSWERED 2026-09-06** — *"YES, PpgDex's exported values MAY move, and all eight open punch-list items are approved to land in the sequenced order."* The eight items were one question and it was put and answered; the brief is now an engineering programme (every PPG fixture moves, `regen-ppgdex-goldens.mjs` + a `verify-fixtures` lap per landing). **Not a decision. Do not re-ask.** |
| `DEEP-AUDIT-V-FOLLOWUPS` | 🟡 **OPEN but NOT URGENT, by its own measurement.** §1's three evidence-tiering POLICY calls remain, but the debt they governed is gone: `no-fabricated-tier` runs at `KNOWN_UNREGISTERED = 0` (tests/dex-tests.js), the 94-label backlog having been discharged 2026-08-16 — 24 captions re-scoped to per-series, 5 denied as non-measurements, **65 tiers owner-ratified**. F8's NSRR DUA is data access, not a tiering judgement, and belongs with D1-class asks. |
| `AUDIT-FOLLOWUPS` | ✅ **RATIFIED 2026-09-06** — all ten fusion `FINDING_EVIDENCE` grades accepted as they stand; header reads **`Owner: none`**. What remains there is data/tooling-gated or cosmetic-by-design, not an owner call. **Do not re-ask.** |

**So the ask to put to the owner is ONE question, not four**, and bundling it with three resolved briefs is what makes a queue read as expensive when it is cheap.

### D4 · Purchases — **3** (a "no" closes them as negatives, which is why they are cheap)

> ⛔ **ALL THREE DECLINED 2026-09-15** — closed as negatives, not deferred. ⚠️ Consequence to carry
> forward: every O2Ring finding rests on ONE unit, so device-specific and model-specific causes cannot be
> separated. State that limit; do not re-propose the purchase.

`O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` (a second O2Ring) · `R5-HR-TRIPLET-REFERENCE` (the owner has
confirmed no ResMed oximeter module exists — a purchase, not a cable) · `CROSS-DOMAIN-METHODS-FOLLOWUPS`

### D5 · Programme greenlights — **3**

> ✅ **ALL THREE RATIFIED 2026-09-15.** Ratifying `SPORT-CAPTURE-ANDROID` implies deciding who acquires
> an Android toolchain — no fleet session owns one.
>
> ⚠️ **AND THE RATIFICATION DID NOT REACH THE BRIEFS — stamped into `MEASUREMENT-PROVENANCE-ROADMAP` on 2026-09-17 (Kestrel), two days late.** That file carried ZERO mentions of D5 while its own header read *"the owner has not scheduled it"*, so a greenlit programme read as owner-blocked to every session, including during an architecture review that was looking for exactly this work. **This is the THIRD instance in this file** — D6 (twelve days), D3 (nine days), D5 (two days) — and the three together are the evidence for a mechanism: a decision this queue marks RULED must be back-referenced by every brief it names, which is the same bidirectional resolution `docs-ledger` check 8 already enforces for residue keys. Ratifying a programme is not delivering the ruling; the brief is where the reader is.

`QWEN-ENGINEERING-PROGRAM` (awaiting ratification; only the P0 idle-lane DSP review runs without it) ·
`SPORT-CAPTURE-ANDROID` (no fleet session owns an Android toolchain) · `MEASUREMENT-PROVENANCE-ROADMAP`
(none of its six done-when items can start before the call)

### D6 · The box privilege model — A/B/C

> ✅ **DECIDED 2026-09-07 — option (C)**, do not automate root; the *make the drift loud* half already
> shipped is the delivery. Recorded here 2026-09-15: this queue listed it as open for twelve days after the
> ruling, which is the whole failure mode a decision queue exists to prevent.

`VIGIL-AUTO-UPDATE-FOLLOWUPS` — nothing else in that brief moves until the pick is recorded, and
`VIGIL-OFFLOAD-AND-RETENTION` sits downstream of it.

### D7 · The trio-hat statistical judgement — **2, and they are one call**

> 📊 **MEASURED 2026-09-16 (Kestrel) — still OPEN, but the call is now a different one than it looked.**
> The fused-vs-unweighted choice is not a tuning preference: on the same corpus, same epochs, same
> granularity, **fused produces 12/64 negative-variance nights and unweighted 0/64**. Weighting is the
> only factor measured that moves it.
>
> ⚠️ **Two intuitive explanations were TESTED AND REFUTED** — clock alignment (excluded nights median
> 206.2 ms vs estimated 213.1 ms, indistinguishable) and epoch artifact (the night with the LEAST
> inter-node disagreement in the corpus is excluded, while nights at 54–61 % disagreement estimate
> fine). So a degenerate night is **not a bad night**, and "σ unavailable" says nothing about the
> recording — which is the part that should inform the ruling.
>
> ⚠️ **WHY** the fused weighting conditions worse was not derived, only the association measured.
> Residue `2026-09-16-tch-degeneracy-is-estimator-not-data`.
>
> 🔬 **DERIVED 2026-09-18 (Kestrel) — THE MECHANISM IS A MEASURE MISMATCH, AND IT IS STRUCTURAL.**
> The fused variant feeds three variances computed under THREE DIFFERENT PROBABILITY MEASURES into an
> identity that requires ONE. `analysis-stats.js tchSigmasFused` builds a separate weight vector per
> pair — `wHV = t·h·v`, `wHO = t·h·o`, `wVO = t·v·o` — and hands each to `_wvar`, which is a weighted
> variance (`mu = Σwd/Σw`, then `s/Σw`), i.e. a variance under ITS OWN measure. Those three go straight
> into `threeCorneredHat(vAB, vAC, vBC) = ½(vAB + vAC − vBC)`, whose derivation is
> `Var(x_i − x_j) = σ²_i + σ²_j` — an identity that holds for variances over ONE COMMON measure. Under
> three measures its premise is simply absent, so `a` can go negative **from the weighting alone, with
> nothing wrong in the data**.
>
> With all `c = 1` the three weights collapse to the same vector `t`, the premise is restored, and
> negativity-from-weighting cannot arise. **That is why unweighted scores 0 — structurally, not by
> luck** — which is the part an association could never tell you, and which makes 0/64 (now 0/68) the
> EXPECTED value rather than a fortunate one.
>
> It also accounts for both refuted candidates without needing them: neither clock alignment nor an
> epoch artifact touches a measure mismatch, so neither could have predicted the degeneracy. And it
> explains the finding that a degenerate night is NOT a bad night — degeneracy tracks how far the
> per-corner confidences DIVERGE, a property of the estimator's inputs rather than of the recording.
>
> ⚠️ **FALSIFIABLE AND NOT YET TESTED:** degeneracy should track the DISPERSION of `(cH, cV, cO)`
> within a night, and should NOT track any data-quality measure. If a corpus run finds degenerate
> nights whose per-corner confidences agree closely, this derivation is wrong.
> `tools/tch-degeneracy-stats.mjs` is where to test it.
>
> ⚠️ **A HYPOTHESIS I HELD AND THE CODE REFUTED**, recorded so nobody re-derives it: I first supposed a
> feedback loop — weights from `inverseVarianceWeights(sigma2)` re-entering the solve. They do not.
> That call sits AFTER the solve and its result is only returned, for the reconciled value. The
> neighbouring comment is still worth reading: it records that sampling noise at short records
> (~48–96 epochs) can drive one σ²→0, and floors it for the FUSION weights while the hat's own solve
> stays unfloored. The 2026-09-17 night sits in exactly that range — n=74, σ[OxyDex] 0.07 against a
> corpus median of 1.01 — so short-record noise is plausibly a SECOND, independent route to the
> boundary, distinct from the measure mismatch and NOT established here.
>
> 🟢 **RULED 2026-09-17 — DERIVE THE MECHANISM BEFORE RULING.** The owner declined to pick an
> estimator on the association alone. So D7 is no longer a decision awaiting an answer, it is an
> ANALYSIS UNIT awaiting an owner: derive why the fused weighting conditions worse, then the choice
> follows from the derivation instead of from a count. The reasoning to carry: adopting an estimator
> because it fails less often, without knowing why the other fails, is the kind of choice that ages
> badly in a paper — and both refuted explanations (clock alignment, epoch artifact) were exactly the
> intuitive ones, so the remaining mechanism is not going to be guessed. The 12/64-vs-0/64 measurement
> stands and does not need repeating.

`TCH-FUSED-ROBUST-HAT` · `TRIO-POWER-N15-FINDINGS` — the new-generation fused triple
(σ 2.87/1.18/0.68, ρ\* 0.576) is with the owner as a planted-sigma check.

### D8 · Scope/gate calls

> ✅ **YES 2026-09-15** — build the two-channel O2Ring dual-wavelength ingest. The stream is already being
> captured (79 `PPG2WRUNS.txt` sidecars on the box); only the ingest was missing.

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

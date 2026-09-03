<!--
  PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — ⚠ **mypy baseline: 180 at creation, 103 MEASURED 2026-09-02 — the ratchet plans from 103.** The done-when list still records 180; the live gate is the authority (`capture-host/check.sh:59` and `:91`, set 2026-08-29 by 55311121). Fix the number before reasoning from it. §P1 is closed. Open: **§P3 mypy blocking at 0** is a countdown from 103, nothing external blocks it; **§P3 format blocking** waits on a fleet notice that has never been sent; **§P2's qwen lane** ran to queue exhaustion at n=12 against a spec of 30, so the acceptance band was applied on 12 and the sample-size clause cannot be ticked as written — decide whether 12 is the sample or the lane reopens. Note `ruff format` is NOT gated in CI anywhere; it is local and advisory only (`check.sh:107`). **Owner:** Heron · **Next step:** correct the 180→103 drift in the done-when, then rule on the n=12 sample) · **Created:** 2026-08-27

> **TRIAGED 2026-09-01 — §P1 and §P2 are discharged; §P3 is a RATCHET waiting on a number, not a task.** §P1's advisory gates shipped with mypy pinned. §P2's qwen fix-lane ran to queue exhaustion (n = 12, 12/12 triaged, 7 accepted → landed in #1949) and the **adversary lane was RETIRED** at 20.7 % confirmed against a 30 % band (`audits/DSP-ADVERSARY-FINDINGS-2026-08-29.md`). ⚠️ The first §P2 box is NOT satisfied and should not be ticked: the band was applied on a sample of **12**, not the **30** it names — the rate cleared, the sample size did not. §P3 flips mypy to blocking at **0**; the recorded floor is now **103** (189 → 180 in #1949, then further by the session lane), so it is a countdown, not an action. §P4 is explicitly not planned.

# Python types + format — mypy and ruff-format for capture-host, measured first

## 0 · The decision and its numbers (sized before opining, 2026-08-27 22:15)

- **mypy**: `--ignore-missing-imports --explicit-package-bases` over 278 source files →
  **189 errors in 41 files**, measured **in the canonical root checkout** (`/home/michal/Tepna`).
  ⚠️ **THE TREE IS PART OF THE NUMBER.** A whole-tree count is a property of the checkout it ran in,
  and checkouts here differ by untracked strays. Measured 2026-08-28: a worktree off `origin/main`
  reports **188** for the same command — the missing line is `probe_rt_ppg_args.py:101`, an
  **untracked** file that exists only in root. Two trees, two populations. A baseline quoted without
  its tree is not reproducible, and reading the low number as a burn-down (as this brief's own author
  briefly did) moves a pre-stated threshold on an artifact. Top classes: Argument-type 68 · incompatible assignment 27 ·
  missing annotation 12 · unsupported operands 11. The codebase is already densely annotated
  (typed dataclasses, `X | None` unions, keyword-only signatures), which is why the wave is this
  small — and why the argument/assignment classes overlap the "can it silently mislead" defect
  class the mutation program hunts: some of the 189 are likely real findings, not pedantry.
- **format**: `ruff format --check` → **263 of 279 files would reformat**. The style is black's
  (ruff-format is black-compatible); the TOOL is ruff because it is already the lane's linter —
  adding literal black would create a second formatter authority to keep aligned forever.
- **🔴 The big-bang cost that forbids a one-shot reformat:** the mutation program's accumulated
  state — canaries `(line, op, before)`, journal keys `line\0op\0before\0after`, equivalence
  entries keyed on before/after text — is keyed on LINE TEXT AND NUMBERS. A 263-file wave
  orphans essentially all of it at once. The ledgers are designed to exclude orphans rather than
  lie, so nothing breaks — but the known-answer record's value is lost until re-derived. Hence:
  **incremental adoption** — format enforced on CHANGED files only, so mutation state stales
  exactly where it would have staled anyway as files change.

## 1 · Phases

- **§P1 — advisory wiring (DONE in this PR).** `check.sh` gains an ADVISORY section that runs
  and reports but cannot fail the run: `mypy` (full-tree error count against the recorded 189
  baseline — the number must only go DOWN) and `ruff format --check` on files changed vs
  `origin/main` (honest "0 changed files in scope" line when none). Advisory here is not the
  ignorable kind: both print their counts in the summary block, and the flip conditions are
  pre-stated below, not negotiable per-PR. `mypy` is pinned in `requirements-dev.txt` (new).
- **CI carries the ratchet (advisory), added 2026-08-28.** `.github/workflows/capture-host-ci.yml`
  runs the same command and **fails only if the count EXCEEDS the baseline** — the number may only go
  down. It reads the baseline **from `check.sh`** rather than keeping a second copy (one number, one
  home), **refuses** rather than assuming a value if it cannot parse one, and aggregates from mypy's
  own `Found N errors` line rather than a tail. **CI's fresh checkout is the CANONICAL population**
  for §P3's flip count — no untracked strays — and the job says so in its own output; a developer's
  root checkout is the convenience measurement. Not a required context until §P3 flips it.

- **§P2 — the burn-down, split by qwen's measured profile (owner-asked, owner-approved):**
  - **qwen lane (~the mechanical share):** per-error patch proposals for annotation gaps,
    Optional handling, container types. Verifier = mypy delta + full `check.sh` (the 100 % floor
    and the mutation gate catch behavior changes). Rails: no `Any`, no bare `type: ignore` —
    a proposal using either is auto-rejected (the lazy path makes the count drop while adding
    nothing); every proposal human-read before landing, per §0 of the qwen program. **The lane's
    precision metric is its fix-acceptance rate**, tracked in the findings ledger under lens
    `mypy-fix`, same pre-stated bands as every lens: <30 % accepted after 30 triaged ⇒ retire
    the lane; it is the program's first code-fix experiment and earns or loses that scope here.
  - **session lane (the judgment share):** the 68 Argument-type + 27 assignment errors triaged
    eyes-first (Vigil box's lane) — each is either an annotation fix or a REAL logic finding,
    and that call is exactly what the model measurably cannot make.
- **§P2a — the qwen lane's MEASURED behaviour (first 9 triaged, 2026-08-28).** Recorded here because
  it is the standing argument for eyes-first, and because two of its facts change what the lane is.

  🔴 **The band as written is arithmetically unreachable.** `<30 % accepted after 30 triaged` needs 30;
  this lane's classes hold **12 errors of the 189** — the rest are the session lane's by design. Nine
  are answered, three remain. Three readings (the 30 was set before anyone counted · the sample is
  meant to accumulate across time and wants a horizon rather than a count · the split is too narrow,
  which trades against its whole purpose) — **routed to the owner**, undecided here on purpose: the
  current rate sits near the bar, so whoever picks the denominator picks the verdict.

  ⚠️ **The characteristic failure is HINT PATTERN-COMPLETION.** mypy writes
  `Need type annotation for "out" (hint: "out: list[<type>] = ...")`, and the model fills the
  placeholder with a plausible scalar **without reading what is appended**. Measured: `nightqc.py:472`
  proposed `list[bool]` and `nightqc.py:1111` proposed `list[str]`, where both functions do
  `out.append({…})` — dicts. **Both are annotations a hurried human would wave through**, which is
  precisely why every proposal is human-read.

  **Known limitation, deliberately not fixed:** `object` **evades the `Any` rail**
  (`adapter_ab.py:58` → `dict[str, object]`). It is not `Any` and carries nearly as little — but it is
  sometimes the *honest* type for genuinely heterogeneous data, so widening the rail would
  auto-reject honest annotations. Eyes-first covers the lazy cases; the rail stays as it is.

  **Rail added:** a proposal must **parse as Python**. No judgement is involved, so it belongs in the
  verifier — and it catches a class the other rails structurally cannot see, a reply answering in
  **prose**, which contains neither `Any` nor a bare ignore.

- **§P2c — SAMPLE CLAUSE AMENDED, AND THE FIRST VERDICT (band author's decision, 2026-08-28).**

  > **Sample clause:** the lane's **full mechanical queue at evaluation time (minimum 10)**,
  > re-evaluated **at each queue exhaustion** as `capture-host` evolves.
  > **The 30 % rate threshold is UNCHANGED.**

  **FIRST EVALUATION: 12/12 triaged · 7 accepted / 2 rail / 3 eyes · 58 % (42 % excluding the two
  `object`-caveat accepts) · THE LANE SURVIVES** and continues under eyes-first, with **hint
  pattern-completion** as its named failure mode.

  **Reading (c) — widen the class split — is REJECTED explicitly.** The split's purpose stands: the
  excluded Argument-type and assignment classes are exactly the fix-or-real-bug judgements the model
  measurably cannot make, and taking them to reach a sample size would trade the lane's correctness
  for its statistics.

  ⚠️ **The amendment's provenance, recorded because the sequence is the discipline working and not a
  detail to smooth over.** The original `30 triaged` was the band author's **arithmetic error** — §0
  already stated the mechanical classes held ~12, so 30 was never reachable. When that surfaced, the
  measured rate was mid-queue and *straddling the 30 % bar*, and the author **declined to pick the
  denominator**: choosing a sample clause while the rate sits on the threshold decides the verdict,
  which is bar-moving with extra steps. The decision was taken only once the completed table made it
  **verdict-invariant** — 58 % and 42 % both clear 30 % under every reasonable clause, so the choice
  stopped deciding anything and became housekeeping.

  **The owner retains a veto** on both the clause and the verdict.

- **§P1a — THE RATCHET'S FIRST LIVE CATCH (2026-08-29), fixed rather than re-baselined.** The CI job
  began reporting `RATCHET BROKEN: 123 > 122` on every open PR: one error entered `main` through the
  lap gap — a PR measuring clean against its own merge-ref while the error materialised on `main` only
  in combination. **This was the pre-existing `N > BASE` check**, not §P2c's equality/direction rules,
  which are not on `main` yet; the original ratchet caught a real regression on its own, which is the
  strongest argument available for tightening it rather than loosening it.

  **Named by measurement, not by reading the job log.** A sort-independent multiset comparison of
  `main`'s current error set against the 122-era set returned exactly ONE difference —
  `tools/mutate_diff.py`, `Incompatible types in assignment (str | None into str)`. The errors
  *visible* in the log pointed at a different file that contributed nothing to the delta. **A list of
  errors you can see is not a list of errors that changed**, and only the paired set difference answers
  the question being asked. Same instrument as §P2c's "zero newly introduced diagnostics", pointed at
  `main` instead of at a branch.

  **The defect was a name collision across two kinds** — `_why` bound in the module-exclusion loop as
  the reason a module left mutation scope (`str`), then re-assigned as the reason the whole run must
  refuse (`str | None`). mypy binds a name at its first assignment, so the second is a type error. Two
  meanings, two names.

  ⚠️ **Fixed, NEVER re-baselined.** Raising the floor to meet a new error is the one response that
  makes a ratchet decorative — and it is exactly what §P2c's rule refuses without declared provenance.
  The count only goes down. (`mypy` is not a required context, so the red blocked nobody; it is fixed
  anyway, because a gate that is permanently red stops being read.)

- **§P2b — THE FROZEN TRIAGE TABLE (queue exhausted 2026-08-28 02:32; n = 12, the whole population).**
  Every mechanical-class error the lane can see has now been asked once. This is the artifact the
  owner's band decision is made against.

  | # | site | proposal | verdict |
  |---|---|---|---|
  | 1 | `status_union.py:95` (devices) | — | **RAIL**: identical to the original |
  | 2 | `status_union.py:95` (streams) | — | **RAIL**: identical to the original |
  | 3 | `cpap_edf.py:129` | `per_sig: list[list[int]]` | ✅ accept — `unpack_from("<{cnt}h")` yields ints |
  | 4 | `nightqc.py:472` | `out: list[bool]` | ❌ **EYES**: the function does `out.append({…})` |
  | 5 | `nightqc.py:1111` | `out: list[str]` | ❌ **EYES**: same — appends dicts |
  | 6 | `nightqc.py:1665` | `missing: list[str]` | ✅ accept — appends an f-string (:1695) |
  | 7 | `nightqc.py:1667` | `optional_absent: list[str]` | ✅ accept — same site |
  | 8 | `adapter_ab.py:58` | `out: dict[str, object]` | ✅ accept **with the `object` note** |
  | 9 | `probe_verity_offline.py:79` | `asyncio.Queue[bytes]()` | ✅ accept — restates one line more than needed |
  | 10 | `probe_verity_survey.py:430` | `best: list[tuple[int, int]]` | ❌ **EYES**: :444 assigns a list of **dicts** |
  | 11 | `capture.py:4055` | `dev: dict[str, object]` | ✅ accept **with the `object` note** |
  | 12 | `tests/test_cpap_stream.py:903` | `instances: list[_FakeBleak]` | ✅ accept — appends `self` |

  **Three-way split over n = 12:** accepted **7** · rejected by RAIL **2** · rejected by EYES **3** ·
  unverified **0**.

  **Acceptance rate 7/12 = 58 %.** Counting only the five accepts that carry no `object` caveat gives
  **5/12 = 42 %**. ⚠️ **Both readings clear the 30 % bar — but on a sample of 12, not the 30 the band
  names.** The rate is not near the bar; the SAMPLE SIZE is the whole question, which is why it goes to
  the owner rather than being resolved here.

  **The wrong-annotation mechanism, three of three times: HINT PATTERN-COMPLETION.** Rows 4, 5 and 10
  each fill mypy's `list[<type>]` placeholder with a plausible element type **never checked against
  what the code puts in the list**. Row 10 is the starkest — the model proposed `tuple[int, int]` for a
  variable the very next lines assign a list of dicts to. All three are annotations a hurried human
  would wave through.

  **The rail's own contribution is visible and small:** 2 of 12 caught before a human looked, both the
  same failure — the model echoing the original line unchanged when it could not infer a type. That is
  the vacuity guard, and without it those two score as accepts and the rate reads 9/12.

  ⚠️ **A correction to this brief's own earlier note:** rows 6 and 7 were reported UNVERIFIED because
  `grep 'missing\.append'` found nothing. The append is real and at `:1695` —
  `(optional_absent if opt else missing).append(...)`. **A `grep X.append` misses
  `(A if cond else X).append`**, and reading that absence as "no appends" would have left two correct
  proposals permanently unscored.

- **§P2c — THE SEVEN ARE LANDED (2026-08-29). 189 → 180, zero new diagnostics.** The lane had run
  `generate → rail → triage` and stopped there: seven ACCEPTED proposals sat in a journal while the
  count sat at 189. A mechanism that produces a correct result and never reaches the thing it was
  built to move is this repo's standing failure class, one layer up from a check that examines
  nothing — so the missing arrow is now closed and the loop reads `generate → rail → triage → LAND`.

  **Two of the seven needed a correction, which is the finding, not an aside.** A triage table is a
  verdict on the ANNOTATION; it is not a patch, and the gap between the two is where both corrections
  live.

  - **Row 12 does not RUN as accepted.** `instances: list[_FakeBleak] = []` sits in `_FakeBleak`'s own
    class body, where the name does not exist yet, and the file carries no
    `from __future__ import annotations` — so the accepted text raises `NameError` at import. Landed
    as a string annotation. The triage asked "is `list[_FakeBleak]` the right type?" (yes) and could
    not have asked "does this line execute?", because that is a different question about a different
    property. **A proposal that type-checks is not a proposal that runs.**
  - **Rows 8/11's `object` note had a PRICE, and it is paid here rather than carried.**
    `out: dict[str, object]` is the honest type, and it makes `out["devices"][name] = …` a *new*
    error — the count would have MOVED, not dropped, which is the shape of a green that reports on
    something it did not examine. The rows are now built in their own `dict[str, dict]` and placed
    into `out` once: no cast, no `Any`, no suppression. Row 11 needed nothing — `dict.get` on an
    `object`-valued dict is fine — so the caveat cost one site, not two.

  **The annotation earned its keep immediately: one latent defect, invisible until the type was
  tight.** With the rows typed, mypy could finally see that `name = d.get("name")` is `str | None`
  and was being used as a dict key — a nameless device keyed its row under a literal `null` in the
  emitted JSON. The address is the identity that always exists (`ble-identity-is-address-only`), so
  it is the fallback. This is what an annotation is FOR: not paperwork, but a question asked of code
  that had never been asked it.

  **Measured as a PAIRED difference inside one tree**, `--ignore-missing-imports
  --explicit-package-bases`: **189 → 180**, **154 → 145** (#1944), **140 → 131** (#1948), **134 → 125**
  (#1946) and **122 → 113** (#1950), each against its actual parent, every one confirming **zero** newly
  introduced diagnostics on a sort-independent multiset comparison of the two runs. The nine that go
  away are **seven annotations plus two pre-existing `adapter_ab.py` diagnostics** the restructure
  retired — the rows had been reached through an untyped value. Nine went away; it is not eight going away and one moving somewhere
  quieter. `check.sh`'s baseline records **145** — the single home the CI ratchet greps — because
  that is what the merged tree reports.

  ⚠️ **Arithmetic would have produced 145 too (154 − 9), and that changes nothing.** The two lanes
  happened to be disjoint. A number right by luck and a number right by measurement are
  indistinguishable on the page — which is exactly why the rule below is *reproduce it* rather than
  *get it right*, and why this coincidence is recorded rather than quietly enjoyed. The next pair of
  lanes will overlap somewhere, and the shortcut will be wrong with no change in how it looks.

  **The ratchet had a hole, and it is closed in the same PR.** The CI job fails only when the
  measured count EXCEEDS the baseline — so a PR that RAISES the baseline passes it every time, by
  construction. With two lanes cutting this count in parallel on 2026-08-29 (189 → 154 and
  189 → 180, both editing the one line that holds it), whichever landed second would have silently
  restored the ground the first one gained, with **nothing red anywhere**. **The rule the ratchet now
  enforces is that touching the threshold obligates reproducing it**: when a PR changes the recorded
  baseline, the written number must EQUAL the count that CI run just measured, not merely bound it.
  Direction alone catches the raise; equality also catches an **unearned lowering** — a number from
  arithmetic or a stale tree — which no `<=` test can see, because a too-low baseline passes a `<=`
  check *by being too low*. Both are kept: equality alone would wave through "I introduced 20 errors
  and wrote the new total", so a raise still needs **declared provenance**
  (`baseline-raised:<reason>`), never a shape rule. Unreadable comparison or unfinished mypy ⇒
  REFUSE. Ten controls assert the step's own exit code, the live 183-onto-154 case among them.

  ⚠️ **And the first version of that control harness was itself the bug it was testing for.** It
  read `$?` through a `tr` in its printf, so all ten cases reported `exit 0` — the verdict STRINGS
  were right and the exit codes, the only thing CI acts on, had never been checked. §4b, inside the
  test for a §4b-shaped defect, written by someone who had just spent a day on that failure class.
  **Assert the exit code of the thing under test, not of the pipeline you formatted it with.**

  ⚠️ **CONTENTION IS ONLY THE VISIBLE CLASS — there are two, and the second has no editor.**
  (1) two lanes each move the line and the second overwrites the first; (2) a PR records a baseline
  that was CORRECT when measured, and then unrelated work lands on `main` and moves the count
  underneath it. **(2) generalises (1)**, and is the honest statement: a recorded baseline goes stale
  whenever `main` moves while a PR is open — **which is every PR, always**. Any number written before
  the final rebase is a claim about a tree that no longer exists; contention is merely the case where
  the staleness has a culprit.

  This PR is its own demonstration. Its baseline was re-measured **five** times against five parents —
  189 → 180, 154 → 145 (#1944), 140 → 131 (#1948), 134 → 125 (#1946), 122 → 113 (#1950) — and **not
  once because anyone edited the line**. Its correctly-measured 145 went 14 stale within a single hour
  by sitting still, and three more numbers went the same way after it. `main`'s own recorded number
  drifted identically. Each landing ahead of it forced another rebase-and-re-measure — **that recurring
  cost IS the argument for the gate**, since the manual protocol has to be re-run correctly every single
  time and silently produces a wrong number the one time it is not.

  ⚠️ **It also produced a delivery finding the brief should keep: under a fast batch lane, the manual
  protocol does not converge.** Four batches landed under one branch in an evening, each obsoleting a
  correct measurement before CI could finish — so the PR carrying the fix was held open by the hazard it
  fixes. The resolution was to **drop the baseline edit entirely** rather than run the treadmill a fifth
  time: an untouched line cannot conflict, the plain ratchet applies (113 ≤ 122), and the mechanism
  lands. The floor stays loose by nine until the next PR touches the line, at which point the new rule
  forces a reproduction and it self-corrects. **When a contested resource blocks the fix for the
  contention, stop contending for it** — the fix is worth more than the increment. The check covers both classes
  because its trigger is the branch's value against **current** `main`, not against the merge-base, so
  a drifted number differs as loudly as an overwritten one. ⚠️ But the at-merge-time property is **not**
  free from any one run: CI on a `BEHIND` head measures the pre-merge tree, where a stale number can
  still look correct — it comes from Kodiak base-merging before merging, which triggers a further run
  on the merged ref. **A green on an earlier run is not proof the number is current.**

  **Measured instance, so it is not filed as a theory.** Three PRs were open simultaneously that
  day, all editing this one line, each measured independently against a 189-era `main`: #1944 wrote
  **154**, #1946 wrote **183**, this one wrote **180**. Landing #1944 then #1946 unchanged takes the
  recorded baseline **154 → 183** — a 29-point loosening with every check green, #1946's own mypy
  step printing `153 <= 183, ratchet ok`.

  **And nobody erred, which is the whole point.** Each PR measured its own tree and wrote down what
  it measured. That is the correct behaviour, and no amount of care would have caught this: the
  hazard needs two *correct* actors acting concurrently. **The general lesson, because it is not
  about mypy: a one-directional gate whose threshold is itself editable is only as monotonic as the
  discipline of whoever edits it — and parallel work is exactly the condition under which that
  discipline fails silently, since no lane can see another lane's number. If a threshold can be
  moved by the same PR the threshold judges, the threshold needs its own gate.** Asking people to
  remember is asking them to have information they do not have. Worth a look at the suite's other
  recorded floors on this reasoning — the coverage floor, the mutation canary counts — not on this
  incident.

  ⚠️ **And §P3's tree caveat gets a dated correction.** The 189-vs-188 spread it cites was that day's
  untracked stray, not a property of worktrees: re-measured 2026-08-29, a fresh worktree off
  `origin/main` reports **189**, exactly what the CI job reports on main. **Do not carry a correction
  factor between trees.** Measure the tree you are in — and when what you want is a delta, take a
  paired before/after inside ONE tree, which is immune to the population question entirely.

- **§P3 — the flips, pre-stated.** ⚠️ **Measure the flip count in a tree matching CI's population** —
  a fresh checkout with no untracked files — per §0's tree caveat. A count taken in a working tree
  fires the flip early or late off files CI will never see. mypy flips BLOCKING when the count reaches 0 (typed-ignores
  with reasons count as 0; bare ignores do not exist by rail). Changed-files format flips
  BLOCKING after one fleet-notice cycle (so no in-flight branch reds by surprise). Both flips
  land in `check.sh` AND the CI capture-host workflow in the same PR.
- **§P4 — explicitly NOT planned:** a big-bang reformat (see §0's cost); mypy `--strict`
  (re-size after the 189 reach 0); black-the-tool.

## 2 · Done when

- [x] §P1 advisory gates in `check.sh`, mypy pinned, baseline 189 recorded (2026-08-27);
      ratcheted to **180** when §P2c landed the first seven annotations (2026-08-29).
- [ ] §P2 qwen lane produces its first 30 triaged proposals; acceptance rate recorded; band applied.
- [ ] §P2 session lane triages the argument/assignment classes; real-bug findings ledgered.
- [ ] §P3 mypy blocking at 0; changed-files format blocking after fleet notice.
- [ ] Follow-up brief if the qwen fix lane earns expansion (its acceptance rate is the evidence).

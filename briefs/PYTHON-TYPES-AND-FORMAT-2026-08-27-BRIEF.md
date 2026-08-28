<!--
  PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-27 · **Owner decision** ("alright, mypy ruff then" — mypy adopted; black's STYLE via `ruff format`, not the black tool) · **Interlocks:** `QWEN-ENGINEERING-PROGRAM-2026-08-27-BRIEF.md` (the qwen fix lane runs under its §0 + precision bands), `MUTATION-ACCOUNTING-LOOP-2026-08-27-BRIEF.md` (format-wave cost to mutation state)

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

- **§P3 — the flips, pre-stated.** ⚠️ **Measure the flip count in a tree matching CI's population** —
  a fresh checkout with no untracked files — per §0's tree caveat. A count taken in a working tree
  fires the flip early or late off files CI will never see. mypy flips BLOCKING when the count reaches 0 (typed-ignores
  with reasons count as 0; bare ignores do not exist by rail). Changed-files format flips
  BLOCKING after one fleet-notice cycle (so no in-flight branch reds by surprise). Both flips
  land in `check.sh` AND the CI capture-host workflow in the same PR.
- **§P4 — explicitly NOT planned:** a big-bang reformat (see §0's cost); mypy `--strict`
  (re-size after the 189 reach 0); black-the-tool.

## 2 · Done when

- [x] §P1 advisory gates in `check.sh`, mypy pinned, baseline 189 recorded (2026-08-27).
- [ ] §P2 qwen lane produces its first 30 triaged proposals; acceptance rate recorded; band applied.
- [ ] §P2 session lane triages the argument/assignment classes; real-bug findings ledgered.
- [ ] §P3 mypy blocking at 0; changed-files format blocking after fleet notice.
- [ ] Follow-up brief if the qwen fix lane earns expansion (its acceptance rate is the evidence).

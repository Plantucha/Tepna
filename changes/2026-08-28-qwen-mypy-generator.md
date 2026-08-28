---
bump: minor
type: added
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---

The §P2 lane can now **produce** proposals. It could not before — and that is the sixth and last link
in one chain.

## 🔴 I built the consumer, the verifier, and the metric, and never the producer

`qwen-mypy-fix.mjs` shipped with the rails, the class split, the ledger shape and the acceptance band —
every part that **judges** a proposal — and **no part that makes one**. No ollama call, no fetch;
`buildPrompt` was exported and never invoked. Its CLI parsed the feed and printed a work queue, while
the header claimed *"proposal generation runs under the idle driver"* — false, since the driver calls
this same tool.

**It passed 31 assertions because all 31 test the judging half. A lane that cannot emit its own input
passes its own tests forever.**

## The chain, link by link

| # | defect | fixed in |
|---|---|---|
| 1 | no producer for `.mypy-latest.txt` | #1919 |
| 2 | producer writes where it runs; consumer read elsewhere | #1919 |
| 3 | consumer read a relative path under `cd "$WT"` | #1919 |
| 4 | the baseline had no tree, so 188-vs-189 read as a burn-down | #1919 |
| 5 | the **tool** resolved under `$WT`, which has no copy of it | **here** |
| 6 | the tool had **no generator at all** | **here** |

Link 5 is link 3 one file over: I pinned the *input* to root and left the *executable* resolving in
the worktree. Measured — `wt-resweep` carries no `qwen-mypy-fix.mjs`, so the invocation would have died
on "Cannot find module" rather than running.

## What the generator does, and refuses to do

Proposes and journals; **lands nothing**. `rejectProposal` screens every reply **before a human sees
it**, so the lazy path never reaches a reader's attention. The verifier stays mypy's delta plus
`capture-host/check.sh` — the model is in no verification path and cannot judge its own output. A
`REAL-BUG:` reply routes to the **session** lane rather than being patched here, which is the entire
reason §P2 splits the two.

**The journal key is the ERROR, not the proposal** — the band's denominator must not be inflatable by
cycling. Keyed on the error, a re-ask is a SKIP, so *30 triaged* means 30 distinct errors answered.
Model pinned `qwen3.8:27b`, `think:false` (a reasoning reply returns empty), **temperature 0** —
matching the bench that chose it.

Two things are deliberately **not** journalled: a missing source file and an ollama failure. Neither is
a rejected proposal; recording them would put unasked errors in the denominator.

## First real cycle — and the vacuity guard earned its place immediately

```
journal: 0 answered - queue: 12 - asking: 3
status_union.py:95   x  proposal is identical to the original (no added line)
status_union.py:95   x  proposal is identical to the original (no added line)
cpap_edf.py:129      .  proposal awaiting human triage
   → per_sig: list[list[int]] = [[] for _ in range(ns)]
band: 3/30 triaged — the band is not evaluable yet
```

The raw replies were printed before the parse was trusted, per *verify-the-plant* — and they showed the
model **echoing the original line unchanged** when it could not infer a type, twice. That is not a
parser bug; it is the real reply. **The vacuity guard — added because every other rail passes when
nothing was added — fired on 2 of the first 3 real replies.** It was not theoretical for one cycle.

The one accepted proposal is a specific, named type. It is a *proposal*: a human reads it, and nothing
lands without a green `check.sh`.

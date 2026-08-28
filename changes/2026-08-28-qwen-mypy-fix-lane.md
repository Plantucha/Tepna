---
bump: minor
type: added
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---

`tools/qwen-mypy-fix.mjs` — the mypy burn-down FIX lane (§P2, qwen half), wired as stage 5 of
`qwen-idle-driver.sh`.

§P1 made mypy advisory with a recorded 189-error baseline that *"must only go DOWN"*. This lane
proposes per-error patches for the mechanical classes and **lands nothing**: every proposal is
human-read, per §0 of the qwen program.

## 🔴 The rails live in the verifier, not in the prompt

"No `Any`, no bare `type: ignore`" told to a model is a request; the same rule as a rejecting
predicate is a gate. That distinction matters more here than anywhere else in the program, because
this lane's success metric is **a count going down**, and there is a lazy path that drives it to zero
while adding nothing:

```
def f(x):   →   def f(x: Any) -> Any:      # mypy: 0 errors, information: 0
y = g()     →   y = g()  # type: ignore    # mypy: 0 errors, information: 0
```

A lane whose metric can be satisfied by erasing the question must not be able to reach that path.
Discouraging it in a prompt would leave the precision number looking excellent while the lane produced
nothing.

## ⚠️ An empty proposal is a rejection, not a clean pass

Every rail is a *"does the added text contain X"* test, and all of them pass vacuously when nothing
was added — so the laziest possible output would otherwise score as the safest. Emptiness is checked
first and alone; four assertions pin it (empty, whitespace-only, identical-to-original, pure reindent).

## ⚠️ The `Any` rail counts OCCURRENCES, not lines

This came out of a planted near-miss whose premise turned out to *be* the design question. A proposal
editing a line that already contains `Any` (adding a return type, say) produces an "added line"
carrying an `Any` it did not introduce — and a line-level scan rejects that legitimate incremental
fix. The rail is *"this proposal introduces one"*, which is a **delta**, so it is measured as one.
Carrying an existing `Any` forward passes; adding a second does not; removing one passes.

**A planted near-miss that fails is the spec being wrong, not the test** — and it only works because
the planted case was one expected to PASS. An over-rejecting rail produces no complaint from anyone,
because the proposals it wrongly kills are never triaged by a human.

## Scope refused structurally

The 68 Argument-type and 27 assignment errors are the **session** lane's: each is either an annotation
fix or a real logic finding, and that call is what the model measurably cannot make. The tool cannot
be aimed at them.

## The band is a function, not a paragraph

Below 30 triaged it returns `decided:false` and **no rate at all** rather than a flattering one —
reporting a rate under the pre-stated sample is how a band gets quietly moved. `< 30 %` over 30
retires the lane; exactly 30 % does not.

**29 selftest assertions**, all green; discovered by `selftest-all`. Stage 5 refills the idle cycles
the draft pool leaves empty (measured dry 2026-08-27 22:51) with work that has a **mechanical**
verifier — the mypy delta plus `capture-host/check.sh`. An absent mypy log skips loudly rather than
reading as clean. The local model is never in the verification path.

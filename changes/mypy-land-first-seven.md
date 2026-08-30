---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---

**capture-host types — the first generated annotations LAND; the ratchet drops 189 → 180.**

The idle-time annotation lane had run its full evaluation and stopped one arrow short: proposals
were generated, railed, and triaged 12/12 by eye — and then nothing was committed. Seven were
ACCEPTED and sat in a journal, which is the same shelf-ware failure this repo keeps finding one
layer up: a mechanism that ran, produced a correct result, and never reached the thing it was
built to move. `generate → rail → triage` is now `generate → rail → triage → LAND`.

Landed, each at its evaluated site: `cpap_edf.py` `per_sig: list[list[int]]` · `nightqc.py`
`missing`/`optional_absent` as `list[str]` · `adapter_ab.py` `out: dict[str, object]` ·
`probe_verity_offline.py` `asyncio.Queue[bytes]()` · `capture.py` `dev: dict[str, object]` ·
`tests/test_cpap_stream.py` `instances`. The three the eyes REJECTED are not here — all three
annotated a `list[...]` of scalars at sites that append dicts, and landing them would have been
the lane certifying its own output.

**Two corrections the proposals needed, and both are the reason a triage table is not a patch.**

*The class-body annotation cannot be bare.* `instances: list[_FakeBleak] = []` is evaluated at
class-definition time, where `_FakeBleak` does not exist yet, and the file carries no
`from __future__ import annotations` — so the accepted text imports with a `NameError`. Landed as
a string annotation. A proposal that type-checks is not a proposal that runs.

*The `object` caveat had a price, so it was paid rather than accepted.* `out: dict[str, object]`
is the honest type for a genuinely heterogeneous dict, and it makes `out["devices"][name] = …` a
new error — trading one diagnostic for another and moving the count instead of dropping it. The
rows are now built in their own `dict[str, dict]` and placed into `out` once, which needs no cast,
no `Any`, and no suppression.

**One latent defect surfaced by the tighter type, and fixed here.** With `devices` typed, mypy
could finally see that `name = d.get("name")` is `str | None` and was being used as a dict key: a
nameless device keyed its row under a literal `null` in the emitted JSON. The address is the
identity that always exists, so it is the fallback; the sample lookup is unchanged because `keys`
still carries both. This is what an annotation is FOR — it is not paperwork, it is a question
being asked of code that had never been asked it.

**Measured, not asserted — and re-measured after every rebase, which is the rule this PR also
enforces.** Against its actual parent each time, in the canonical population
(`--ignore-missing-imports --explicit-package-bases`): **189 → 180**, then **154 → 145** onto
#1944, **140 → 131** onto #1948, **134 → 125** onto #1946, and **122 → 113** onto #1950 — five
independent measurements against five parents, the same seven annotations, **zero** newly
introduced diagnostics every time.

⚠️ **This PR deliberately does NOT move the recorded baseline, and that is a change of plan worth
stating plainly.** It originally wrote the number it measured, as the rule it introduces requires.
But the mypy session lane is landing batches faster than a PR can complete one CI lap: four
batches landed under this branch in one evening, each one making a correctly-measured number stale
and forcing another rebase, re-measure, gate and push. **The PR carrying the fix for that hazard
was being held open by the hazard.** So the baseline edit is dropped: `check.sh` here is
byte-identical to `main`'s, the branch cannot conflict on the contested line again, and the gate
lands.

The cost is exact and small: the floor stays at 122 while the tree measures 113, so it is loose by
nine until someone touches the line — at which point the new rule forces them to reproduce it, and
it self-corrects. The alternative was to keep re-running a manual protocol that the very PR in
question exists to abolish. **Landing the mechanism is worth more than recording nine points of
floor**, and the five-measurement series above is the evidence either way.

The nine that go away are **seven annotations at their own sites plus two pre-existing
`adapter_ab.py` diagnostics** that the `dict[str, dict]` restructure retired as a side effect — an
`Invalid index type` and an `Unsupported target for indexed assignment`, both of which existed only
because the rows were reached through an untyped value.

⚠️ **Those five pairs ARE the hazard, demonstrated on this PR.** Nothing was re-measured because
anyone edited anything: 180 went stale when #1944 landed, 145 when #1948 landed, 131 when #1946
landed, and 125 when #1950 landed — **this PR's own number went stale four times while sitting
still**, once by 14 within a single hour. Four correct measurements, all of them obsolete before
CI finished. So did `main`'s: its
recorded line reads 154 while `main` itself now measures 140. Contention is the visible class; the
general one is that **a baseline goes stale whenever `main` moves while a PR is open, which is
every PR, always** — any number written before the final rebase is a claim about a tree that no
longer exists.

⚠️ **And arithmetic would have coincided every time (154 − 9, 140 − 9, 134 − 9, 122 − 9), which
changes nothing.** A
number right by luck and one right by measurement are indistinguishable on the page — the entire
reason the rule below is *reproduce it* rather than *get it right*. Recorded as a coincidence so
the shortcut never inherits it as evidence.

**And the ratchet now ratchets.** The CI job failed only when the measured count EXCEEDED the
baseline — so a PR that RAISED the baseline passed it every time, by construction. That is not
hypothetical, and by the time this was written it was not even prospective — three PRs were open
at once, all editing this one line, each measured independently against a 189-era `main`:

| | recorded baseline |
|---|---|
| `origin/main` | 189 |
| #1944 — the `**kw` splat | **154** |
| #1946 — widened signatures | **183** |
| this PR, as first measured | **180** |

Land #1944, then #1946 unchanged, and the recorded baseline goes **154 → 183** — a 29-point
loosening, with every check green, because a raise passes the count step by construction. #1946's
own mypy step would have printed `153 <= 183, ratchet ok` and read as a healthy PR while handing
back the 35 that #1944 had just won.

**Nobody erred, and that is the whole point.** Each PR measured its own tree and wrote down what
it measured; that is the correct behaviour and there is no version of it that would have caught
this. The defect is structural: **the threshold was editable by the same PRs the threshold
judges**, and parallel work is precisely the condition under which that fails silently, because
no lane can see another lane's number. A hazard that only appears when two correct actors act
concurrently is a gate's job, not a discipline's — asking people to remember is asking them to
have information they do not have. The count is a property of
`main`, so the second lander must re-measure after rebasing — and "must remember to" is a
protocol, not a property. So the rule is: **touching the threshold obligates reproducing it.** When a PR
changes the recorded baseline, the written number must EQUAL the count that CI run just measured —
not merely bound it. Direction alone catches only the raise; **equality also catches an unearned
LOWERING**, a number from arithmetic or from a stale tree, which no `<=` test can see, because a
too-low baseline passes a `<=` check *by being too low*. When a PR leaves the line alone the plain
ratchet applies and lowering remains optional.

The direction check is **kept alongside** equality rather than replaced by it, because equality
alone would wave through "I introduced 20 type errors and wrote the new total" — that reproduces
too. A raise therefore still needs **declared provenance** (`baseline-raised:<reason>` on the
line), never a shape rule, the same discriminator `commit-shape.mjs` uses; the legitimate case is
an upstream release reporting more on unchanged code. An unreadable comparison, or a mypy run that
did not finish, REFUSES rather than passing.

One deliberate implementation choice: the trigger is the baseline **value changing**, not the diff
touching the line. It needs no diff parsing, works against any base, and a reworded comment
carrying the same number has nothing to reproduce.

**Ten controls, run before any of it was trusted**, each asserting the step's own exit code:
untouched-under passes · untouched-over reds · this PR's 189→180-measured-180 passes ·
arithmetic-too-low reds · **the live 183-onto-a-154-main case reds** · reproduced-raise-undeclared
reds · reproduced-raise-declared passes · unreadable main refuses · unfinished mypy refuses ·
reworded-same-value passes. The first version of that harness reported `exit 0` for all ten
because it read `$?` through a `tr` in the printf — §4b happening inside the test for a
§4b-shaped defect. The labels had been right and the exit codes, which are the only thing CI acts
on, had never been checked at all.

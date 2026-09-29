<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — last-verified 2026-09-29)

# WHOSE ZERO DECIDES? — counting helpers in capture-host, and whether they can tell "counted nothing" from "could not see it"

**Verdict: no live instance of the class remains outside the mutation gate's own helpers, which #3216
fixed. Four independent implementations of the right pattern already exist in the tree. No new gate is
proposed, and that is the result rather than a shortfall of it.**

## The question

`mmeta.generated_under_glob` returned `0` for every coroutine for five weeks (#3214) and for every
indented method for weeks before that — and `0` is also the correct answer for a function with no
mutable operator. One integer, three meanings, and the caller used it to choose between *"nothing to
mutate — pass"* and *"generated but never tested — refuse"*. #3216 made that helper carry the
population it examined and corroborate its count against mutmut's own registration table.

The residue row for it kept one thing open, and this audit answers it: **is that failure live anywhere
else?** Not "does the tree coerce absence to a number" — that is a different and larger question,
already surveyed (below) — but specifically: *a count whose zero decides something, produced by a scan
that might not be able to see its subject.*

## Method

Two AST passes over 136 modules (`capture-host/**/*.py`, excluding `tests/`, `.venv/`, `mutants/`),
starting from the **decision sites** rather than from the counters, because a counter nobody consults
decides nothing.

**Pass 1 — a count's zero in a conditional.** Build the set of counting helpers by fixpoint: a
function is a counter if any `return` is `len`/`sum`, or returns another counter, or is annotated
`-> int` and returns a non-constant. Then find `If`/`IfExp`/`While` tests of the form `x == 0`,
`!= 0`, `> 0`, `< 1`, or `not x`, where `x` resolves to a counter call or to a local bound from one.

**Pass 2 — a scan's result tested for emptiness.** The truer analogue: `findall`, `finditer`, `glob`,
`rglob`, `search`, `match`, `fullmatch`, `scandir` and comprehensions over them, tested by `not x` or
`len(x) == 0`.

### What these passes CANNOT see — stated, because a survey that hides its resolution is the bug it is looking for

- **Resolution is by NAME, across modules.** `read` is defined in `polar_pmd.py` and also bound to
  bytes elsewhere, so four of pass 1's thirteen hits are false positives, identified by reading each
  site rather than by trusting the attribution. A same-named helper in two modules is one symbol here.
- **Only literal `0`/`1` comparisons and `not`.** A threshold (`if n < MIN_ANCHORS`) is a different
  shape and is out.
- **Pass 2 sees syntactic scans only.** A scan behind a helper whose name says nothing about scanning
  (`load_x`, `collect_y`) is invisible to it, and pass 1 only reaches it if it returns an `int`.
- Both passes read `origin/main` at `63c1e92d`. Nothing here is a claim about future code.

## Results

Pass 1: **74** counting helpers, **13** decision sites. Pass 2: **27** emptiness tests on a scan.

| site | what its zero means | can it tell "none" from "could not see"? |
|---|---|---|
| `tools/mutate_diff.py:568` `_tested == 0` · `:1195` `_checked() == 0` | the gate's own counts | **YES, since #3216** — `generated_scan` carries `examined`/`corroborated`, `unmeasured_zero` refuses, `zero_population_verdict` downgrades a PASS over `checked: 0` |
| `tools/probe_equivalence.py:210,222` — `n` distinguishing inputs → a verdict | "no distinguishing input over THIS battery" | **YES, and independently** — CANARIES run first (*"the battery must SEE each of these, or it is too narrow to prove anything"*), a blind canary returns 2 and **no verdict is emitted**; the count is printed as `n/len(base)`, carrying its denominator. An empty battery is caught because every canary then reads blind. |
| `timeline.py:571,581` — `unmeasurable_files` | files with rows but no placeable duration | **YES** — its docstring states the rule (*"zero is a measurement and absence is not one (§∅)"*); `coverage_pct` becomes `null` with a named `coverage_reason` (`no-duration-basis`, `writer-offset-unrecoverable`) |
| `loss_audit.py:471` `_has_worn_evidence` | glob found no candidate file | **YES** — returns `None`, never `False`, and tracks `read_one` ("did ANY file actually get read down its named column?"); an empty file and a header missing the column each `continue` with a comment saying it "cannot vouch" |
| `loss_audit.py:853` `audit_night` | no primary file this night | **YES** — records `file: None` plus a named `reason`, not a zero |
| `tools/derive_edf_dict.py:83` | no EDF files under the card root | **YES** — `raise SystemExit(f"no EDF files under {card_root!r}")`; refuses rather than reporting an empty survey |
| `capture.py:334,347,374` `open_sample_writers() == 0` | no capture file is open | **N/A — not the class.** An in-memory registry incremented by `_writer_opened`; the count *is* the state, not an observation of it, so there is no "could not see" mode. (The adjacent comment shows the same worry already handled: both arguments are required so a writer cannot increment the count without joining the open set.) |
| `polar_pmd.py:574` `count == 0` | a protocol header field reads zero | **N/A** — the bits were read; zero is what the frame says, and the code stops decoding rather than measuring anything |
| 19 × `if not <RE>.match(x)` (storage_targets, clockcfg, cpap_*, daemon_control, jitterfloor, …) | the input does not match | **N/A** — validators. A non-match means invalid input and each one refuses or returns `None`; absence is the answer, not a measurement of it |
| `solid_night_inputs.py:607` `expected_devices` | an **optional** device's glob is empty → dropped from "expected" | **NO, and it is the only one.** See below. |

## The one candidate, recorded and NOT fixed

`expected_devices` drops an optional device when `glob(night_dir/f"{spec['prefix']}*")` is empty. If
the prefix in `MODELS` were stale, or `night_dir` wrong, a device that *was* recorded would silently
leave the expected set and nothing downstream would notice it should have been there — the same shape
as the mutation gate's benign arm.

It is not fixed here for two reasons, and both are honest rather than convenient. First, dropping an
optional device with no files is the **designed** behaviour, so the defect requires a *second* fault
(a wrong prefix or directory) to bite, and no such fault is known. Second, the fix that landed in
#3216 — corroborate the count against an independent observation of the same fact — has no analogue
here: there is no second record of "which devices recorded tonight" to check the glob against, so
applying the shape would mean *inventing* a source of truth, which is a design question and not a
survey's to answer. Recorded so the next reader starts from a measurement.

## Relationship to `ABSENCE-SURVEY-2026-09-22.json`

That survey (130 agents, 164 375 lines read, 923 raw → **290 confirmed**, 633 refuted) asked whether
absence is coerced to a number. It is the larger question and it **did** reach this file: 

> `capture-host/mmeta.py:112` — `except OSError: return 0` — *"whether mutmut generated any mutants
> under this glob — the mutants file is missing or unreadable, so nothing was counted"*, kind
> `default-reads-as-measured`, confirmed 2026-09-23.

Confirmed on the 23rd, still open on the 28th when `generated_under_glob`'s async blind spot was found
independently, and fixed on the 29th by #3216. Two things follow, and the second is the reason this
audit exists:

1. **A confirmed finding is not a fixed one.** Six days and two PRs passed between the survey naming
   that exact line and the decision site being made to stop trusting it. (`generated_count` still
   returns `0` on `OSError` — deliberately: it OBSERVES. The caller now reads `generated_scan`, whose
   `sourceBytes: 0` refuses. Observe and decide are different jobs and the zero is honest in the first.)
2. **That lens does not see this one.** Its 290 confirmed findings break down as `default-number` 119,
   `default-reads-as-measured` 106, `aggregate-over-absence` 39, `in-band-sentinel` 24,
   `discontinuity-annotated` 2 — and **zero** concern a scan that cannot see its subject. The async
   blind spot is not absence coerced to a number: it is a *scan returning a legitimate-looking count
   over a construct it cannot recognise*, and the value is correct arithmetic over the wrong
   population. The two lenses are complementary, and running one does not answer the other.

## Why no new gate is proposed

A standing check would have to distinguish "this helper's zero is load-bearing and uncorroborated"
from "this helper's zero is a validator's answer", and the survey above shows the population is
**one** candidate that the landed fix does not fit. A gate over a class with no live instance costs a
red on every new validator and buys nothing. The reproducible artefact is this document's method
section; the pattern to copy is `mmeta.generated_scan` + `mutation_diff.unmeasured_zero`, and the
three independent precedents above show the tree reaches for it without being told.

**Re-run when:** a new counting helper's zero reaches a verdict, or a second record of a scanned
population becomes available for a site that has none (the `expected_devices` case).

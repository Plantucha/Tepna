<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** REFERENCE (living — last-verified 2026-09-13) · **Created:** 2026-09-13

# The Tool Build Standard — what any long-running analysis tool in this repo must do

> **Scope.** Every tool under `tools/` that processes a corpus, sweeps a parameter space, runs a
> mutation program, or otherwise executes for longer than a person will watch it. It does not govern
> one-shot scripts, build steps, or gates, though nothing here harms them.
>
> **Search terms** (so this is findable before the next tool is written rather than after): long
> running tool, resumable, checkpoint, restart from last point, heartbeat, progress, observable,
> killable, stoppable, worker pool, parallel, GPU acceleration, CPU fallback, core count,
> hardware concurrency, early stopping, corpus processing, batch job, background job.

## 1 · Purpose

Tools here are repeatedly rebuilt with the same omissions. A tool ships, runs for six hours, dies at
hour five, and leaves nothing; or it prints no progress and cannot be distinguished from a hang; or
it is parallelised for the one caller its author had and silently degrades for the next. Each of
those has happened, and each was avoidable by a requirement that was already known.

The standard below is not aspirational. **Every clause is the negation of a defect measured in this
repository**, and the measurement is cited so a reader can weigh the rule rather than obey it.

## 2 · The standard

Requirements are numbered for citation in review. A tool need not implement what does not apply
(§2.11 governs that), but **an omission is declared, never silent**.

### 2.1 · Search before asserting a capability does not exist

Run `node tools/doc-search.mjs "<the capability, in the subject's vocabulary>"` and read the top hits
**before any claim that something must be built, sized, or re-derived**. Grep finds only your own
vocabulary; a semantic query finds the module someone else named differently.

⚠️ **Keyed to the CLAIM, not to "starting a new tool"** — an earlier draft said "search before
building", which under-fires on every other way the same failure occurs: extending a tool that
already does the thing, costing a unit as expensive because its machinery is assumed absent, or
answering "is this built?" from memory. The failure is *asserting absence without looking*, and the
trigger must name that.

*Verify:* the first line of the work report names the query and its top hits, or states "no prior
work". *Measured:* a `pooledSeconds` grep returned nothing while the pooled pairwise Bland–Altman and
generic three-cornered hat already sat in `sigma-no-reference-analysis.js`. Separately, a GPU tool
that had been running millions of synthetic windows for months was not surfaced because the query
used process-management vocabulary instead of the subject's.

### 2.2 · Resumable from the last completed unit

A run that is interrupted resumes from its last checkpoint, never from the beginning. The checkpoint
carries **results**, not merely a position — a checkpoint you can read a partial answer out of is
worth more than one you can only restart from. Write it atomically (temp file, then rename) so a
concurrent reader never sees a half-written file, and discard an unparseable one rather than
half-trusting it.

*Verify:* kill the process mid-run, restart with `--resume`, and assert the output contains each
unit exactly once. *Measured:* required by the ~6 h corpus runs; a resumed run must produce
**0 duplicates and 0 re-scored units**.

### 2.3 · Stoppable and killable

`SIGKILL` to the parent must terminate the entire job — every worker, thread and child — leaving the
checkpoint consistent and no orphan writing to it after death.

*Verify:* kill the parent; assert the process and all its workers are gone, and that the checkpoint
byte count is unchanged several seconds later. *Measured:* a `kill -9 -$PID` against a `setsid`
background job missed its target because `$!` was not the process-group leader, and the job ran on
invisibly — the checkpoint advanced after it was believed dead. **Identify the process you own by
reading `/proc/<pid>/cmdline`, never by a `pgrep -f` pattern**, which both self-matches and matches
other sessions.

⚠️ **AND READING `/proc/<pid>/cmdline` IS NOT ENOUGH ON ITS OWN — KEY ON `argv[0]`.** Amended
2026-09-15, after this very advice was followed and still produced a self-match. A substring test over
the WHOLE command line matches any shell whose own command line merely *contains* the tool name: the
scanner function, the `kill` loop, a `grep`. Measured that afternoon: a `/proc` scan reported two
survivors after a successful `SIGKILL`, and both were its own subshells — they had vanished a second
later, which is precisely what a false positive looks like and precisely what reads as *"the kill
leaked workers"*. The same session had already lost a shell **twice** to `pgrep -f` self-match
(exit 144) before switching to `/proc`, so all three forms of the trap fired in one day.

The discriminating test is the **executable, not the text**: accept a pid only when `argv[0]` is the
interpreter you launched (`*/node`) **and** `argv[1]` names your script. A shell that merely mentions
the script has `argv[0]` of `/bin/bash` and is excluded by construction — no bracket trick for the
next caller to remember.

```sh
for d in /proc/[0-9]*; do
  a0=$(tr '\0' '\n' < "$d/cmdline" 2>/dev/null | head -1)
  a1=$(tr '\0' '\n' < "$d/cmdline" 2>/dev/null | sed -n 2p)
  case "$a0" in */node|node) ;; *) continue;; esac
  case "$a1" in *your-tool.mjs) echo "${d#/proc/}";; esac
done
```

### 2.4 · Continuously observable

Progress must be legible *while the tool runs*: units completed, rate, ETA, and **the running answer
so far**. A run that prints nothing for hours makes "slow" and "hung" indistinguishable.

*Verify:* the heartbeat must display a real value on a partial run. **A placeholder is a failure, not
a pending state** — see §3.2, which is the most expensive instance of this in the repo's history.

### 2.5 · Heartbeat that survives redirection

Emit on a fixed interval, to a stream that works when redirected to a file. A progress indicator
visible only on an interactive terminal is absent exactly when it is needed.

### 2.6 · The parallelism must be measured, not assumed — GPU included

**Profile before choosing a compute strategy.** State where the time actually goes, then pick.
Neither "GPU will be faster" nor "GPU will not help" may be asserted without a measurement.

The discriminator is the *shape* of the work, and this repo contains both shapes:

| workload | profile | correct strategy |
|---|---|---|
| synthetic trio windows (`sensor-trio-gpu.js`) | millions of **independent** windows, pure arithmetic, nothing materialised, no I/O | **GPU** — measured 129 s against an extrapolated ~5.9 days on the CPU pool |
| SpO₂ corpus scoring | ~95 % of runtime in serial scalar passes over a **32 520-sample** array, one disk read each | CPU **across records** — dispatch would exceed the arithmetic |
| ECG staging (`ECGDSP.analyze`) | **67.5 %** of runtime in `lombScargle` — a dense `O(n_freq x n_points)` sum with no serial dependency | **GPU** — the textbook case |

⚠️ **Every percentage in that table is a SINGLE-RECORD profile, and must be quoted with that.** Row 3
is `--cpu-prof` over **one** 9.0 h recording (4.06 M samples, 12 107 ms total), 2026-09-13. It is
enough to identify a hot spot — a component at 67.5 % is not going to be at 5 % on the next file —
but it is n=1, it fixes no confidence interval, and the derived "~47 min → ~15 min" is an
extrapolation from it across 5136 records on 22 cores, not a timing anybody has run.

A bare percentage reads as a property of the system; it is a property of that sample. This repo has
already paid for that once, where a true median-merge-gap measurement became false guidance because
it travelled without its window — the same number over a different window was nearly double. **A
measurement is safe when its date, scope and n travel with it, and unsafe the moment it is quoted
bare**, because a reader will act on it as today's value.

*Measured:* per-record profiling is cheap and decisive, and it has overturned an assumption three
times here — twice in the direction of "no GPU" and once the other way.

⚠️ **The third row is the instructive one, because I got it wrong in both directions before
measuring.** ECG staging was first assumed to match row 2 (no GPU) on the grounds that it is
"the same kind of per-record work". It is not: it costs 12.1 s per record against row 2's 4.15 s and
is 99.9 % compute. It was then assumed the hot spot must be QRS detection, the obvious candidate.
A CPU profile says QRS detection is **9.3 %** and a Lomb-Scargle periodogram is **67.5 %** — the one
component in the pipeline that is embarrassingly parallel. By Amdahl that single kernel bounds the
achievable speedup at ~3.1x, taking a 5136-record corpus from ~47 min to ~15 min.

⚠️ **And note the attempt that produced nothing:** wrapping the exported `ECGDSP.bandpass` /
`detectPeaks` to time them registered **zero calls**, because `analyze` invokes module-local
functions rather than its own exported properties. That instrumentation examined nothing and would
have reported a confident 0 %. **Profile with a profiler; do not infer a split from wrappers you have
not proven fire** — the check that a plant was actually seen applies to instrumentation exactly as it
applies to tests.

⚠️ **Before accelerating, establish the component is needed at all** — a component that can be
skipped is infinitely faster than one that is optimised. Here it cannot: the stager's REM gate reads
`epoch.lfhf`, which only the periodogram produces, so the 67.5 % is load-bearing rather than waste.
That check costs one grep and can save the entire unit of work.

### 2.7 · Degrade by capability, and report the tier taken

Detect capability, fall back rather than fail, and **say which tier ran and why**. A tool that
silently drops to a slow path presents as a performance mystery.

Canonical form, from `sensor-trio-power-analysis.js`: GPU → worker pool → serial, with the fallback
reason surfaced to the caller.

### 2.8 · Size the pool to the machine, and justify the clamp

Read the core count and clamp it, leaving headroom so the machine stays usable. **The clamp is a
judgement about the host, not a constant to copy** — a browser tab sharing a machine with the user's
session and a CLI on a dedicated box warrant different clamps. Floor at 1 so a weak machine still
runs.

Do not copy a clamp out of this document: **read the current value from the tool nearest your case**
(`sensor-trio-power-analysis.js` for the browser, `tools/nsrr-score-pool.mjs` for a CLI) and state
why yours differs. A number transcribed into prose is a number that stops tracking its source — the
defect §2.10 exists to prevent, in miniature.

### 2.9 · Generic across callers, or explicitly single-purpose

A tool built around one caller's data shape will be handed a second caller. Parameterise the part
that varies — the scorer, the metric, the stopping rule — or document that it is single-purpose.

*Verify:* drive the tool with a second consumer before claiming it is general. *Measured:* see §3.2.

### 2.10 · Run the full gate as the delivery step — never a hand-picked subset

Writing the tool is not the end of the delivery. The repository carries several **generated** trees,
and a tool can stale any of them without the builders warning about each other.

🔴 **THE AUTHORITATIVE LIST IS `package.json`, NOT THE TABLE BELOW.** The table is a snapshot taken
2026-09-13 and is here to show the *shape* of the problem, not to be relied on. Transcribing a count
into prose is what put CLAUDE.md §🔏 one row behind reality and produced the incident this clause
documents; a standard that repeats the mistake it is warning about is worse than no standard.
**Read the checks out of `package.json` — `npm run check` runs all of them and is the only complete
statement of what they are:**

```sh
node -e "console.log(Object.entries(require('./package.json').scripts).filter(([k])=>/^(build:check|verify:)/.test(k)))"
```

*Snapshot, 2026-09-13 — verify against `package.json` before relying on it:*

| tree | regenerate with | checked by |
|---|---|---|
| the owned bundles | `tools/build.mjs` | `npm run build:check` |
| `docs/` served copies | `tools/build-docs.mjs` | `npm run verify:docs` |
| the analysis tools | `tools/build-analysis.mjs` | `npm run verify:analysis` |
| **`docs/TOOLS-INDEX.md`** | **`node tools/tools-index.mjs`** | **`npm run verify:tools-index`** |

**The rule is phrased against the CHECK, not against the cause, and that distinction is the whole
point.** An earlier draft of this clause said *"after adding a tool, run `node tools/tools-index.mjs`"*
— which is true and too narrow. `tools-index.mjs` derives each entry from the tool's HEADER COMMENT
(`purposeFromSource`), so **reflowing the purpose line of an existing tool stales the index with no
new file involved**; anyone reading a rule about *adding* a tool would correctly conclude it did not
apply to them and hit the identical red. A rule keyed to one cause under-fires on every other cause of
the same failure. Keyed to the check, it cannot.

*Measured 2026-09-13:* two pull requests each added one `tools/*.mjs` and regenerated none of this.
Both passed review and merged, and `origin/main` then failed `npm run check` at step 14/16 — so
**every branch cut from main afterwards inherited a failure it did not cause**, which is the
expensive part: the cost lands on whoever opens the next pull request, and is naturally
mis-attributed to them.

⚠️ **The instructive detail is that the author's list of generated trees was confidently complete and
had three entries.** The fourth was missed not through carelessness about a known step but because it
was absent from the mental inventory — and `build.mjs --check` says nothing about it. The list above
was then produced by ENUMERATING `package.json`, not by recalling it, because the defect being fixed
was precisely a remembered list. **Do not carry a remembered list; run `npm run check` in full and
read every step.** A subset that passed is not evidence about the steps it did not run.

### 2.11 · Declare what is not implemented

An inapplicable requirement is stated as inapplicable. Silence is indistinguishable from oversight,
and a reviewer cannot tell a considered omission from a forgotten one.

## 3 · Failure catalogue

Each entry is a real defect, retained because the failure mode is not obvious from the rule alone.

### 3.1 · A progress meter that measured nothing

A rate was computed as `fin - done.length`, where `done` was the array the workers pushed into — so
the two tracked each other exactly and the difference was always zero. The tool printed
`0.00 rec/s  eta ?` for an entire run. **A baseline must be captured by value before the run starts.**

### 3.2 · Observability that worked for exactly one caller

A worker pool's live statistic was hardwired to its first consumer's metric. Driven by a second
scorer it printed `median —  +/-—` for the whole run: the progress display reported nothing, and the
early-stopping rule could never fire because its input was permanently empty.

**This failed silently because an em-dash reads as "not yet" rather than "structurally
unavailable".** A tool must distinguish *no data yet* from *this quantity cannot be computed here*,
and refuse at startup where a requested feature is unsupported rather than run to completion
pretending to watch for it.

### 3.3 · A gate that passed on non-emptiness

A validation tool asserted that its output was non-empty and passed, while the quantity it scored was
structurally zero — an object was compared against a string, so one whole class could never match.
The end-to-end self-test was green throughout. Separately, a detector's output in **seconds** was
compared against a reference in **milliseconds**; the same non-emptiness assertion passed.

**Assert the value, the unit and the joint alignment — never that a result exists.**

### 3.4 · Killing by pattern

`pkill -f '<command>'` stalled an unrelated in-flight job, and the matching `pgrep -f` matched the
waiting shell itself. **Stop only PIDs you own and have verified via `/proc/<pid>/cmdline`.**

### 3.5 · A stopping rule that reported the floor as a criterion

An early-stopping monitor with a minimum-sample floor stopped at exactly that floor under a loose
target — the criterion was satisfied on the first sample it was permitted to evaluate. The answer was
within tolerance, but *"the interval closed"* and *"we had barely started"* are different claims and
were reported identically. **Where a guard can decide an outcome, the output must say that the guard
decided.**

## 4 · Pre-flight checklist

Before opening a pull request for a long-running tool:

- [ ] §2.1 semantic search run; query and top hits recorded
- [ ] §2.2 killed mid-run and resumed; 0 duplicates, 0 re-processed units
- [ ] §2.3 `SIGKILL` verified to take every worker; checkpoint stable afterwards
- [ ] §2.4 heartbeat shows a real running value on a partial run, not a placeholder
- [ ] §2.6 per-unit profile recorded; compute strategy follows from it in writing
- [ ] §2.7 tier and fallback reason printed
- [ ] §2.8 pool sized from the host; clamp justified; floors at 1
- [ ] §2.9 driven by a second consumer, or declared single-purpose
- [ ] §2.10 `npm run check` run IN FULL (not a hand-picked subset) and green, including
      `verify:tools-index` after adding any `tools/` file
- [ ] §2.11 every unimplemented requirement declared

## 5 · Relationship to existing convention

This brief governs the **construction** of tools. It does not modify `CLAUDE.md`, which remains
authoritative on every conflict, and it adds no gate. Two adjacent rules are assumed rather than
restated: §∅ (absence is `null`, never a number) applies to every value a tool emits, and §4b (never
read a verdict off a truncated result) applies to every summary it prints.

**No enforcement mechanism is proposed here, deliberately.** A checklist that fails a build on
judgement calls — "is this clamp justified?" — would convict working tools, and an invariant that
convicts correct code is the wrong invariant. This is a review reference; if a clause later proves
mechanically checkable, that is its own unit of work.

<!--
  MUTATION-PROGRAM-2026-08-09-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS · **Created:** 2026-08-09 · **Folds:** `MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md`, `CAPTURE-HOST-MUTATION-FLEET-2026-08-04-BRIEF.md`, `JS-DSP-MUTATION-FLEET-2026-08-08-BRIEF.md`, `PPGDEX-TESTABLE-SURFACE-2026-08-08-BRIEF.md` · **Affects:** `tools/mutate.mjs`, `tools/mutate-equivalence.json`, `capture-host/tools/mutate_diff.py`, `tests/dex-tests.js`

# The mutation program — one denominator, two fleets, and the property that predicts what a pass is worth

Four briefs were running the same programme from four directions and had begun to contradict each
other. This is the one brief; the four are folded into it and marked DONE.

> **Why not `Superseded-by:`.** That field is whole-brief and **strictly 1:1** — `docs-ledger` check 5
> resolves exactly one `.md` per header and asserts `sup[t] === n` in both directions, so a 4→1 fold
> cannot be expressed in it without three one-sided links reddening the gate. `Folds:` /
> `Folded-into:` are plain header prose the gate does not parse, which is the correct shape for a
> many-to-one merge. Same reasoning `APNEA-TYPING-FUSION` already recorded for a partial withdrawal.

| folded brief | what it contributed | what it got wrong |
|---|---|---|
| `MUTATION-EQUIVALENCE-2026-08-04` | the **denominator** — measured, then ratified by the owner 2026-08-08 | its own §6 count (14 parse survivors; there were 8) |
| `CAPTURE-HOST-MUTATION-FLEET-2026-08-04` | the **Python map** + concentration predicts cost | `~13/pass` flattening, self-corrected in §2 |
| `JS-DSP-MUTATION-FLEET-2026-08-08` | the **JS map** — 31,000 lines never measured before | ranks *files*; the actionable unit is a function |
| `PPGDEX-TESTABLE-SURFACE-2026-08-08` | the first deep dive, and two self-corrections in one brief | its headline ceiling (§5 below refutes it) |

---

## 1 · SETTLED — the denominator, and it is ratified

**The target is: 90 % of DISTINGUISHABLE mutants killed, and every non-distinguishable one
classified.** Owner call, 2026-08-08 (`MUTATION-EQUIVALENCE` §5). The raw `killed / tested` rate is
still printed beside it and is still what a reader sanity-checks against; it is no longer the bar.

This is not a lowered bar, because on the same day it stopped being a claim and became data. Both
gates now carry the mechanism, and both carry the three states that stop it becoming an allowlist:

| | JS — `tools/mutate.mjs` | Python — `capture-host/tools/mutate_diff.py` |
|---|---|---|
| classification file | `tools/mutate-equivalence.json` | `capture-host/tools/mutate-equivalence.json` |
| matched on | `(line, op, before)` | the **diff** (`- old \| + new`, whitespace-normalised) |
| why that key | the key `findCanary` already uses | mutmut's `__mutmut_N` **renumbers**; measured — the same mutation was `_12` on CI and `_6` locally |
| landed | #1060 (`MUTATION-EQUIVALENCE` §8) | #1102 (§9) |

**REFUTED** (an entry claims equivalence and the mutant was killed) · **ORPHANED** (matches no
generated mutant) · **UNCLASSIFIED** (a survivor nobody probed). All three are loud, and `real-gap`
entries stay **in** the distinguishable denominator — a classification file is not a place to launder
debt into a better number.

Measured ceilings, where a full classification exists:

| subject | raw | distinguishable | source |
|---|---|---|---|
| `clock.js` | 97/117 = **82.9 %** | **100 %** — all 19 classified | `MUTATION-EQUIVALENCE`, re-measured on `f5f6e4d8` |
| `clock.js` parse family | — | 8 survivors, **0 killable** | `CLOCK-PARSE-EQUIVALENCE-2026-08-09` (DONE) |
| `cpap_harvest` | — | ceiling 94.1 %, 73 unobservable | `--rank` / `ceiling()` |
| `storage_targets` | — | ceiling 91.4 %, 92 unobservable | same |
| `pull_session` | — | ceiling 89.1 %, 51 unobservable | same |

**90 % raw was never reachable for anything measured, and no number of waves changes that.**

## 2 · 🔴 THE MECHANISM IS FED BY ONE FILE OUT OF EVERY FILE THAT HAS BEEN PROBED

This is the finding that reorders the work, and it was found while writing this brief.

`tools/mutate-equivalence.json` today contains **`clock.js` and nothing else — three entries, all
`real-gap`, all already killed.** `capture-host/tools/mutate-equivalence.json` contains **one entry.**

Against that, the classifications that have actually been *measured with a battery* and written down
in prose:

| where measured | classifications | in the file? |
|---|---:|---|
| `clock.js` `hostAxis`/`correctionAt` (`MUTATION-EQUIVALENCE` §3) | 12 | **no** — deliberately, §8.4 |
| `clock.js` parse family (`CLOCK-PARSE-EQUIVALENCE`) | 8 | **no** |
| `ppgdex-dsp.js` `lombScargle` (#1052 — *"15 classified"*) | 15 | **no** |
| `ppgdex-dsp.js` `parsePPG` (#1052 — 38 probed, 10 distinguishable) | 28 | **no** |
| `ppgdex-dsp.js` `loadOwnExport` (#1052 — 22 probed, 17 distinguishable) | 5 | **no** |
| `capture.run_polar` (`RUN-POLAR-MUTATION-STOP-HERE` §1 — *"every equivalent PROVEN"*) | 15 | **no** |
| | **~83** | **1** |

**The consequence is not cosmetic: the ratified target is currently unmeasurable on every subject
except `clock.js`.** A sweep reports each of those ~83 as UNCLASSIFIED, so the distinguishable
denominator is too wide everywhere, so `killed / distinguishable` is not a number anyone can quote —
which is the exact condition §1 was built to end.

It is also this repo's most-repeated failure shape, and the mechanism's own README names it: *"until
now this classification lived in BRIEF PROSE, which means every sweep re-litigated the same survivors
and no tool could report it."* The mechanism was built. It was fed once.

**Why the fix is not transcription.** `MUTATION-EQUIVALENCE` §8.4 is explicit — *"writing twelve
entries from a prose summary would be inventing data of exactly the kind this mechanism exists to
replace"*. And the second cause is structural: **the only committed prober is
`tools/probe-clock-equivalence.mjs`, and it is `clock.js`-specific by construction** (it hardcodes the
file, the battery and the callable surface). The batteries that produced the 960-input `lombScargle`
result and the 68-input `parsePPG` result were **never committed**, so those verdicts cannot be
re-checked, widened, or re-run against moved code. §7.1 is therefore a *prober*, not a transcription.

## 3 · What predicts COST — concentration, and tag price

Two independent measurements, one per fleet, and they agree on the shape.

**Python — concentration.** Sorted by largest reachable cluster (`mutate_triage.py --rank`,
2026-08-04). ~1,150 reachable fleet-wide across 19 modules with a scratch.

| module | survivors | reachable | largest cluster | share |
|---|---:|---:|---|---:|
| `capture` | 622 | **502** | `run_polar`=502 | **100 %** |
| `webmon` | 223 | 97 | `make_app`=94 | 97 % |
| `timeline` | 115 | 82 | `build`=36 | 44 % |
| `nightqc` | 119 | 67 | `summarize`=32 | 48 % |
| `polar_pmd` | 58 | 55 | `decode_frame`=25 | 45 % |
| `bonding` | 73 | 55 | `scan`=17 | 31 % |
| `pull_session` | 104 | 49 | `_pull_once`=31 | 63 % |
| `host_clock` | 97 | 41 | `read_state`=18 | 44 % |
| `clockcfg` | 88 | 37 | `status`=11 | 30 % |
| `storage_targets` | 138 | 43 | `test_target`=11 | 26 % |
| `telemetry` | 55 | 42 | `TelemetryBus.push`=11 | 26 % |
| `oxyii` | 80 | 65 | `parse_live`=11 | 17 % |
| `nightarchive` · `diskguard` · `link_rssi` | 16 · 15 · 43 | 16 · 14 · 14 | 31 % · 64 % · 29 % | |
| `proc_util` · `viatom` · `settings_schema` | 2 · 1 · **0** | — | — | |

Share ≥ 60 % ⇒ one fixture family takes most of it (`clockcfg` returned **40 mutants from 6 tests**,
because 27 sat in one function no test had driven). Share ≤ 30 % ⇒ scattered, each mutant its own
setup — `link_rssi` at 29 % returned **1 mutant for 3 tests**, the measured worst case.

⚠️ The earlier "returns have flattened to ~13/pass" reading was **within** a module, not across the
fleet; never-measured modules then gave 9 → 11 → 10 → 15 → 40.

**JS — tag price, a 300× spread.** The per-mutant floor is the tag's clean-run time. Sampled 60 per
file, scoped, bail on (#1027 — an estimate of the whole, `thin()` spreads deterministically).

| file | groups | tag cost | sampled rate | mutants |
|---|---:|---:|---:|---:|
| `hrvdex-dsp.js` | 15 | 1 s | 28 % | 490 |
| `ppgdex-dsp.js` | **49** | 24 s | 33 % | 1176 |
| `motiondex-dsp.js` | 15 | 1 s | 37 % | 466 |
| `cpapdex-dsp.js` | **7** | 4 s | 40 % | 819 |
| `pulsedex-dsp.js` | 17 | 6 s | 42 % | 568 |
| `glucodex-dsp.js` | 16 | 2 s | 55 % | 836 |
| `oxydex-dsp.js` | 39 | 20 s | 58 % | **2680** |
| `ecgdex-dsp.js` | 48 | 137 s | 62 % | 1725 |
| `integrator-dsp.js` | **73** | 310 s | 68 % | 1745 |

- **1–6 s** (`hrvdex`, `motiondex`, `glucodex`, `cpapdex`, `pulsedex`) — **exhaustively sweepable.**
- **20–310 s** (`oxydex`, `ppgdex`, `ecgdex`, `integrator`) — **sample-and-triage only.**
  `integrator-dsp.js` exhaustively is ~150 CPU-hours *scoped*; nobody will run that periodically. It
  is also the fusion layer every node feeds, i.e. simultaneously the most consequential and the least
  sweepable — which is the argument for `--diff` (#1003) gating the lines a PR touches, not an audit.

**Every JS rate above is a scoped lower bound and every one of those runs was UNGUARDED** (no canary
existed for any DSP at the time). Canaries now exist for `clock.js` and `hrvdex-dsp.js` only. Treat
the table as a hypothesis for the seven files that still have no canary.

## 4 · What predicts WORTH — a named incident, not a count

Concentration predicts what a pass *costs*. It says nothing about what the pass is *worth*, and the
`run_polar` pass measured that the two do not agree.

| family | mutants | killed | tests | protects |
|---|---:|---:|---:|---|
| `BUS.*` — the live view | 69 | 66 | 12 | every monitor card's identity + the negotiated rate |
| `_set()` — the status card | 45 | 43 | 17 | `status.json`, `monitor.html`, `alerts.py`'s keys |
| writer dispatch | 22 | 12 | 10 | PSL column order in the files that ARE the night |
| **bounded awaits** | **9** | **9** | **7** | the 2026-07-25 silent freeze — **4 h 25 m behind a green card** |

**The most valuable family was the smallest.** Every family worth closing had a dated incident in the
code's own comments — 2026-07-25 (freeze), 2026-08-05 (vendor rate → amber all night), 2026-07-19
(missing `bpm` card), 2026-07-29 (4.5 h of ECG lost to a stale bond). The families with no incident
behind them are the ones declined in §6.

**And the instrument found a class no reading would.** The bounded-await mutants **hang** rather than
fail, so every prior sweep was blind to them; one had burned 79 minutes of CPU unnoticed. Adding a
per-mutant timeout was worth more than any single test in that pass.

## 5 · 🆕 What predicts CONVERSION — the function's CHARACTER, not the file

This supersedes `PPGDEX-TESTABLE-SURFACE` §4a's headline, and the refutation came from that brief's
own follow-up work (#1052) which was never folded back into it.

§4a probed two functions, got 29 % and 26 %, and generalised: *"two functions of completely different
character agree at ~27 % … the ratio is a property of the code"* ⇒ ppgdex ceiling **~52 %**. A third
function then probed at **77 %**:

| function | character | survivors probed | distinguishable | killed by the tests written |
|---|---|---:|---:|---:|
| `lombScargle` | numeric / spectral | 21 | 6 (29 %) | **6 — exhausted** |
| `parsePPG` | string / parsing | 38 | 10 (26 %) | 5 |
| `loadOwnExport` | **validation / dispatch** | 22 | 17 (**77 %**) | **18 (82 %)** |

**The equivalent-mutant share is a property of what a function DOES.** Validation and dispatch branch
on input shape, so nearly every boolean mutation is observable. Numeric and parsing code *absorbs*
mutations — a perturbed window bound moves a spectral estimate by less than any assertion's tolerance.

Two consequences, and they are the actionable output of this whole programme:

1. **Both fleet maps rank the wrong unit.** A file's rate is a weighted average over functions of
   different character, so "`hrvdex` is worst at 28 %" and "`integrator` is best at 68 %" mostly
   report each file's mix, not its neglect. **Target validation/dispatch clusters wherever they sit.**
2. **`PPGDEX-TESTABLE-SURFACE`'s ~52 % ceiling is withdrawn.** ppgdex stands at ≈424/1162 ≈ **36.5 %**
   (395 → 406 → 424, arithmetic from #1052's three commit messages — **not re-measured**, §7.2), and
   the ceiling is unknown because it depends on a function-character mix nobody has profiled.

`PPGDEX-TESTABLE-SURFACE`'s two other conclusions **stand and are carried forward**: the `_bare`
export plan is **withdrawn** (it would spend a DSP source change, a re-bundle, a moved `computeHash`
and owed corpus fixture re-verification to buy survivors converting at 14 %), and **91 survivors sit
in functions that are already exported** — free to attack, and `loadOwnExport` was one of them.

## 6 · Standing DECLINES — what this programme will not buy

Each has evidence behind it. A survivor matching one of these is classified, not chased.

| declined | rule | evidence |
|---|---|---|
| **tuned constants** | *a mutant killable only by asserting a value chosen by tuning is not the suite's to own.* Pin the behaviour (backoff grows; it is capped), let the number move | `run_polar` backoff, 29 mutants; `CHARGE_RETRY_S` et al. have all moved in response to measurement |
| **message wording** | killing it pins prose and reds the build on every message edit | 161 `run_polar` mutants → PROSE, 2026-08-08 |
| `flush=True/False/None`, mutmut's `"XX…XX"` wrapping, case flips | identical to any assertion on captured output | `CAPTURE-HOST-MUTATION-FLEET` §5 |
| **numeric interiors of absorbing functions** | ≤ 30 % convert; §5 | `lombScargle` 29 %, `parsePPG` 26 % |
| **`≤ 30 %`-concentration tails** | each mutant is its own setup | `link_rssi`: 1 mutant for 3 tests |
| **`run_polar`'s remaining 183** | four families closed; the rest declined in writing | `RUN-POLAR-MUTATION-STOP-HERE` §2 |

`run_polar`'s families, recorded here so it is not re-opened as if untouched: `other` 59 **declined** ·
`reconnect / bonding` 35 **conditional** (§7.5) · `negotiation + decode` 33 **declined** (they are
`polar_pmd`'s call sites, separately swept) · `backoff / sleep cadence` 29 **declined** · `loop /
branch conditions` 12 + 13 timeouts **judge first** (§7.4) · `device clock + skew` 12 **conditional** ·
`stall + worn watchdog` 8 **declined** · PMD control-point I/O 4 **done**.

**The target is zero REACHABLE, not 100 %.** `--rank`/`ceiling()` refuse to print a kill-rate goal
without its ceiling beside it, deliberately.

## 7 · Open work, in order

### 7.1 · Feed the mechanism — a **committed, general** prober *(first; in progress)*

The ~83 measured-but-unrecorded classifications of §2, produced by a prober that lives in the repo so
the verdicts can be re-checked rather than believed. Generalise
`tools/probe-clock-equivalence.mjs` — it already carries the one design rule that matters:

> **A positive control must live in the SAME FUNCTION as the mutant it clears.** A battery that never
> reaches the code reports "equivalent" about *itself*. Its first run came back **3-of-14 BLIND**
> (`_ckDMY` called with one argument; `L94`'s `b > 12` needing `b` exactly 12) and the sweep before it
> had reported those survivors as equivalent on a battery whose only control sat in another function.

Order: `ppgdex-dsp.js` (48 — the batteries are described in #1052 and can be rebuilt) → `clock.js`
(20, both prose sets) → `capture.run_polar` (15, Python side).

### 7.2 · Re-measure what is quoted from arithmetic

ppgdex's ≈36.5 % is three commit messages added together. `hrvdex`'s 39.1 % (#1030) predates two
sweeps' worth of tooling fixes. **Neither is a measurement.** One scoped sweep each, canary-guarded.

### 7.3 · Canary-guard the seven unguarded DSPs

`clock.js` and `hrvdex-dsp.js` have canaries; the other seven do not, and §3's table was produced
without one. Each sweep *learns* a canary for the next, so this is a by-product of 7.2 rather than
separate work.

### 7.4 · One measurement, before anything is written for it

`run_polar`'s 13 loop-condition timeouts: **is the non-termination real, or an artefact of
`_stop_after`?** The fixture patches `asyncio.sleep` to a no-op, so a loop that no longer awaits never
sees `_STOP`; in production the same mutation spins at 0.3 s and exits on shutdown. One run with an
unpatched sleep and a real deadline settles it. If it is the fixture, they are not findings.

### 7.5 · Two decisions, in writing

- **`reconnect / bonding` (35)** — the only declined family with a measured incident behind it
  (2026-07-29, 4.5 h of ECG lost). Take it or decline it; do not leave it ambiguous.
- **A fleet-wide target** — the *denominator* question is answered (§1); whether a single number is
  adopted across 31,000 lines of DSP is not, and §5 argues a file-level number is the wrong unit to
  set one on.

### 7.6 · The scoped-vs-full penalty for a DSP is still unmeasured

Measured once, on `clock.js`: **1 mutant in 127**, and that file is the least likely to have killers
outside its own tag. `cpapdex-dsp.js` is the natural probe — narrowest tag (7 groups, 3 of which kill
anything) against the third-largest file, so it is the one place "the killers are elsewhere" is a live
hypothesis. ⚠️ Unfiltered means the **whole suite per mutant** (>10 min); this is a *sample*, and
saying which sample is part of the result.

### 7.7 · Carried-over openers

`--rank` runs silent fleet-wide (a `mutmut show` per survivor) · the ETA window should be
`max(2 × jobs, 12)`, not 12 · `tools/mutate_pure.py`'s witness search is still unwired into triage ·
real frames from the PSL corpus would legitimately inform `oxyii.parse_live` + `polar_pmd.decode_frame`
without breaking the hermetic suite — resolve the path before *those two* passes only.

## 8 · The instrument rules — deduped across both fleets

**Every serious failure in this programme was in the instrument, not the code under test.** Both
fleets found that independently; it is the single most transferable result here.

| rule | what it stops | how it was learned |
|---|---|---|
| clear `__pycache__` inside every apply/revert loop | a **stale `.pyc`** running a reverted mutant while `git status`, `git diff` and `inspect.getsource` all read clean | `cpap_harvest`; the negative control was corrupted in both directions |
| assert the mutation anchor is **unique** | `replace(old,new,1)` mutating the *wrong* function; three read as survived and two of those were real gaps | `storage_targets` |
| a **per-mutant timeout**, and a hang is its own verdict | a hanging mutant stalling a sweep forever, and a whole class invisible to every prior sweep | `run_polar` bounded awaits |
| restore in `finally` + `atexit` | a killed run leaving `capture.py` **mutated on disk** (it did) | `run_polar` |
| a **baseline guard** | two test paths passed as one argv element ⇒ pytest exits non-zero ⇒ **264/264 "killed" with nothing collected** | `run_polar` |
| a **verified line map** (body offset → absolute, re-checked against source) | text anchors silently SKIPPING 17 of 45 mutants and reporting 13/45 as if measured | `run_polar` |
| never score a **non-zero exit** as a kill | 5 of `clock.js`'s 104 "kills" never ran | #982 |
| confirm the run said **`FINISHED`** | a truncated run leaving `mutmut results` empty ⇒ counted as a **perfect score** | `CAPTURE-HOST-MUTATION-FLEET` §6 |
| a **positive control in the same function** | a battery that never reaches its subject reporting "equivalent" | `CLOCK-PARSE-EQUIVALENCE` — 3-of-14 blind |
| check the battery produced **varied output** before believing a verdict | `PPGDSP.loadOwnExport` is undefined (it hangs off `PpgDex`) ⇒ every case threw identically ⇒ **0 of 22, a complete artefact** | #1052 |
| a difference caused by the **probe realm** is not evidence about the code | `L439`'s mutant differed only by *"DexClock is not defined"* — the probe realm has no co-loaded clock | #1052 |
| **re-apply the mutant** before believing a test kills it | three `clock.js` tests looked correct and killed nothing; a test written from reading the code passes under the mutant it was meant to kill | throughout |
| kill with an input that **MAGNIFIES**, not merely one that reaches | `f >= 0.003` → `>` costs 1 unit in 3910 at 0.0401 Hz, and 27 % at exactly 0.003 Hz | #1052 |
| do not extrapolate a **partial** sweep | at 60/127 the unfiltered run looked meaningfully better; the full population came back 33 vs 34 | `MUTATION-EQUIVALENCE` §7 |
| a progress line on anything looping > ~50 items | a 1 h 42 m run indistinguishable from a hang without reading `/proc` | three instances in one day |
| profile a new test file with `--durations` | a 5.18 s test spending three unrelated mutants' timeout budget, flipping them KILLED → TIMEOUT | `wifi_up` |
| **never append tests blind** | a new file shadowed an existing `_night` helper and broke 30 passing tests elsewhere | `CAPTURE-HOST-MUTATION-FLEET` §6 |

The family has one shape, and it is CLAUDE.md §👥.4b's: **the check ran, and reported success about
something it never examined.**

## 9 · Done when

- [x] The four briefs are folded here and marked DONE, with `Folded-into:` headers and synced
      `DOCS-INDEX.md` rows.
- [x] §1's denominator is ratified and both gates carry the mechanism.
- [ ] **§7.1 — `tools/mutate-equivalence.json` carries every classification this programme has
      measured**, produced by a committed prober, with its battery recorded per entry. Until then the
      ratified target is unmeasurable outside `clock.js` and no `killed / distinguishable` figure is
      quotable.
- [ ] §7.2 — ppgdex and hrvdex re-measured rather than added up; §7.3's canaries land with them.
- [ ] §7.4 — the 13 loop-condition timeouts recorded as real or artefact. **Nothing is written for
      them first.**
- [ ] §7.5 — both decisions taken in writing.
- [ ] §7.6 — the scoped-vs-full penalty sampled on `cpapdex-dsp.js`, with the sample stated.
- [ ] §6's rules are in `MUTATION-AUDIT-RUNBOOK` beside the ceiling rule, so the next pass does not
      re-derive them.

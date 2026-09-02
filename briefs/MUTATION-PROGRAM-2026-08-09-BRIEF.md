<!--
  MUTATION-PROGRAM-2026-08-09-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS · **Created:** 2026-08-09 · **Folds:** `MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md`, `CAPTURE-HOST-MUTATION-FLEET-2026-08-04-BRIEF.md`, `JS-DSP-MUTATION-FLEET-2026-08-08-BRIEF.md`, `PPGDEX-TESTABLE-SURFACE-2026-08-08-BRIEF.md` · **Affects:** `tools/mutate.mjs`, `tools/mutate-equivalence.json`, `capture-host/tools/mutate_diff.py`, `tests/dex-tests.js` · **DRAIN 2026-09-02 (Osprey):** charter head — folds four briefs, 5 of 12 Done-when boxes ticked. Kept as the family's index; it closes when its children do, not on its own. **Owner: Osprey. Next step:** none directly — drive the children (COVERAGE-SELECTION is nearest at 9/10).

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

**Executed 2026-08-09:** `tools/probe-equivalence.mjs` + `tools/probe-batteries/` (#1107). Three
defects surfaced by *running* it, each a §8-family failure: `functionRange` brace-counted without
stripping comments and regex literals, measuring `lombScargle` at L1865–**2582** — 588 lines past its
end, so 9 of 11 "same-function controls" were unrelated code and the family reported BLIND; the
mutant enumeration was read from a child **through a pipe** and truncated at ~146 KB (ppgdex's is
~1.5 MB); and the first battery read `json.node` where the code reads `json.schema.node`, so all 41
inputs took one refusal arm — **2 distinct answers over 41**, caught by the degenerate check.

## 2a · AND IT IS NOT ONLY PROSE — two machine-readable result sets sit UN-TRIAGED on disk

Found 2026-08-09 by searching the disk rather than the repo. Both are **gitignored by design** — a
sweep is a measurement of a moment and goes stale the instant a test changes — which is correct, and
is also why neither is visible to anyone reading the repo:

| where | what | state |
|---|---|---|
| `<checkout>/.mutation-crawl/` (`.gitignore:200`) | `hrvdex-dsp.js` + `motiondex-dsp.js` **full sweeps**, each with its complete survivor list — in the same *record*, but ~~in exactly the shape `probe-equivalence` reads~~ **not in a shape it could parse; see §2b** | `probed: 0`, `killable: 0`, `findings: []` |
| `/home/michal/tepna-mutation-audit-2026-08-02/` | **19 capture-host modules** — `<module>.stats.json` + `<module>.survivors.txt`, mutmut 3.7.0, baseline 1818 passed at 100 % statement+branch | superseded as a ranking by §3, still the only per-mutant ID list |

The crawl pair is the immediately useful one, and both figures are **measured, not arithmetic**
(`killed + survivors + invalid == tested` checks out on both):

| file | tested | killed | invalid | survivors | honest rate | canary |
|---|---:|---:|---:|---:|---:|---|
| `hrvdex-dsp.js` | 489 | 191 | 0 | 298 | **39.1 %** | **PASSED** |
| `motiondex-dsp.js` | 466 | 171 | 8 | 287 | **37.3 %** | **NONE** |

Both **confirm** rather than correct: 39.1 % is exactly what #1030 reported, and 37.3 % is what the
fleet map sampled at 37 %. (The map's 28 % for hrvdex is *pre*-#1030 and not in conflict.) So this is
the fleet's **first canary-guarded full DSP sweep**, and §7.2/§7.3 are already discharged for hrvdex.

**`probed: 0` is the point.** `mutation-crawl` was built to *"run the MEASUREMENT unattended and leave
the judgement to a person"* (#1075), and it did its half. Nobody did the other half — so 585 survivors
across two files have been sitting classified-as-nothing since 05:04 this morning, which is §2's
finding in a second, entirely mechanical form.

## 2b · 🔴 THE TWO TOOLS BUILT TO FEED EACH OTHER COULD NOT — and §2a said they could

**Executed 2026-08-09 (this pass).** §2a above asserted the crawl sweeps sat on disk *"each with its
complete survivor list in exactly the shape `probe-equivalence` reads"*. That sentence was written
from the record's **field names**. Nobody ran it. Pointing the prober at the file it was supposedly
already compatible with produced, immediately:

```
SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)
```

`mutate.mjs --json` emits **NDJSON**, one dense line per file, so the reader took the first line
starting with `{` and parsed that. `mutation-crawl.mjs:365` writes the same record
`JSON.stringify(rec, null, 2)` — **pretty-printed**, whose first `{`-line is the bare character `{`.
298 survivors were unreachable behind a newline, under an error message that told the reader the file
*"has no JSON object"* when the whole file is one. Fixed: `parseSweep` tries whole-file JSON first,
falls back to the NDJSON line scan, and **refuses** an empty or truncated record rather than reading
it as a sweep with no survivors (6 known-answer selftests).

**And behind it, a second and worse one — a DISPLAY field re-applied as source.** With the sweep
finally readable, 42 of 217 probed survivors came back `REALM-FAIL … Unexpected token 'const'`. That
reads as a fact about the mutant. It was a fact about the reader: `mutate.mjs:225-226` records
`before`/`after` **truncated at 100 characters** — a terminal width — while the executable mutation
lives in a closure `apply()` that JSON drops. `probe-equivalence.applyMutant` rebuilt the line as
`indent + after.trim()`, so **every source line longer than 100 characters was written back cut
mid-expression**. It failed *closed* (an unparseable realm is never emitted as an equivalence) but
silently, and at 19 % of the file, while the run printed a confident count of the rest.

Fixed at both ends: `--dry-run --json` now also emits `mutated`, the same line untruncated, and
`applyMutant` prefers it and **throws** rather than reconstruct from a field it can see is truncated.
`before`/`after` keep their truncated shape deliberately — they are the `(line, op, before)` key
`findCanary` and `mutate-equivalence.json` match on, and widening them would orphan every entry
already recorded.

Both are CLAUDE.md §👥.4b — *the check ran, and reported success about something it never examined* —
and both were invisible until the tool was pointed at real data. That is now three consecutive passes
(#1107, #1111, this one) where **running the instrument found defects in the instrument**, which is
§8's headline restated as a schedule rather than a lesson.

## 2c · hrvdex-dsp.js — EXECUTED, and the sweep reproduced exactly

**2026-08-09.** §2a's figure was re-measured from scratch rather than quoted: a fresh
`--jobs 10 --bail` sweep on `bac6e3a2`, 11 m 35 s, against a `tests/dex-tests.js` that has moved
substantially since the 05:04 crawl.

| | crawl 05:04 | fresh re-run | |
|---|---:|---:|---|
| tested / killed / invalid / survivors | 489 / 191 / 0 / 298 | 489 / 191 / 0 / 298 | identical |
| canary | PASSED | PASSED | |
| survivor **set** (by `line\|op\|after`) | — | — | **0 differences, both directions** |

Not just the counts — the 298 survivors are the *same* 298. So 39.1 % is now measured twice on two
test-suite states, and §7.2/§7.3 are discharged for hrvdex on evidence rather than on one run.

**Six families probed, 217 of the 298 survivors, every control separated:**

| family | character | survivors | distinguishable | no-distinguishing | controls |
|---|---|---:|---:|---:|---:|
| `computeDerived` | numeric / derivation | 149 | 98 | 51 | 40/40 |
| `hrvLoadOwnExport` | validation / dispatch | 11 | **11** | **0** | 10/10 |
| `hrvBuildNodeExport` | assembly / ordering | 19 | 10 | 9 | 11/11 |
| `hrvEventsFromRows` | thresholding / emission | 16 | 15 | 1 | 4/4 |
| `_hrvParseSummaryRows` | string / parsing | 12 | 5 | 7 | 12/12 |
| `computeCAMQ` | scoring / clamping | 10 | 9 | 1 | 7/7 |
| | | **217** | **148** | **69** | **84/84** |

Zero blind, zero degenerate, zero realm-fail, zero hang. **69 entries emitted** to
`tools/mutate-equivalence.json` (the file went from 44 entries to 113); the 148 distinguishable are
**not** emitted — they are debt and stay in the denominator. The remaining **81 survivors sit in
functions with no family and remain UNCLASSIFIED**, which the sweep reports by name.

**§5 CONFIRMED on a second file, and the spread is wider here than in ppgdex.**
`hrvLoadOwnExport` — validation/dispatch, the same character as ppgdex's `loadOwnExport` — came back
**11 of 11 distinguishable, 100 %**, against **34 %** for the numeric `computeDerived`. That is not a
file-level property in any useful sense; it is the function's character, exactly as §5 argues, and it
is the second independent measurement of it.

**The gate's own verdict, from a third full sweep run with the ledger in place:**

```
equivalence: 69 excused, 0 real-gap, 220 UNCLASSIFIED   [45 % of 420 distinguishable]
── 1 file(s) measured, 0 skipped ── 191/489 killed = 39 %  (of 490 mutants that exist)
```

**0 REFUTED, 0 ORPHANED.** So `killed / distinguishable` is quotable for `hrvdex-dsp.js` for the
first time: **191/420 = 45.5 %**, against a raw 39.1 %. It is a long way from 90 %, and 220
unclassified survivors is why — that gap is *debt made visible*, which is the whole point of §1's
denominator.

⚠️ **220, not 229 — and the 9 are a property of the KEY.** 298 − 69 = 229, but `classifySurvivors`
keys on `(line, op, before)`, and a line carrying two mutations of the *same operator* produces two
mutants with an identical key (`L735` has three such pairs). Those collapse: the extra survivor is
neither counted excused nor reported unclassified. It cannot flatter the rate — the denominator is
`tested − excused`, and `excused` counts entries — but **it is a blind spot in the reporting**, and it
is the JS twin of the anchor-uniqueness rule §8 already carries for the Python side. Worth a column
offset in the key; not fixed here, and recorded rather than left to be rediscovered.

⚠️ **What this does NOT license.** 69 `no-distinguishing-input` verdicts are strong evidence over a
163-input battery, not proof over the input domain. Every entry records its battery so a later pass
can widen it, and `mutate.mjs` reports **REFUTED** the moment any of them turns out killable.

⚠️ **Nor does "84/84 controls separated" mean the battery is complete.** It means it separates the 40
sampled controls in the largest family. At 8, 16 and 24 controls this same battery reported *different*
blind mutants each time; each round was a real widening (a profile arm, a varying `_sdnn`, per-column
subjective absences, the clock-hour bands). Only at 40 did it stop finding new ones. **Raising
`--controls` is a measurement, not a formality** — a family proven against 8 has not been proven
against 40.

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

| file | groups | tag cost | sampled | **MEASURED** | error | mutants |
|---|---:|---:|---:|---:|---:|---:|
| `hrvdex-dsp.js` | 15 | 1 s | 28 % | **39.1 %** | — ¹ | 490 |
| `ppgdex-dsp.js` | **49** | 24 s | 33 % | **39.0 %** ⁴ | −1.0 ² | 1176 |
| `motiondex-dsp.js` | 15 | 1 s | 37 % | **37.3 %** | −0.3 | 466 |
| `cpapdex-dsp.js` | **7** | 4 s | 40 % | **40.4 %** | −0.4 | 819 |
| `pulsedex-dsp.js` | 17 | 6 s | 42 % | **25.5 %** | **+16.5** | 568 |
| `glucodex-dsp.js` | 16 | 2 s | 55 % | **33.7 %** | **+21.3** | 836 |
| `oxydex-dsp.js` | 39 | 20 s | 58 % | **33.8 %** | **+24.2** ³ | **2680** |
| `ecgdex-dsp.js` | 48 | 137 s | 62 % | **30.4 %** | **+31.6** ⁵ | 1755 |
| `integrator-dsp.js` | **73** | 310 s | 68 % | **46.3 %** | **+21.7** ⁶ | 1748 |

¹ hrvdex's 28 % predates #1030's `computeDerived` golden; the 39.1 % is post-fix and canary-guarded,
so the two measure different code and the error column would be meaningless.
² ppgdex's measured figure is post-#1113 (+10 kills); against the same code the sample erred −1.0.
³ oxydex swept 2026-08-10: 2680 tested, 899 killed, 18 invalid, 1763 survivors, 88 min wall.
`canary: NONE` because it was the file's FIRST sweep — the run learned one (L72 `eq === → !==`), so the
next oxydex sweep is canary-guarded. The harness demonstrably worked: it killed 899.

⁴ re-swept 2026-08-10 against the expanded battery: 1204 tested, 464 killed, 15 invalid, 725
survivors, `canary: PASSED` — 39.0 %, confirming the earlier 38.9 % against unchanged code. With 99
recorded equivalents the DISTINGUISHABLE rate is 464/1090 = **42.6 %**.

⁵ ecgdex swept 2026-08-10: 1755 tested, 526 killed, 22 invalid, 1207 survivors, 5.7 h wall.
`canary: NONE` — first sweep of the file; it learned one (L68) so the next is guarded. The battery
landed in #1151 claims 1006 of the 1207 survivors (83.3 %).

⁶ integrator swept 2026-08-11: 1748 tested, 806 killed, 8 invalid, 934 survivors, 13.8 h wall — the
most expensive sweep in the fleet at 310 s per run. `canary: NONE` (first sweep); it learned one (L83),
so every DSP in the fleet now has a canary.

### 🔴 THE SAMPLE IS NOT RELIABLE, AND THE FAILURE IS BIMODAL RATHER THAN NOISY

Seven files have now been swept exhaustively against their 60-mutant sample. The errors do not look
like a distribution around zero:

```
sampled  33   37   40   42   55   58   62
MEASURED 39.0 37.3 40.4 25.5 33.7 33.8 30.4
error    −6.0 −0.3 −0.4 +16.5 +21.3 +24.2 +31.6
```

**⚠️ RETRACTED, BY THE SWEEP THIS SECTION PREDICTED.** What stood here after seven files said the
sample "carries no usable signal", that every real rate sat in a 15-point band, that the fleet was
"one population around 34 %", and that the error "grows monotonically with the sampled value". It
then predicted `integrator` would measure **~34 %**.

`integrator` measured **46.3 %** — the HIGHEST rate in the fleet. The prediction missed by 12.3
points and took two of the three claims with it:

```
file         sampled  MEASURED   error
ppgdex         33 %     39.0 %    − 6.0
motiondex      37 %     37.3 %    − 0.3
cpapdex        40 %     40.4 %    − 0.4
pulsedex       42 %     25.5 %    +16.5
glucodex       55 %     33.7 %    +21.3
oxydex         58 %     33.8 %    +24.2
ecgdex         62 %     30.4 %    +31.6
integrator     68 %     46.3 %    +21.7   ← predicted ~34 %
```

**What is REFUTED:**
- *"one homogeneous population near 34 %"* — the band is 25.5–46.3, and integrator is a genuine
  outlier upward. The fleet is NOT uniform.
- *"the error grows monotonically with the sampled value"* — ecgdex (62 → +31.6) against integrator
  (68 → +21.7). It does not.
- *"r = −0.46, no positive signal"* — with the eighth point r moves to **+0.10**. The negative
  correlation was noise in seven points, which the hedge half-anticipated and the conclusion built on
  anyway.

**What SURVIVES, and it is the useful part:**
- **Above a sampled ~42 %, the sample over-states — 5 of 5, by +16.5 to +31.6.** Not one high row
  came in at or above its estimate.
- **At or below a sampled 40 %, it is close** — −6.0, −0.3, −0.4.
- So the sample is not uninformative; it is **one-sidedly optimistic in its upper range**. A high
  sampled figure means "unknown, probably lower", never "high".

**This is the programme's own most-repeated error, committed again by the person documenting it.**
§5's `~27 %` generalisation, §3a's six-cluster claim, "the sample held on three files" — and now
"one population around 34 %", generalised from seven points and broken by the eighth. The lesson is
not that the estimates were bad; it is that **a pattern over n files is a hypothesis until the n+1th
file, every time.** The prediction was written down BEFORE the sweep specifically so it could fail
visibly, and it did.

- **"the sample held on three files" was never evidence that the sample holds.** It was believed
  after three confirmations and refuted on the fourth and fifth. Three agreeing measurements are the
  same shape as §5's `~27 %` generalisation and §3a's six-cluster claim — this programme's most
  repeated error is generalising from agreement;
- a fleet-wide *ranking* built on these numbers is unsafe: `glucodex` and `pulsedex` were ranked 6th
  and 5th best and are in fact the WORST two measured.

Cheapest way to settle it: sweep one more cheap file and see which population it joins.

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

### 7.0 · TWO THINGS THE PROBING FOUND THAT CHANGE THE METHOD, not just the numbers

Both were discovered by running the prober rather than by reasoning about it, and both are properties
of the MECHANISM rather than of any node.

**(a) A function with ZERO kills cannot be classified at all — and 12 % of the fleet was in that
state.** The engine requires a positive control from the same function: a mutant the suite killed,
replayed to prove the battery reaches the code. With no kills there is nothing to replay, so every
verdict is withheld *however good the battery is* — and the batteries were good (`genSynthetic` got 52
distinct answers over 53 inputs; `compareIntervalSeries` 13 over 24). **"0 % killed" and "100 %
equivalent" are indistinguishable to the tool**, and no better battery closes the gap. The only exit
is one test.

**Scanned across every swept file, the class is far larger than the three found by accident.** Any
function holding ≥8 survivors and zero kills, measured against each file's own sweep:

| file | function | survivors | state | conversion |
|---|---|---:|---|---|
| `glucodex-dsp.js` | `genSynthetic` | 90 | **done** | 5 of 6 |
| `ppgdex-dsp.js` | **`cvhrFromNN`** | **57** | open — the hard one | — |
| `pulsedex-dsp.js` | `compareIntervalSeries` | 54 | **done** | 3 of 8 |
| `motiondex-dsp.js` | `inferAccUnit` | 31 | **done** | 6 of 9 |
| `glucodex-dsp.js` | `locateColumns` | 30 | **done** | 3 of 9 |
| `cpapdex-dsp.js` | `_nightFromInput` | 20 | **done** | 6 of 8 |
| `pulsedex-dsp.js` | `fragmentation` | 19 | **done** | 4 of 8 |
| `hrvdex-dsp.js` | `getFilteredRows` | 11 | **not probeable** — reads `document` | — |
| `glucodex-dsp.js` | `applySessionCorrections` | 8 | **done** | **7 of 8** — the best yet |
| `glucodex-dsp.js` | `correlateNutrition` | 3 | open (found by the pipeline probe) | — |
| `glucodex-dsp.js` | `perDay` | 1 | open (found by the pipeline probe) | — |
| | | **~324** | **seven done, ~252 unlocked** | ≈ 20 % of the mapped fleet |

`applySessionCorrections` converted at **7 of 8** — the highest in the programme — and it took three
passes, each blocked by the same thing in a different disguise: **the assertion was coarser than the
mutant.**

- The first pass killed 5. Its fixture came from `genSynthetic`, whose sessions all sit at nearly the
  same level, so the offsets were `[1, 0, -1]` — at that size an operand swap, a dropped `Math.round`
  and a broken subtraction all look alike. Three sessions at a deliberate **90 / 110 / 130** give
  `[+20, 0, -20]`: signed, exact, and different from its own negation.
- The `deDrift && sess.driftPerDay != null` → `||` mutant needed levelling **on** and de-drift **off**
  over a *ramped* series. With neither flag the function returns at its first line and never reaches
  that branch, so every earlier case was structurally blind to it.
- The `Math.max(20, v)` floor needed the record **minimum**, not a daily median. A median over 288
  readings does not move when the few beneath the floor are lifted, so the median assertion passed
  identically with and without the clamp. `analyze().min` reads 20 against the mutant's 0.

The one survivor is honest debt and is recorded as such: `p < sess.e` → `p <= sess.e` corrects one
extra sample per session, and every value this function exposes is an aggregate — offsets, a global
median, daily means over 288 readings. One sample moves none of them. Killing it needs a per-sample
view of the corrected series that `analyze` does not export.

### 7.0d · THE BATTERIES COVERED A MINORITY OF THE FLEET, AND THE TOOL COULD NOT SAY SO

§7.0c found this in one file. It is fleet-wide, and it is the largest single defect the programme has
turned up — not in the code under test, but **in the instrument**.

`probe-equivalence` scores each family against the mutants in its `fn`'s LINE RANGE. A survivor in a
function no family names is therefore not "unclassified" — it is **invisible**. It is not counted, not
reported, and not missed. The run ends *"all controls separated"* and reads as complete. Measured
2026-08-10, before this work-unit's changes:

| file | survivors | claimable by any family | **invisible** |
|---|---:|---:|---:|
| `ppgdex-dsp.js` | 736 | 57 | **679 (92 %)** |
| `cpapdex-dsp.js` | 488 | 133 | **355 (73 %)** |
| `motiondex-dsp.js` | 287 | 92 | **195 (68 %)** |
| `glucodex-dsp.js` | 516 | ~190 | ~326 |
| `hrvdex-dsp.js` | 298 | 217 | 81 (27 %) |
| | | | **≈ 1310** |

ppgdex had **three** families for a **46-function** module, and its probes had been reporting clean
runs throughout. This is precisely the failure class this repo keeps meeting — *a gate that passes
without examining the thing it names* — and the fix is not a better battery. It is **a number that
makes the omission visible**, so a battery's REACH is reported beside its verdicts:

```sh
node tools/probe-coverage.mjs --sweep <sweep.json>     # exits 1 when the majority is invisible
```

It prints the invisible survivors grouped by enclosing function — each row is a family nobody wrote —
and is backed by 15 known-answer selftests covering the properties that matter: overlapping ranges
must not double-count (a nested helper inside a claimed function is normal), boundaries are inclusive
at both ends, no ranges means nothing claimable rather than everything, and an empty survivor set is
0 % rather than `NaN`.

**Claimable is not classified**, and the tool says so: a family still has to separate its controls,
and a distinguishable survivor is debt rather than a win. This measures only whether the prober could
form an opinion at all — the difference between *"we looked and found a real gap"* and *"we never
looked"*. Those two were previously the same output.

**ppgdex, rebuilt against that number: 57 → 438 claimable (7.7 % → 59.5 %).** 32 pipeline families now
cover `analyze` and everything it calls. What had been missing was never access — `analyze` is
exported — it was **a fixture that survives beat detection**. The battery's existing generator emits a
linear RAMP: correct for the timing-axis branches it was written for, and pulseless, so every
beat-dependent function downstream returned empty. A generator with an actual pulse (systolic
upstroke, dicrotic notch, diastolic decay, per-channel gain so the three LEDs are not bit-identical)
was verified by execution before any of this was written down:

- 60 s @ 60 bpm → **59 beats, HR 60**; 120 s @ 72 bpm → **130 beats, HR 72**
- and **`cvhrFromNN`** — the "hard one" listed above with 57 survivors, filed as *a project rather than
  a battery* — falls straight out of an HR modulated in the apnea band: flat HR → `cvhrIndex 0`, 0
  events; a 40 s cycle → **84.1, 7 events**; a 30 s cycle → **108.4, 9 events**. It should be struck
  from the hard list.

⚠️ **No ppgdex classifications are emitted here, deliberately.** The available sweep predates #1129 and
only **370 of its 736** survivors still sit on their recorded line. Probing a half-stale sweep cannot
emit wrong verdicts — emission is keyed on the recorded survivor set — but it silently mislabels moved
survivors as *controls*, which corrupts the one check that proves a battery works at all. A fresh
sweep is owed before this battery's verdicts are recorded. The instrument landed first because it is
what prevents the next omission.

### 7.0e · "REACHED" AND "NAMED" ARE DIFFERENT QUESTIONS, AND THE GAP IS 96 FUNCTIONS WIDE

§7.0d measures whether the prober could form an OPINION about a survivor — a question about which
`fn` names the families declare. Underneath it sits a different question with a different fix: which
functions the battery's inputs actually EXECUTE. `tools/probe-reach.mjs` answers that one, and the
two come apart constantly:

| state | meaning | fix |
|---|---|---|
| **reached, not named** | the probe already runs it; nothing claims its survivors | **register the existing probe under that `fn` — one line** |
| **named, not reached** | a family exists but its inputs never get there | a new input SHAPE; a registration would only produce blind controls |
| neither | no family, never executed | write a family |

Measured across the five batteries: **96 functions are already being executed and are not named.**

```
motiondex 28 · glucodex 33 · cpapdex 14 · hrvdex 11 · pulsedex 10
```

On `motiondex-dsp.js` that is nine of the twelve largest invisible clusters — `inferAccUnit`,
`xyzPlausible`, `sampleHz`, `streamKindFromHeader`, `xyzColsFromHeader` (all reached by the
`parseSensorXYZ` probe) and `respWindowSpectrum`, `respResample`, `respViterbi`, `movavg` (reached by
the respiratory probes). **`respViterbi` was being called 168 times per probe run while its 9
survivors sat unclaimed.** Only `bodyPosition`, `classifyGravity` and `buildNodeExport` are genuinely
unreached and need new inputs.

**How it measures, and why the first attempt was thrown away.** It injects a counter as the first
statement of every function body and runs each family's probe ONCE — exact, and one module load per
family. The first version used mutation as a proxy (perturb a line, see whether the fingerprint moves)
and did not finish in ten minutes; the direct measurement returns in seconds. When the proxy is
slower AND weaker than the thing it stands in for, it is not a shortcut.

⚠️ **Reached is not killable, and neither is claimed.** A function can be executed by a probe whose
output never varies with it — which is exactly what the engine's control check exists to catch, and
that check still has to pass. This only rules out the cheapest explanation for a blind family: that
the battery never ran it at all.

### 7.0c · THE PIPELINE IS NOT UNREACHABLE — it was UNPROBED, and it holds NO equivalents

Of glucodex's 516 survivors the original five families claimed ~190. The rest sat in functions the
module does not export, and were quietly counted as "not covered" rather than as anything specific.
They are all reached by **`analyze(parsed, progress, opts)`**, which *is* exported, and `genSynthetic`
supplies its input — so no fixture had to be invented.

**A family's `fn` names the function whose LINE RANGE decides which survivors it claims and which
kills serve as its controls — not the function the probe calls.** So one 50-input pipeline probe is
registered once per pipeline function. Registering it as a single `analyze` family instead would have
classified only the 13 survivors inside `analyze` itself and left the other ~165 untouched, while the
tool reported a clean run.

The result is a clear negative, and it is worth more than a handful of ledger rows:

| function | survivors | controls | distinguishable | equivalent |
|---|---:|---|---:|---:|
| `clean` | 62 | 12/12 | **62** | 0 |
| `postprandial` | 24 | 2/2 | **24** | 0 |
| `detectSessions` | 20 | 6/6 | **20** | 0 |
| `excursions` | 18 | 9/9 | **18** | 0 |
| `dawnPhenomenon` | 13 | 5/5 | **13** | 0 |
| `analyze` | 13 | 11/11 | **13** | 0 |
| `agp` · `nocturnalHypo` · `tierOf` · `daypartVariability` | 16 | all separated | **16** | 0 |
| | **166** | | **166** | **0** |

Every control separated, so the battery demonstrably reaches all of it — and **not one survivor is
equivalent**. The classification lever is exhausted here: glucodex's remaining debt is real gaps, and
the only thing that moves it is tests. That is a more useful answer than more ledger entries would
have been, and it is the first file where the two levers have been told apart with evidence.

**What the six taught, beyond the counts.** Each converted because its test attacked a DISCRIMINATION
rather than a happy path, and twice the first attempt failed for the same reason:

- `inferAccUnit` — test the BOUNDS, not the bands. 1000 / 1 / 9.81 confirms three bands exist and
  exercises none of the six comparisons; every band edge returns null, and that is what separates `>`
  from `>=`. Mistaking g for mg is a 1000× error in every downstream metric.
- `locateColumns` — the band predicate survived until a SECOND numeric column was present, because
  with one column the scorer picks it whatever the band test says. **A discriminator is only tested
  when something has to be discriminated.** With a device counter beside the glucose column, a mutant
  reports a serial number as blood glucose.
- `fragmentation` — the same line appears TWICE (inside the run loop and after it) and only a series
  *ending* in alternation reaches the second.
- `parseCSV` — **the battery never executed the function at all**, and looked thorough while not doing
  it. Its nine CSV variants stamped rows `M-D-YYYY HH:MM`, dash-separated. That is neither ISO nor one
  of the Clock Contract §2.4 vendor formats (all slash-separated), so `_ckParse` returned null for
  every row, every row hit `if (!isFinite(ms)) continue`, and all nine threw the identical
  `Parsed only 0 valid readings`. Fourteen inputs collapsed to **four** distinct answers and five of
  eight controls read as equivalent. Because `parseCSV` throws unless ten rows parse, *every* mutant
  downstream of that floor — the mmol/L auto-detect, the newest-first sort, the quote strip, the
  European decimal comma — was unreachable at once. Corrected: 28 inputs, **17** distinct answers, and
  all five families now separate every control (12/12 · 12/12 · 12/12 · 10/10 · 8/8).
- `parseCSV`'s **file-level DMY lock** then needed a second attempt, and the first was wrong in an
  instructive way. A 300-row file starting on the **13th** reads like a lock test and is not one: at
  5-minute cadence it spans 25 h, so every row is dated the 13th or 14th, every row resolves itself,
  and the lock never becomes load-bearing. The shape that observes it is a file of **ambiguous** days
  carrying **one** proving row — the proof has to travel from that row to the others. Confirmed by
  applying the real mutant rather than reasoning about it: all-proving rows give byte-identical output,
  while ambiguous-plus-one gives `2026-07-05` against the mutant's `2026-05-07`. **A two-month error in
  every meal-to-glucose alignment**, and the first test could not see it.

So: when a control stays blind, **"widen the battery" is the wrong instinct.** Five times now the cause
was a missing SHAPE — and twice the missing shape was not an exotic edge case but the ORDINARY one,
absent because the input never satisfied a precondition the function imposes before doing anything at
all. More of the shapes already present would not have found any of the five.

**The diagnostic is printed on every run and should be read first:** `battery N inputs, M distinct
answers`. When M is a small fraction of N the battery is not too narrow — it is being rejected at a
guard, and no amount of extra input variety helps until that guard is satisfied.

**`cvhrFromNN` is reachable but expensive**, and is the one item worth planning rather than picking
up. Its output is already exported (`cvhrIndex` / `cvhrEvents` on the analyze result), so no export
change is needed — but it is called once from deep inside `analyze()`, so a test must build a
synthetic PPG that survives beat detection, SQI and correction while still carrying a controlled
apnea-band oscillation in its NN series. `getFilteredRows` is the one this method cannot fix at all:
it reads `document`, so its behaviour is a function of the DOM rather than of its argument, and its 11
survivors stay unclassified unless it is refactored.
| | | **163** | all now probeable |

So the unit of work is not always "write a battery". For a zero-kill function it is **"write a test,
THEN a battery"**, and the test is owed on its own merits: `compareIntervalSeries` is the two-signal
agreement path — whether a Verity and an H10 are measuring the same heart.

**(b) The classification DECAYS, because its key contains a line number.** `(line, op, before)` mixes
a description of the code with a description of where it sat, so any edit *above* a recorded mutant
orphans it. Measured: #1127 touched `pulsedex-dsp.js` within HOURS of 19 entries landing and orphaned
**ten of them** — every one with an identical `(op, before)` still in the file at a new line. An
orphaned entry is indistinguishable from an unprobed one, so the ledger shrinks silently.

`tools/reanchor-equivalence.mjs` repairs exactly the unambiguous case — one generated mutant with the
same `(op, before)` — and refuses ambiguous or vanished ones rather than guessing, because a wrong
re-anchor would excuse a mutant nobody probed. **Re-anchoring is not re-verification**: it moves an
address, never renews a claim. Run it after any DSP edit; the same decay bit twice in one session.

⚠️ It also found that **`clock.js`'s three entries — the oldest in the ledger, on the file the whole
mechanism was built for — are genuinely stale** (all three lines now hold different code). They are
`real-gap` records so nothing is falsely excused, but they had rotted unnoticed.

### 7.1 · Feed the mechanism — a **committed, general** prober *(first; in progress)*

The ~83 measured-but-unrecorded classifications of §2, produced by a prober that lives in the repo so
the verdicts can be re-checked rather than believed. Generalise
`tools/probe-clock-equivalence.mjs` — it already carries the one design rule that matters:

> **A positive control must live in the SAME FUNCTION as the mutant it clears.** A battery that never
> reaches the code reports "equivalent" about *itself*. Its first run came back **3-of-14 BLIND**
> (`_ckDMY` called with one argument; `L94`'s `b > 12` needing `b` exactly 12) and the sweep before it
> had reported those survivors as equivalent on a battery whose only control sat in another function.

Order — **revised by §2a**, because the cheapest survivor set is the one already measured:
~~**`hrvdex-dsp.js` first**~~ **DONE 2026-08-09 (§2c)** — 6 families, 217 of 298 survivors probed,
84/84 controls separated, **69 entries emitted**; `tools/probe-batteries/hrvdex-dsp.mjs` →
`ppgdex-dsp.js` (**41 entries landed #1111**; `lombScargle` + `parsePPG` + `ppgLoadOwnExport` — the
remaining functions are open) → `motiondex-dsp.js` (287, but its sweep is uncontrolled — re-run for a
canary first) → `clock.js` (20, both prose sets) → `capture.run_polar` (15, Python side).

**The ~83 of §2 now stands at 110 recorded** (`clock.js` 3 + `ppgdex-dsp.js` 41 + `hrvdex-dsp.js` 69),
every one of them **re-derived by running a committed battery**, none transcribed from prose.

### 7.2 · Re-measure what is quoted from arithmetic — **hrvdex DONE, ppgdex open**

ppgdex's ≈36.5 % is three commit messages added together and is still not a measurement.

`hrvdex-dsp.js` **is now measured TWICE: 191/489 = 39.1 %, canary PASSED** (§2a, and re-run from
scratch in §2c against a materially changed `tests/dex-tests.js` — same counts, and the same 298
survivors by key). It confirms #1030's figure rather than correcting it — worth stating plainly,
because the reason for re-measuring was that two sweeps' worth of tooling fixes had landed since, and
the honest outcome of that check is "the number held". `motiondex-dsp.js` is measured at 37.3 % but
**uncontrolled**, so it is not yet quotable.

### 7.3 · Canary-guard the seven unguarded DSPs — **six now**

`clock.js` and `hrvdex-dsp.js` have canaries. `motiondex-dsp.js` has a full sweep with `canary: NONE`,
which is precisely the "unguarded" state §3's table warns about — its 37.3 % is a hypothesis, not a
result. Each sweep *learns* a canary for the next, so this remains a by-product of 7.2.

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
neither prober's `--selftest` is wired into `npm run check` (`mutate.mjs`'s is not either, so this is
consistent rather than an oversight — but an unrun selftest is this repo's signature failure).

**✅ THE CORPUS QUESTION IS ANSWERED — it was a PATH, and the path has a space in it.**
`CAPTURE-HOST-MUTATION-FLEET` §7 recorded *"`/EcgNightly` is not present locally (an unmounted `data`
volume, `sdb1`, is the likely home) and does not exist on vigil"*, and made resolving it a
precondition for the `oxyii.parse_live` and `polar_pmd.decode_frame` passes. It is present, and has
been all along:

```
/run/media/michal/647A504F7A50205A/Ecg nightly     19 GB · 777 entries
   71 × *.dat                         O2Ring raw            → oxyii.parse_live
   50 × Polar_H10_*_ECG.txt           chest ECG
   54 × Polar_VeritySense_*_PPG.txt   3-LED arm PPG         → polar_pmd.decode_frame
   58 × O2Ring S 2100_*.csv           1 Hz SpO2/HR/PI summaries
```

**`Ecg nightly`, with a space** — not `EcgNightly`. That is almost certainly the whole of the earlier
negative: a path check for the concatenated name misses it, and an unmounted-volume theory is a very
plausible thing to write next. It is the §8 family again — *the check ran and reported about something
it never examined* — and the cheapest guard is to `ls` the parent before theorising about the child.
(Also present: `/home/michal/tepna-smoketest/captures`, 18 GB, the **box**-captured tree. The two are
NOT interchangeable — the `Ecg nightly` tree is phone-captured and has no independent second clock,
CLAUDE.md §7 — which matters for anything timing-related, though not for frame decoding.)

So the blocker on those two passes is lifted. The hermetic-suite constraint (`SUBPROCESS-SURFACE` §6)
still stands: real frames inform **which decode paths actually occur**, they do not enter the suite.

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
| read a child's output through a **file, not a pipe** | the mutant enumeration truncated at ~146 KB mid-token; ppgdex's is ~1.5 MB. It threw here — luck. A silent truncation probes a PREFIX and reports the rest as nothing to do | #1107 |
| a family range must **strip comments and regex literals** before counting braces | `lombScargle` measured 588 lines past its end; an over-wide family manufactures blindness, an over-narrow one manufactures a clean bill | #1107 |
| **`ls` the parent before theorising about the child** | a path check for `EcgNightly` missed `Ecg nightly`, and an unmounted-volume theory got written down instead | §7.7 |
| **search the DISK, not just the repo** | two full DSP sweeps and 19 modules' survivor lists were sitting gitignored and un-triaged | §2a |
| **never re-apply a mutant from a DISPLAY field** — record the executable line, or refuse | `before`/`after` are 100-char terminal strings; rebuilding the line from them cut every source line past 100 chars mid-expression, and 42 of 217 survivors reported "the mutant does not parse" about the reader | §2b |
| two tools that are meant to feed each other are **compatible only once one has read the other's real output** | the same record, `JSON.stringify(rec, null, 2)` on one side and NDJSON on the other; 298 survivors unreachable behind a newline, and the brief had already asserted they were compatible | §2b |
| a column that is **constant across the battery** hides every guard that reads its SPREAD | `_sdnn` held at 62 made `stdSDNN7` 0 or NaN everywhere, so `x > 0 && std > 0` and its `||` mutant both produced NaN — a killed control reading as equivalent | §2c |
| **all-or-none in the DATA is not all-or-none in the GATE** — move each input on its own | the six Welltory subjective scores always move together, so varying them as a group never separates `r._sns > 0 && r._stress > 0 && …` from its `>=` mutant. `null >= 0` is true; one absent column is the whole test | §2c |
| derive a fixture's dependent fields **after** the overrides, not before | `_date` was built from the default `_tMs` and an override moved `_tMs` underneath it, so every clock-hour band in `circAdj` was unreachable | §2c |
| raising the control count is a **measurement**, not a formality | at 8/16/24 controls this battery reported different blind mutants each time; only at 40/40 did it stop finding new ones. A family that separates 8 controls has not been shown to separate 40 | §2c |

The family has one shape, and it is CLAUDE.md §👥.4b's: **the check ran, and reported success about
something it never examined.**

## 9 · Done when

- [x] The four briefs are folded here and marked DONE, with `Folded-into:` headers and synced
      `DOCS-INDEX.md` rows.
- [x] §1's denominator is ratified and both gates carry the mechanism.
- [x] §7.1's **instrument** — `tools/probe-equivalence.mjs` + `tools/probe-batteries/` (#1107), with
      same-function controls, a degenerate-baseline refusal, and 20 known-answer selftests.
- [ ] **§7.1's PAYLOAD — `tools/mutate-equivalence.json` carries every classification this programme
      has measured**, with its battery recorded per entry. **110 of ~83+ recorded so far**
      (`clock.js` 3 · `ppgdex-dsp.js` 41 · `hrvdex-dsp.js` 69), all re-derived by running a committed
      battery. Open: `motiondex-dsp.js` · `capture.run_polar` · the un-familied functions in
      hrvdex (81 survivors) and ppgdex.
- [x] **`hrvdex-dsp.js` — DONE 2026-08-09 (§2c).** 6 families, 217/298 survivors probed, 84/84
      controls separated, 69 emitted, 148 left in the denominator as debt. `killed / distinguishable`
      is quotable for this file for the first time.
- [x] §7.2/§7.3 for **hrvdex** — 191/489 = 39.1 %, canary PASSED, measured not added up (§2a), then
      **re-measured from scratch to the same 298 survivors by key** (§2c).
- [ ] §7.2/§7.3 for **ppgdex** (still arithmetic) and **motiondex** (measured but uncontrolled).
- [ ] §7.7 — the two corpus-informed passes (`oxyii.parse_live`, `polar_pmd.decode_frame`) are
      unblocked now the corpus is located; the hermetic-suite constraint still stands.
- [ ] §7.4 — the 13 loop-condition timeouts recorded as real or artefact. **Nothing is written for
      them first.**
- [ ] §7.5 — both decisions taken in writing.
- [ ] §7.6 — the scoped-vs-full penalty sampled on `cpapdex-dsp.js`, with the sample stated.
- [ ] §6's rules are in `MUTATION-AUDIT-RUNBOOK` beside the ceiling rule, so the next pass does not
      re-derive them.

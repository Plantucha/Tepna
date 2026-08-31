<!--
  CPAP-AUTOHARVEST-FOLLOWUPS-II-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-19 (§1(a) delivery OBSERVED: `send() = True`, `delivered: 1, failed: 0, last_error: None` through the daemon's own `Notifier` under the daemon venv — the last unproven link. Box re-measured **0 behind** at close. No follow-up brief: nothing surfaced during execution beyond what §4 already parks) · **Created:** 2026-08-03 · **Follows:** `CPAP-AUTOHARVEST-FOLLOWUPS-2026-07-28-BRIEF.md` (DONE — 2026-08-03)

# What the guarantee sweep left behind — two owner-owed deploy items, one probe, and a method worth reusing

The parent is DONE: §1.2's directive was executed (124 guarantee-bearing docstrings swept, the two real
gaps gated and verified RED), §2.1 routed, §2.2 injected and fixed, §4 and §5.1 closed. This is the
residue — none of it blocks what shipped, and two of the four items are not code at all.

---

## 1 · The alert transport — MEASURED IN THE FIELD 2026-08-04: both stated causes are GONE, one link unproven

**Status change, from the box itself rather than from the repo.** §1 named two independent reasons no
failure could page anyone. Checked directly over ssh, and neither still holds:

| §1's cause | state on 2026-08-04 |
|---|---|
| no `alerts:` block ⇒ `Notifier(None, enabled=False)` | **resolved** — `alerts:` present, `enabled: true`, real `webhook_url` |
| the fix is committed, not shipped | **still true** — see below |

Three things had to be true for an alert to leave the box, and two are now verified:

- **The config is read by the RUNNING process, not just present on disk.** This is a distinct question
  from "is the file right", and the same *committed-not-shipped* shape one level down: a daemon started
  before the edit holds the old, disabled `Notifier` in memory while the file reads correctly. Config
  mtime `2026-08-03 21:26`, `tepna-capture` ActiveEnterTimestamp `2026-08-04 08:30` — the daemon started
  **after** the edit. Confirmed by constructing the notifier exactly as `capture.py:3677` does against
  the deployed config: **`notifier.enabled = True`**.
- **The transport dependency is present.** `aiohttp 3.14.3` in the daemon's own venv
  (`/opt/tepna/capture-host/.venv`, python3.14).
- **The decision half fires on a failure state.** The shipped predicates, run against synthetic state:
  `offline_alert_due(down 600 s, threshold 300) = True`, `(down 60 s) = False`,
  `device_is_recording(connected, stale 900 s) = False`. A ten-minute outage raises; a one-minute blip
  does not.

**What is still unproven is the POST itself** — no alert has yet been observed to arrive. The harness is
written and sits at `/tmp/alerttest.py` on the box; it needs one execution under the daemon's venv
interpreter. Until that runs, §1's Done-when is NOT met, and this section deliberately does not claim it.

**A methodological warning worth more than the result.** The first run of that harness returned
`send() = False` with `ModuleNotFoundError: aiohttp` — and that was the HARNESS, not the box: it used
the system `python3`, which has no aiohttp, while the daemon runs `.venv/bin/python`. Filed as-is it
would have been a false defect against a working transport, and the same trap has already cost this
family a silently-incomplete pytest collection. **On this box, use the daemon's own interpreter or
measure nothing.**

**§1.2 stands and is now quantified: the box is 111 commits behind `origin/main`,** and the
raising-harvest alert fix is confirmed absent from the deployed `capture.py` (grep finds no such alert).
*(⚠️ **Both halves of this sentence are now false — see the 2026-08-15 re-measurement in §1-original.**
The box is **3** commits behind with a clean tree, and the `capture.py` grep was against the wrong
module: the fix lives in the CPAP poller path. Kept as written because the reasoning below depends on it.)*
So even with the transport live, that particular alert still cannot fire in the field. Deploying is the
two-step (`git pull` **and** `sync-apps.sh`) and is an owner-timed action: pushing 111 commits to a live
capture box can interrupt an active recording, so it wants a quiet window, not an autopilot moment.

**A design note that survives the outcome.** `alerts.py`'s `send()` swallows the exception — a webhook
must never crash capture — but logs `alert %r not delivered: %r` at WARNING, with a comment recording
that an earlier audit fixed exactly the silent-swallow this brief family cares about. The alert is lost
either way; the *record* of losing it is not. That is the right shape and needs no change.

### 1-original · The alert transport is still OFF on the box (owner)

Carried verbatim from the parent §2.2, because it is the one item where the repo is green and the
**field is not**. Two independent reasons no failure can page anyone today:

1. The deployed `/opt/tepna/capture-host/config.yaml` has **no `alerts:` block**, so
   `Notifier(None, enabled=False)` is constructed and `send()` returns `False` without posting.
   `if notifier:` is still truthy — the object exists — so every call site runs and silently no-ops.
2. The raising-harvest alert fix is **committed, not shipped**. The box still runs the old `capture.py`.

**Owner actions, in order:** configure `alerts:` (`enabled` + `webhook_url` — the endpoint is a
decision and the URL is a secret no session holds), then deploy. Deploying is a deliberate **two-step**:
`git pull` **and** `sync-apps.sh` — the first alone is half a deploy.

> ### ✅ BOTH REASONS ARE NOW FALSE — re-measured on the box 2026-08-15
>
> **1 · The `alerts:` block exists and is enabled.** `config.yaml:115` carries `enabled: true` +
> `webhook_url` (value not read — it is a secret), `offline_sec: 300`, `poll_sec: 60`. So `Notifier` is
> no longer constructed disabled and `send()` is no longer a guaranteed `False`. The owner action asked
> for above has been taken.
>
> **2 · "Committed, not shipped" is dead, and so is "111 commits behind."** The box is at
> `27c16eb0`, which **is an ancestor of `origin/main`**, only **3** commits behind (all docs-only), with
> `git status --short` **empty**. A clean tree at a current-main commit means every committed
> `capture-host/` fix is deployed *by construction* — no per-file hunt needed. Spot-confirmed anyway:
> deployed `cpap_harvest.py` is **byte-identical** to `origin/main`'s.
>
> The hourly `tepna-update.timer` is what closed this; the "deliberate two-step, owner-timed" framing
> above applies to files **installed** into `/etc` or `/usr/local/lib`, not to code run from the
> `/opt/tepna` checkout. See `CAPTURE-HOST-FOLLOWUPS-II` §V5 for that two-class rule.
>
> ⚠️ **The original evidence for reason 2 was invalid, and that is the more useful correction.** It read
> *"confirmed absent from the deployed `capture.py` (grep finds no such alert)"* — but the fix is in the
> **CPAP poller path**, not `capture.py`; the governing test is
> `tests/test_cpap_poller.py::test_a_RAISING_harvest_alerts_not_just_barren`. Grepping `capture.py`
> returns zero on a *current* checkout too, so the finding would have reproduced identically against
> fully-deployed code. **An absence found in the wrong file is not evidence of absence** — the same
> shape as this brief's own `ModuleNotFoundError: aiohttp` warning above, where the harness rather than
> the box was at fault.
>
> **What is still genuinely owed is unchanged:** the *Done when* below. A configured webhook is not a
> delivered one, and nothing here demonstrates an induced failure actually paging anyone. Re-use the
> TEST-NET-1 injection; do not read "enabled: true" as "the transport works."

**Done when:** a deliberately induced failure on the box delivers a real webhook. The parent's TEST-NET-1
injection (`192.0.2.1`, zero blast radius, no config touched, destination verified empty afterwards) is
the harness to re-use — it is the only fault injection in this family that has ever found something.

## 2 · `probe_pmd_surface._read_char` is the one guarantee left unchecked

The third function whose guarantee no test names. Deliberately skipped rather than missed:

- it is a one-shot BLE developer probe, not daemon code, and reaching it needs real hardware;
- it sits inside the scope of an in-flight worktree (`POLAR-PMD-COMMAND-SURFACE-2026-08-02`).

Its promise — *"a missing characteristic must not abort a sweep that has 40 other things to collect"* —
is exactly the fail-open shape worth gating, and it is cheap to gate with a fake client (no hardware:
`read_gatt_char` raising, and returning undecodable bytes). **Whoever lands the PMD work should take it**;
splitting it out now would collide for no gain.

## 3 · The sweep method, and the check that must NOT be reused

Worth keeping because the first answer was wrong in a way that would recur.

**Reusable:** enumerating guarantees by AST over docstrings matching *never · always · must · cannot ·
guarantees · refuses · is an ALERT · not a silent · invariant*. Cheap, complete, and it turns "grep the
daemon" from a vague instruction into 124 named sites.

**Not reusable:** cross-referencing those names against the test tree. It reported the daemon
**121/124 clean** and was blind to both real gaps, because *named in a test* and *gated by a test* are
different properties — and in the opposite direction it would have condemned five guarantees that are
gated perfectly well transitively, through `_mirror_matches` / `summarize` / `timeline.build`. Only
deleting the promise and re-running answers the question.

**ANSWERED 2026-08-31 — see the census below. The tool existed; its cross-reference was silently
reporting zero.** ~~**Open:**~~ the sweep covered `capture-host/*.py`. The same enumeration has never been run over the
**JS spine** (`clock.js`, `*-dsp.js`, `integrator-dsp.js`), where the docstring-as-guarantee habit is at
least as strong and where `tools/mutate.mjs` already exists to do the killing. `clock.js` is at 73 %
(`CLOCK-AXIS-AND-RENDER-SURFACE-FOLLOWUPS`), so the surviving mutants there are already enumerated —
the new question is which of them sit under a *documented promise*, which is a sharper prioritiser than
raw survival count.

### ✅ ANSWERED — the guarantee census over the JS spine (2026-08-31)

`tools/guarantees.mjs` already implements exactly this (`--spine`, and `--survivors` to cross-reference
against a sweep). The census half had been run — its own commit reports **560 sites across the JS
spine**. The cross-reference half had never produced a non-zero answer, and the reason was a defect
rather than a clean bill of health:

> `loadSurvivors` parsed **NDJSON only** — split on newlines, `JSON.parse` each, `catch { continue }`.
> Handed a pretty-printed `.sweep.json`, which is what `tools/mutation-crawl.mjs` actually writes,
> **every line throws, every throw is swallowed, and the map comes back empty.** The caller then does
> `survivors.get(f) || []`, finds nothing, and prints **"0 with a SURVIVING mutant"** — a total parse
> failure rendered as a clean all-clear, by the tool whose whole job is finding promises nothing checks.

Fixed (whole-file JSON first, NDJSON fallback) **and made to refuse**: an empty survivor map now exits
2 rather than reporting zero, because a caller cannot distinguish *"no survivors"* from *"nothing
loaded"* and only one of those is a result.

**The answer, over the 8 DSPs whose sweeps carry a `PASSED` canary** (verified-fresh; `clock.js` and
one other are `STALE`, and 20 files have `canary: NONE`, which is *unverified*, not *fresh*):

| file | guarantee sites | carrying a survivor | |
|---|---|---|---|
| `ppgdex-dsp.js` | 125 | **102** | 82 % |
| `oxydex-dsp.js` | 127 | **96** | 76 % |
| `ecgdex-dsp.js` | 116 | **90** | 78 % |
| `hrvdex-dsp.js` | 40 | **33** | 83 % |
| `cpapdex-dsp.js` | 38 | **34** | 89 % |
| `glucodex-dsp.js` | 36 | **31** | 86 % |
| `pulsedex-dsp.js` | 33 | **25** | 76 % |
| `motiondex-dsp.js` | 25 | **21** | 84 % |
| **total** | **540** | **432** | **80 %** |

**Every one of those files reported 0 before the fix.**

The shape of what it finds, from `cpapdex-dsp.js` — guard lines whose own trailing comment states the
promise, each carrying an unkilled mutant on the guard itself:

    2040  if (!(days >= 0) || days > 24836) continue;  // out-of-range Date ⇒ drop (never fabricate…)
    2102  if (sec == null || !isFinite(sec)) continue; // UNKNOWN ⇒ no corrected view, never a raw…
    2143  if (t == null || !isFinite(t)) continue;     // unjoinable — never guessed into a night

⚠️ **80 % is a prioritiser, not a defect count.** A guarantee site "carrying a survivor" means the suite
cannot see that line change; it does not mean the promise is false. The value is ordering — it separates
*untested line* from *untested line we have told the reader is guaranteed* — and that ordering is only
now available at all.

⚠️ **`clock.js` — the file the item names first — could not be included: its sweep's canary is `STALE`.**
Re-sweeping it is the prerequisite for extending this census to the rest of the named spine, and
`integrator-dsp.js` is `canary: NONE` rather than verified.

## 4 · Backfill throughput is still measured once, on one card

Unchanged from the parent §2.3 and still not worth doing on its own: `130 KB/s` and `1.65 MB/s` are the
same card on different days by different methods. Neither is wrong; they are not comparable. Re-measure
if backfill time ever matters again rather than trusting either — and note the brief quoting 65 min for
a full backfill is using the slower one.

---

## 5 · Done when

- [x] §1 — **ALL THREE LINKS PROVEN, 2026-08-19.** (a) is now observed: the reboot had wiped
      `/tmp/alerttest.py`, so it was recreated to the same spec — the daemon's own `alerts.Notifier`,
      the live `config.yaml`, the daemon venv interpreter — and one real delivery went through:
      `send() = True`, `stats = {delivered: 1, failed: 0, suppressed: 0, last_error: None}`, title
      `Tepna alert-path test` on the configured ntfy channel. *A configured webhook is now a DELIVERED
      one.* (b) was already closed 2026-08-15; re-measured at close: the box is **0 commits behind**.
      (The 111 → 3 → 0 progression is why this box re-measures rather than trusts any prior count.)
      - **(b) IS DONE — re-measured 2026-08-15.** The box is 3 commits behind with a clean tree at an
        ancestor of `origin/main`, so `capture-host/` is deployed by construction (deployed
        `cpap_harvest.py` byte-matches `origin/main`); the hourly `tepna-update.timer` closed it without
        an operator. The `capture.py` grep was against the wrong module — the fix is in the CPAP poller
        path (`test_cpap_poller.py::test_a_RAISING_harvest_alerts_not_just_barren`). **(a) remains
        outstanding**, and it is the whole of what is left: `alerts:` is now `enabled: true` with a
        `webhook_url`, but a configured webhook is not a delivered one.
- [x] **§2 — DONE 2026-08-04.** `capture-host/tests/test_probe_read_char.py`, 13 assertions, no hardware
      (the whole surface is one awaitable, so a fake client covers every branch). The routing in §2 —
      *"whoever lands the PMD work should take it"* — had **passed without anyone taking it**:
      `POLAR-PMD-COMMAND-SURFACE-2026-08-02` is now `REFERENCE (living)`, so the collision the note was
      avoiding no longer existed. Mutation-verified rather than asserted: narrowing `except Exception`
      to `except TimeoutError` (the exact rot a fail-open shape invites) kills **6** assertions, and
      deleting the `UnicodeDecodeError → hex` fallback kills 1. Two assertions cover `read_identity`
      rather than `_read_char` alone, because the promise is about the *sweep* surviving — one checks
      the later reads are still **attempted**, since a version that returned placeholders without
      trying would satisfy a shape-only test while collecting nothing.
- [x] **§3 — the guarantee sweep is run over the JS spine, and the reusable half is now a TOOL**
      (2026-08-03). `tools/guarantees.mjs`; census below. The non-reusable half — cross-referencing
      names against the test tree — is deliberately not built, for the reason §3 gives.
      survivors that sit under a documented promise
- [ ] §4 — nothing, unless backfill time matters again


---

## 3-RESULT — the census, and the half that is now a tool (2026-08-03)

**`tools/guarantees.mjs`** enumerates guarantee-bearing comments — *never · always · must · cannot ·
guarantees · refuses · invariant · is an ALERT · not a silent*, the same vocabulary the Python sweep
used, so the two censuses are comparable. Over the JS spine:

| file | sites | | file | sites |
|---|---|---|---|---|
| `integrator-dsp.js` | 134 | | `pulsedex-dsp.js` | 27 |
| `ppgdex-dsp.js` | 89 | | `cpapdex-dsp.js` | 27 |
| `oxydex-dsp.js` | 82 | | `motiondex-dsp.js` | 22 |
| `ecgdex-dsp.js` | 78 | | `clock.js` | 21 |
| `hrvdex-dsp.js` | 36 | | `metric-registry.js` | 6 |
| `glucodex-dsp.js` | 33 | | `dex-export.js` | 5 |

**560 guarantee sites across 12 files** — against 124 in the daemon. The docstring-as-guarantee habit
is not merely "at least as strong" on the JS side, as §3 supposed; it is 4.5× larger.

### The cross-reference, done the way §3 says and not the way that failed

§3 is explicit that matching guarantee names against the test tree is **not** reusable: it reported the
daemon 121/124 clean while blind to both real gaps, because *named in a test* and *gated by a test* are
different properties, and it would have condemned five guarantees gated perfectly well transitively.
This tool therefore never greps the tests. It cross-references against **surviving mutants**, which
answers the question directly — a survivor is a line the suite cannot see change, so a survivor under a
documented promise is a promise nothing checks.

Demonstrated end-to-end on `pat-align.js` (14 mutants, 4 killed, 10 survivors):

```
pat-align.js — 3 guarantee site(s), 3 with a SURVIVING mutant
  L33   ⚠ 39 num → 0     "a movement must exceed mean + 4σ to be an anchor"
  L43   ⚠ 63 cmp > → >=  "Deviation, not raw magnitude, because gravity dominates |acc|…"
  L227  ⚠ 259 cmp < → <= "A night cannot have 8 ms of beat-to-beat scatter and 1058 ms of wander"
```

The 4σ anchor threshold can be set to **zero** and nothing notices — which is exactly the class §3
wanted prioritised, and is invisible to a raw survival count.

### A defect this surfaced in the tooling, and the fix

`guarantees.mjs` needs the same regex-aware lexer `mutate.mjs` uses (one wants the code, the other its
inverse). Importing it **started a mutation sweep** — `mutate.mjs` runs at import, so borrowing one
function from it launches a 40-minute run. The lexer is therefore extracted into **`tools/js-lex.mjs`**,
a pure module with no side effects, and both tools import it. One lexer, N callers: a duplicate would be
free to drift back into the regex-desync defect that cost `CLOCK-MUTATION-AUDIT` §4 a contaminated run.

### The clock.js cross-reference — run 2026-08-03, and it found a promise that is FALSE

The exhaustive sweep (127 mutants, 65 min at 16 jobs) reproduced **93 killed = 73 %** exactly, matching
the morning's run on an unchanged file. Against the 21 guarantee sites:

**15 of 21 documented promises in `clock.js` carry a surviving mutant.** The Clock Contract's own
sentences are among them — *"explicit vendor regexes (never locale Date.parse)"* (5 survivors), the §3
file-level lock *"Never switch order mid-file"* (3), §2.6's component-range *"a bad stamp is visible,
never fabricated"* (4), `resolveDMY`'s *"refuse rather than guess"* (3), *"never fabricate
Jan-1-2000"* (2), and the axis *"PLAUSIBILITY BOUND — refuse, never 'correct'"* (2).

**And the sharpest result is not an ungated promise but a WRONG one.** The site with the most survivors
(6) was `clock.js:299`:

> *"Divergence is measured RELATIVE to the first anchor … so the correction must be 0 at the start and
> grow."*

It is not 0 at the start. `CLOCK-AXIS-AND-RENDER-SURFACE-FOLLOWUPS` §1 measured that the running
median's clamped window pulls each end inward by exactly ⌊win/2⌋/2 = 5 anchors' drift, which is why
`ppm` under-reads by 1 − 5/(n−1); `CLAUDE.md` §7 states it correctly. The code comment was never
updated, so the spine carried a promise that contradicted its own Contract — **ungated and false at the
same time, which is precisely the pair the census was built to separate.** Corrected in place.

That correction cost a **fleet re-bundle**: `clock.js` is inlined into every bundle, so a comment moves
8 `manifestHash`es. Taken deliberately in a window with zero open PRs (`CLAUDE.md` §👥.3), with all
three build systems rebuilt, `computeHash` moved, and **8 fixtures re-verified by re-running them**
against the real corpus (`verify-fixtures.mjs`) rather than asserted export-inert.

**A tool nuance worth recording:** adjacent one-line comments in the same region each get attributed the
same nearby survivors (`NEAR = 25`), so L106/L107/L109 above report an identical set. The site count is
therefore an upper bound on distinct regions; the survivor lines are exact. Read the mutants, not the
site tally.

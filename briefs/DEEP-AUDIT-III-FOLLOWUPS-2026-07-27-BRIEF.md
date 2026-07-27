<!--
  DEEP-AUDIT-III-FOLLOWUPS-2026-07-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-27 · **Follows:** `DEEP-AUDIT-III-2026-07-26-BRIEF.md` · **Method-parent:** `AUDIT-PROMPT.md` · **Sibling:** `CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-2026-07-26-BRIEF.md`

# Deep audit III — residue, and what executing it taught

> **Why this exists.** `DEEP-AUDIT-III` filed 28 confirmed findings; **24 landed** across 16 merged PRs
> (#449–#464), taking the node lane from 3903 to **4056 assertions**. Five items remain, and executing the
> other 24 surfaced a set of process facts that are worth more than any single fix — including **six
> occasions where the audit's own fix sketch was wrong** and only execution revealed it.
>
> **Parent status stays PROPOSED**, deliberately: a punch-list is DONE when it is closed, not when most of
> it is.

---

## 1 · Open work

### 1.1 GlucoDex declares no duration key and no `timeseries` — the sibling of the coverage fix — **FIXED 2026-07-27**

`§6.2` landed the `recording.coverage` contract on HRVDex; GlucoDex has the identical defect
(`glucodex-dsp.js:1946`) and was deliberately left out because it needs a second, independent change:
`glucoBuildNodeExport` also omits the `timeseries{cadenceMin,t0Ms,cells[]}` block that
`glucodex-app.js:1830` already builds. That omission is what starves the Integrator's windowed
autonomic-glycemic path and forces the `directional` fallback (`§3.6`), so the two land together or not
at all.

**FIXED 2026-07-27.** Both halves landed together, as this section required. `coverage` is
`kind: 'continuous'` — a CGM wear *is* continuous, so one segment states it honestly and `spanSec`
equals `recordedSec` **by measurement**, which is precisely what the sparse HRVDex case could not claim.
`timeseries.cells` is emitted from the canonical `compute()` path, so `hasCells` is finally true and the
Integrator can window a wear instead of stamping one whole-wear CV on every night.

**The cell builder is single-sourced** as `GLUDSP.glucoCells`. `glucodex-app.js` already had its own copy;
shipping a second one in the DSP would have been the sibling-divergence class this audit exists to fix, so
the app now calls the shared helper.

**One assertion was deliberately INVERTED** — `'degrades on the absent cell series — empty cells trace'`
*pinned the defect*. Per `CLAUDE.md`, changing it **is** part of the fix and is called out rather than
quietly flipped. The real committed export now adapts to **8167 cells over 681 h** instead of a point.

**Gate:** 4070 assertions green with `DEX_UPLOADS` (0 skipped) · GATE A 9/9 (`GlucoDex` `345d8a6aa42e` →
`5bf582e0abaf`) · **3 GlucoDex fixtures regenerated** through `tools/regen-glucodex-goldens.mjs`.

### 1.2 The surge-side twin of the desat double-count — **found by mutation-checking the fix for §3.1** — **FIXED 2026-07-27**

`gather()` applies the same `impulse@round(tMs/1000)` key to the **surge** pool. Two cardiac observers
(H10 + Verity) therefore double `total.surge`, and with it `lambda` / `surgeRatePerHr` — pushing the
Poisson null toward `belowChance` and **suppressing real findings**. This is strictly worse in direction
than the desat side: that one inflated a count, this one *hides* events.

The desat fix (`pickDesatObserver`) is the template, but the ladder differs: ECGDex and PpgDex observe the
same physiological surge by different means, and `HR_AUTHORITY` (`ECGDex 1 · PulseDex/OxyDex 2 · PpgDex 3`)
already exists for exactly this judgement.

### 1.3 `ansBalance()` fabricates a denominator — **needs a decision, not a patch**

`pulsedex-dsp.js:138` carries `lf / (hf || 1)`, the same fabrication `§5.2` removed from the surfaced
`lfhf` field. It was deliberately **not** changed because it feeds the logistic-squashed SNS/PSNS balance
score, so the real question is *what that KPI reads when HF is zero* — `null` (honest, but the score
disappears), or a documented floor (survives, but is a heuristic wearing a number's clothes). The `§5.2`
gate is scoped to the `lfhf` assignment so it cannot be misread as covering the score.

### 1.4 OxyDex's `_durBad` catches a negative span but not an inflated one — **FIXED 2026-07-27**

`oxydex-dsp.js:2500` is `_durBad = !(rawDurMs >= 0)`. `§1.2`'s roll fix removes the *cause* of the 1560-min
night, but the *guard* is still one-sided: a span inflated by a whole multiple of 24 h still passes as a
real number. Flag when `rawDurMs` exceeds the span implied by row count × cadence.

> **§1.2 · §1.4 · §F2 LANDED 2026-07-27.** The surge fix is deliberately NOT the desat fix: R2 makes
> either cardiac node a first-class corroborator, so **matching keeps the whole pool** and only the
> **rate** is taken from one observer (a body has one autonomic surge rate however many devices watch it),
> chosen by the existing `HR_AUTHORITY` ladder and named in `nullModel.surgeRateObserver`. Mutation-checked:
> pre-fix the rate goes **5 → 10 /hr** and expected-by-chance **4.17 → 8.33** purely by adding a device.
> §F2 (`_o2DateAnchorMs`, the defect that surfaced from a REFUTATION and never reached a punch-list) now
> round-trips its components like `clock.js:_ckMk` and anchors its capture: `20261332999999` → **null**,
> not 2027-02-01. §1.4's guard is bounded by row count × observed cadence, with `durationInflated`
> separating an inflated span from a non-monotonic one. **Gate:** 4069 assertions green with
> `DEX_UPLOADS` (0 skipped) · GATE A 9/9 (`OxyDex` `e6090be9408c` → `ffc146274682`, `Integrator`
> `aa804cf9283a` → `f3d273a34cc4`).
>
> **§1.5 note discovered while scoping it:** the TCH golden's inputs are built by `_tchGoldenInputs()`
> **inside a test-group closure** in `tests/dex-tests.js`. Copying that builder into a regen tool would
> create a second source that can drift from the gate's — the exact sibling-divergence class this audit
> exists to fix. The tool must therefore be preceded by **extracting the builder to a shared module both
> the gate and the tool import**. That is a structural change and is why §1.5 is still open.

### 1.5 The Integrator has no regen tool — the one empty cell in the coverage matrix — **FIXED 2026-07-27**

`§6.6`. `tools/regen-goldens.mjs`'s `NODES` map covers all 8 nodes but not the Integrator, whose fragment
carries a code-gated fixture with a real `verifiedUnder` stamp and a live equiv leg. If a TCH-fusion change
legitimately moves that output there is **no sanctioned way to re-record it** — and `CLAUDE.md` §🔏 forbids
hand-editing. Copy the `regen-hrvdex-goldens.mjs` pattern. (Note its ledger claims regeneration is
"byte-identical to `_diag/tch-golden-gen.html`" — **that file is not in the repo**.)

**FIXED 2026-07-27 — and the blocker resolved the way §1.5's own note demanded.** The golden's inputs are
extracted to **`tests/tch-golden-inputs.js`**, consumed by BOTH the equivalence gate and the new
`tools/regen-integrator-goldens.mjs`. A private copy in the tool would have drifted from the gate — the
sibling-divergence class the parent audit exists to fix — so there is exactly one builder.

**Dual-mode on purpose:** `dex-tests.js` runs in both lanes, so an `.mjs` module would have served the
tool and broken the browser gate. The file attaches to the global AND sets `module.exports`, exactly as
`clock.js` does, and `Dex-Test-Suite.html` gains one `<script src>` — that page loads by reference, so
**no bundle moved**.

**The extraction is proved faithful by the gate itself.** The builder is deterministic (seeded
`mulberry32`, no clock, no RNG), so a single byte of drift would red
`Integrator TCH-HR consensus ≡ committed golden`. It still reads **byte-identical**, and the new tool
independently reports **content unchanged** against the committed fixture.

The ledger note claiming byte-identity with `_diag/tch-golden-gen.html` is corrected — that file has
never existed in the repo, which is how the gap survived: the ledger *described* a regeneration path
that did not exist. **Gate:** 4075 assertions green with `DEX_UPLOADS` · GATE A 9/9 · typecheck clean ·
`regen-integrator-goldens.mjs --check` reproduces the golden.

---

## 2 · What executing the audit taught — the part worth keeping

### 2.1 Six fix sketches were wrong, and only execution showed it

A filed finding is a *hypothesis about the fix* as much as about the defect. Every one of these was caught
by building it, not by reading it:

| § | the sketch | what execution showed |
|---|---|---|
| 3.1 | "collapse desats within `dtMs`" | `dtMs` defaults to **120 s**; apneas recur every 20–60 s, so it would have **under**-counted — trading a doubled pool for a silently halved one |
| 3.2 | "define `real` as p < 0.05" | The primitive's 10 default shifts floor p at **0.091** — the verdict was *arithmetically unreachable* until the surrogate count was bought |
| 1.2 | "use the siblings' 1 s slack" | 2 s, 5 s, 60 s and 3600 s **all still rolled a whole day**; the threshold had to be a fraction of a day |
| 6.2 | "stamp `durSec = last − first`" | Would have declared **29 continuous days** of recording for a handful of spot measurements |
| 3.4/3.5 | "require overlap" | A strict rule would have dropped HRVDex/GlucoDex — whose window is *unknown*, not disjoint — out of fusion entirely |
| 3.1 | the headline itself | `confirmedAHI` does **not** move with one ECG (`usedSurge` is a `Set`); the surfaced damage was the **match-rate KPI**, not the index |

**Rule to carry forward:** treat a brief's "Fix sketch" as a lead, and re-derive it against the code before
trusting it. Two of the six would have shipped a *new* defect.

### 2.2 A test can pass for the wrong reason — mutation-check it, and check what it skips

Two near-misses, both caught only by running the new gate against pre-fix code:

- The `§3.2` test first computed the p-value **itself** instead of reading the shipped `coupling.real`, so
  it passed against the coin-flip rule.
- That same group **early-returned** when the new API was missing, so under mutation it reported "1
  failing" (a renamed function) and never exercised the defect at all.

**Rule:** a mutation check must fail on the *behavioural* assertion, and a group must not bail before it.

### 2.3 A gate can be blind rather than green

`§1.4` widened the Clock lint from a hand-curated list to every inlined asset (70 → **108** files). It
immediately caught a **second** blind gate: the badge-by-construction classifier could not see
`ecgdex-render.js` / `ppgdex-render.js` at all. They were not *classified*, they were *invisible*.

**Rule:** when a gate's message claims a scope ("any source", "clean across N files"), assert the scope
itself. `env.shippedInlined` now does.

### 2.4 The doc can outrank the registry when the registry entry is the newcomer

`CLAUDE.md` §🎫 says "fix the DOC, not the registry". Executing `§6.5` produced the inverse: the OxyDex
Reference guide already graded MOS/AAI/WtDSI **`heuristic`**, my new entries said `experimental`, and
`cohesion-badges` flagged the disagreement. The doc's call **predated** the entry and was **more
conservative**, so the registry adopted it. A badge is never upgraded on a new author's say-so.

### 2.5 `tools/build.mjs` is not the whole re-bundle

Missed twice — first `build-docs.mjs` (#450 CI red), then `build-analysis.mjs` (8 analysis pages inline a
DSP in worker blobs). A DSP change owns **three** builders. This is already a memory note; it belongs in
`CONTRIBUTING.md` too.

### 2.6 An unpinned local lint is not a lint

`npx biome` fetched a build that disagreed with the repo's pinned `@biomejs/biome 2.5.3`: the local check
read clean while CI failed on the same file. **Always `npx --yes @biomejs/biome@2.5.3`.**

### 2.7 A lane that cannot know the answer must SKIP, not fail

The `§1.4` scope assertion went red on the **browser** lane, which has no filesystem — the lane the parent
brief itself declared uncovered. Node-lane facts skip there, exactly as `docs-ledger` and `release-ledger`
already do.

---

## 3 · Environment friction worth fixing separately

`git worktree add` fails intermittently on this exFAT volume ("unable to write upstream branch
configuration"), once leaving a **locked, empty worktree entry** that needed `remove -f -f`. `git checkout -b`
hung for 2 minutes on a stale ref lock. Workarounds used throughout: `--no-track`, detached HEAD, and
`git push HEAD:refs/heads/<name>` instead of a tracked local branch. Not a code defect, but it shaped how
every branch in #449–#464 was created and is worth a `CONTRIBUTING.md` note.

---

## 4 · Done when

- [ ] §1.1 GlucoDex `coverage` + `timeseries`, fixtures regenerated through the sanctioned tool
- [ ] §1.2 surge-pool authority (or a documented reason the desat template does not transfer)
- [ ] §1.3 a decision on SNS/PSNS at HF = 0, then the fix
- [ ] §1.4 OxyDex inflated-span guard
- [ ] §1.5 `tools/regen-integrator-goldens.mjs`
- [ ] §2.5 / §2.6 / §3 folded into `CONTRIBUTING.md`
- [ ] parent `DEEP-AUDIT-III` flipped to DONE **only** once its punch-list is closed

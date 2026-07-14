<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-14

# Fixture verification gate — a fixture may not claim reproducibility nobody checked

Close the hole that put a wrong number in front of real users on 2026-07-14: a code-gated fixture can
carry a **reproducibility claim that no gate ever tested**, and the tooling *writes that claim for you*.

---

## §0 — The failure, concretely (this is not hypothetical)

`9bdb9be` (DEEP-AUDIT-2026-07-14 §1) excluded `FLAG.GAP_LONG` from every GlucoDex distribution
consumer. It declared itself **export-inert** on the evidence of the synthetic golden — which contains
no long gap. The **real** Abbott Lingo night does, so `daypartVariability` moved (every `n` dropped:
interpolation stopped being counted as measured glucose). The committed fixture was left stale, and:

- the **equivalence leg** that would have caught it **SKIPPED** — its input is a gitignored recording,
  absent in CI and on the executing session's machine;
- **GATE B stayed green** — it is *static*: it pins committed input/output bytes + code identity, and
  never re-runs the app;
- **`build.mjs` re-stamped the fixture's `manifestHash`** to the new bundle hash — silently converting
  "this output was produced by code X" into a fresh assertion that it is reproducible under code Y.

So every gate was green, the brief said DONE, the release shipped, and the **served GlucoDex ran the
pre-fix DSP against real users' CGM data** until it was caught by hand a week later.

**The defect is not "a leg skipped."** It is that *the skip is silent and the claim is auto-written*:
the ledger ends up asserting something no gate checked, and the assertion was made by a tool, not a
person. A skip that leaves a **false claim behind** is worse than a red.

---

## §1 — `computeHash`: make export-inertness machine-decidable

Today "EXPORT-INERT" is a **claim in a commit message**. It is the single most repeated claim in this
repo's history (`FIXTURE-PROVENANCE.json` is full of `note_*: "EXPORT-INERT … outputHash UNCHANGED"`),
and on 2026-07-14 it was **wrong**, asserted in good faith, by a competent session, with all gates green.
A claim that load-bearing must be computed, not asserted.

**`computeHash(bundle)`** — the same projection as `manifestHash` (sorted `logicalName \0 sha256(assetText)`,
SHA-256[0:12]) **restricted to the assets in the export's compute closure**: the module set that a
headless realm must load for `compute()` to run. For GlucoDex that is exactly what
`tools/regen-glucodex-goldens.mjs` already loads:

    kernel-constants.js · signal-frame.js · dex-export.js · metric-registry.js
    glucodex-registry.js · glucodex-dsp.js

That list is not invented for this brief — **it is empirically the closure**: `compute()` runs in a realm
holding exactly those files, so nothing outside them can change its output. Single-source it (the regen
tools + `tests/run-tests.mjs`'s realm lists already encode it per node; hoist to one table, e.g.
`compute-closure.json`, and gate that each node's declared closure is (a) a subset of its bundle's inlined
assets and (b) sufficient to run `compute()` — the equiv legs already prove (b) every run).

Then:

| change | `manifestHash` | `computeHash` | meaning |
|---|---|---|---|
| render / CSS / app copy | moves | **stable** | export-inert, **proven** — no re-verification owed |
| any DSP / clock / export / registry edit | moves | **moves** | the export *may* have moved — re-verification owed |

This is the discriminator the repo has been eyeballing by hand for months. It **over-flags, never
under-flags** (a compute-closure edit that happens not to move the output still demands one re-run —
correct and cheap), and it is deterministic, so it has **zero false positives** in the sense that matters:
it never *fails to notice*.

## §2 — `verifiedUnder`: the fixture records the code it was actually reproduced under

Add one field per code-gated fixture in `FIXTURE-PROVENANCE.json`:

    "verifiedUnder": "<computeHash of the code that ACTUALLY re-ran the app and reproduced these bytes>"

**Write rules — the whole point of the design:**

- **`build.mjs` MUST NEVER write `verifiedUnder`.** It does not run the app; it cannot know. (Today it
  re-stamps `manifestHash`, which is precisely how the false claim gets authored. That re-stamp stays —
  `manifestHash` is a *code identity*, not a reproducibility claim — but the reproducibility claim moves
  out of it into `verifiedUnder`, which only a tool that actually executed the app may touch.)
- **Only `tools/regen-<node>-goldens.mjs` and a new `tools/verify-fixtures.mjs` may write it**, and only
  after `compute({committed input}) ≡ committed output` has actually been evaluated in this environment.
- Never hand-edit it. Never fabricate it during migration (see §5).

A fixture is **VERIFIED** iff `verifiedUnder == computeHash(its bundle)`. Otherwise it is **UNVERIFIED** —
not "skipped", not "probably fine". The state has a name and a value.

## §3 — Where the gate bites (three placements, escalating)

**§3.1 — Visibility (the suite). A skip stops being silent.**
`tests/dex-tests.js` gains an `fixture-verification` group (Node lane; browser lane can't stat the corpus):
for every code-gated fixture whose input is **not git-tracked** (reuse the `git ls-files` truth already in
`run-tests.mjs:283`, the demo-inputs gate's authority), assert `verifiedUnder == computeHash`. On failure it
reports, by name:

    ✕ GlucoDex_2026-06-27_equiv — UNVERIFIED: compute closure moved 92a7dff→a1b2c3d since this
      output was last reproduced. Re-run on the corpus (DEX_UPLOADS=<path> node tests/run-tests.mjs)
      or regenerate (node tools/regen-glucodex-goldens.mjs), then re-record.

Fixtures whose inputs **are** committed (the synthetic twins, the CPAP EDFs) need no `verifiedUnder` at
all — CI re-runs them from source every push, so they cannot go stale unnoticed. **Scope of the new field
is therefore small: only the ~10 corpus-backed fixtures.**

**§3.2 — The hard gate: `release.mjs` refuses to cut a release with an UNVERIFIED fixture.**
This is the placement that matters most, and it is nearly free. The release is cut **by the owner, on the
machine that HAS the corpus** — so the one party who can discharge the obligation is exactly the party the
gate stops. Harm only materializes when code ships; put the wall there. **This alone would have blocked
v1.10.1 from shipping the stale GlucoDex fixture**, and blocked the pre-fix DSP from reaching users.

**§3.3 — CI red (the forcing function; sequence LAST, after §4).**
Red the PR when a corpus-backed fixture is UNVERIFIED. Catches it at the moment of authorship rather than
at release. **Deliberately staged last**, because it has a real cost: a contributor (or an agent session)
with **no corpus cannot green it** — they cannot run the real legs at all. Land §3.1 + §3.2 first; adopt
§3.3 once §4 has made the *synthetic* corpus strong enough that a corpus-less contributor can honestly
demonstrate their change is export-inert. Until then §3.3 is a merge-blocker for outside contributions,
which is a worse trade than the release wall.

## §4 — Finish the job `DEEP-AUDIT-FOLLOWUPS-2026-07-12` §A started (the complementary half)

§1–§3 make staleness *visible and unshippable*. They do not make it *catchable in CI*, because the real
recordings can never be committed (personal medical data — correctly gitignored). Only the synthetic twins
run in CI, and **the GlucoDex miss is precisely a synthetic-coverage failure**: the twin carried no
`GAP_LONG`, so the very flag the fix touched was unexercised.

**This mechanism already exists and is executed — it just never reached GlucoDex.**
`DEEP-AUDIT-FOLLOWUPS-2026-07-12` §A (DONE) established the pattern and the reasoning verbatim: real
adversarial nights are gitignored, so CI stays blind; **the fixture must be synthetic in order to be
committed.** It shipped four committed adversarial OxyDex inputs (`_dmy`, `_mdy`, `_lossy`, `_longnight`),
each with a control proving it bites in a fresh clone. **GlucoDex has no adversarial twin at all** — only a
clean golden. So §4 is not a new idea; it is the *unfinished half* of an executed brief, and the 2026-07-14
incident is what the gap cost.

- **Immediately:** a committed adversarial synthetic Lingo input with a **14 h sensor gap** (the exact shape
  the §1 metamorphic test already builds in-memory), joined to the equiv gate like the OxyDex four. A GlucoDex
  compute change that moves the daypart block then **reds in CI, on the PR, with no corpus**.
- **Generalize (the real deliverable):** per node, declare the feature-flag set its **real** recording trips
  (`GAP_LONG`, `WARMUP`, `COMPRESSION`, clamp-saturation, dropped rows, midnight span, …) and gate that a
  committed synthetic trips the same set. A flag exercised **only** by an uncommittable recording is a
  **coverage hole with a name** — the honest state. Today those holes are invisible, which is exactly how
  §A could be marked DONE while the GlucoDex hole stood wide open.

This is the cheaper half and it pays first. **Do §4 before §3.3** — and fold the result back into
`DEEP-AUDIT-FOLLOWUPS-2026-07-12` §A rather than leaving two briefs claiming the same ground.

## §5 — Migration: verify once, then stamp. Never fabricate. (Already run — and it is CLEAN.)

The corpus fixtures have **no** honest `verifiedUnder` today — nobody knows what code last reproduced them.
Do **not** back-fill it from the current `manifestHash`: that fabricates exactly the claim this brief exists
to abolish. Instead, on a machine with the corpus, **run every real equiv leg once**
(`DEX_UPLOADS=<corpus> node tests/run-tests.mjs`) and stamp `verifiedUnder` **only** for the fixtures that
actually reproduced. A fixture that does **not** reproduce is a **live stale-fixture finding** — regenerate it
(§🔏's regen tools) and say so.

**That verification pass was run on 2026-07-14 against the real corpus, at `main` = v1.10.2 — every
corpus-backed leg PASSED. Zero skips, zero drift:**

    OxyDex (both real summaries) · PulseDex · HRVDex · GlucoDex · PpgDex · ECGDex ·
    CPAPDex (both real EDF nights) · the HRVDex/PulseDex event twins · all 6 synthetic goldens

So the honest expectation is the **opposite** of this brief's own first draft, which asserted "expect this to
surface more than zero". **GlucoDex was the only one.** Every other fixture reproduces under current code.
That makes the migration a **stamp of an actually-measured state** rather than a hunt — cheap, and available
today. It also means the gate lands **green**, which is the right way to introduce one: a gate that reds on
arrival teaches people to route around it.

⚠️ A clean snapshot is **not** an argument that the design is unnecessary. It says nothing about the *next*
compute change — which is the whole point of §1–§3. The 2026-07-14 miss was caught **by accident**, and
"everything happens to be clean today" is precisely the state the tree was in while it shipped.

## §6 — Self-tests (the gate must be shown to bite)

Mirror the house pattern (`docs-ledger`/`release-ledger` self-tests):

- a fixture whose `verifiedUnder` == `computeHash` → VERIFIED (green);
- the same fixture with one byte changed in a **compute-closure** module → `computeHash` moves → **RED**;
- the same fixture with one byte changed in a **render-only** module → `computeHash` stable → still green
  (this is the anti-false-positive test: export-inert changes must not demand re-verification);
- a fixture with a **committed** input → exempt (CI re-runs it) — proves the scope narrowing is real;
- `build.mjs` run against a fixture → `verifiedUnder` **unchanged** (proves the tool cannot author the claim).

## §7 — Honest limits (state them; do not oversell)

- `computeHash` proves an export is **current**, never that it is **correct**. A wrong-but-consistent
  fixture regenerated from wrong code passes. Correctness lives in the metamorphic/invariant tests.
- The closure is only as honest as its declaration; the subset+sufficiency gate (§1) bounds that, and the
  failure mode is over-flagging.
- §3.2 protects **releases**, not `main`. A stale fixture can still sit on `main` between releases — visible
  (§3.1) but not blocked. §3.3 closes that, at the cost in §3.3.
- None of this recovers the *un-runnable* legs for a corpus-less contributor. That is what §4 is for, and §4
  can only ever approximate a real recording. **Say so in the docs rather than implying CI covers it.**

---

## Done when

- [ ] `computeHash` implemented in `manifest-gate.js` (shared by both lanes, like `manifestHashFromText`), with
      the per-node compute closure single-sourced and subset/sufficiency-gated.
- [ ] `verifiedUnder` in `FIXTURE-PROVENANCE.json` for the corpus-backed fixtures; `build.mjs` provably cannot
      write it; regen tools + `tools/verify-fixtures.mjs` do.
- [ ] §3.1 suite group green, with self-tests (§6) proving it reds on a compute-closure change and does **not**
      red on a render-only change.
- [ ] §3.2 `release.mjs` pre-flight refuses an UNVERIFIED fixture (self-tested).
- [ ] §5 migration run on the corpus; every fixture either stamped or **regenerated**, with the findings recorded.
- [ ] §4 synthetic Lingo carries a long gap; per-node flag-coverage declared + gated.
- [ ] CLAUDE.md §🔏 updated: "export-inert" is no longer a claim you may make — it is a value `computeHash`
      decides. The prose warning added 2026-07-14 becomes a gate.
- [ ] §3.3 (CI red) sequenced only after §4 lands.

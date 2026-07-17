<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living audit charter) · **last-verified:** 2026-07-17 · **Audience:** an AI agent (or human) auditing the TESTS of the Tepna Dex suite

# Test / CI audit prompt — Tepna Dex suite

> **Paste the "MISSION" block below to start an auditor.** The rest is the reference it reads.
> **This is the SIBLING of `AUDIT-PROMPT.md`, not a duplicate.** `AUDIT-PROMPT.md` audits the **product
> code** for bugs and uses the tests as its *tool* ("prove each finding with a failing assertion"). THIS
> charter flips the subject: it audits the **tests and gates themselves** — *does each gate actually fail
> when the thing it protects breaks?* A gate that stays green under a real defect is theater, and this
> suite has shipped exactly that (a stale GlucoDex fixture, a worker that threw while the gate passed).
> Run AUDIT-PROMPT to find wrong numbers; run THIS to find gates that would have let a wrong number
> through. They share nothing but the codebase.

---

## MISSION (paste this)

You are auditing the **test suite and CI gates** of the **Tepna Dex suite** — not the product code. Your
job is to find **gates that cannot fail**: an assertion, fixture, or CI leg that is green today and would
*stay* green if the code it guards were broken. In this domain the tests are the only thing standing
between a silent unit/clock/estimator bug and a real user's health data, so a hollow gate is a
first-severity defect — it manufactures false confidence.

**THE METHOD IS MUTATION, NOT READING.** For each gate you doubt: **break the code it protects** (flip a
sign, drop a `−1`, swap `ms`/`s`, `return null` early, comment out the worker's real work) and **confirm the
gate reds.** If it stays green, you have a finding — the strongest kind, because it is a reproduction by
construction. Do not reason about whether a test "looks thorough"; make the mutation and watch.

**VERIFY THE VERIFIER.** Every finding must carry a **mutation + observation**: the exact one-line code
change you made, and the gate output before (green) and after (still green = defect, or red = healthy).
A claim that "this test is weak" without a surviving mutation is a *hypothesis* — label it so.

**Before you start:** read `ORIENTATION.md` (the map), `CLAUDE.md` (the constitution — wins on every
conflict), and the **"Out of scope"** list below (several of these classes are ALREADY auto-enforced by a
meta-gate — re-flagging them wastes effort). Establish a green baseline: `node tests/run-tests.mjs` (the
Node lane), `Dex-Test-Suite.html?full` (the browser lane — render-coverage is on-demand; wait for the
all-green pill after the group count stops climbing), and `verify-provenance.html`. Restore every mutation
before moving on — leave the tree green.

Deliver findings in the format under **"Reporting"**. One gated change at a time; do not sweep.

---

## The gate-failure classes worth hunting (highest yield first — each has drawn blood here)

1. **A gate that passes on a dead path — the #1 fear.** A test that compares two paths where one **falls
   back to the other on failure** proves nothing: kill the primary and the numbers stay right. The
   canonical scar: the PPG `worker ≡ serial` check **passed on a completely dead worker pool**, because
   `w.onerror` silently fell back to serial (`PPGDEX-WORKER-CLOSURE`, `WORKER-REALM-GATES`). Hunt every
   `worker≡serial` / `A≡B` / `fast≡slow` gate and ask: *if A throws, does the harness quietly run B and
   still pass?* The fix pattern is to assert the primary **actually ran** (e.g. `bootSkips == []`,
   "N workers spawned, none errored"), not just that outputs match.

2. **Static-listed ≠ executed ≠ asserted.** A module appearing in a `SOURCE_FILES` / CSP / "self-contained"
   `.html` list is **fetched as text for a static check** — its functions never run. A module `loadInto`'d
   into the realm is **executed** but still untested unless it is surfaced into `env` AND a `group()`
   asserts against it. All three are needed. Hunt: a module with real math that is in a static list but not
   in either runner's `env` block (`tests/run-tests.mjs` ~`const env` + `Dex-Test-Suite.html` ~`const env`)
   — it *looks* covered and is not (the whole premise of `TEST-COVERAGE-FOLLOWUPS`).

3. **Fake coverage — testing a copy, not the shipped code.** A known-answer that exercises a **freshly
   added or duplicated** implementation, not the one the app runs, is a decoration. Hunt: an analysis page
   that re-implements its own `mean`/`sd`/`pearson`/`ba` inline while a "tested" copy sits in
   `analysis-stats.js`; a test that reconstructs a formula it then asserts (circular). A test must reach the
   **exact export the bundle ships**.

4. **Circular / self-fulfilling known-answers.** An "expected" value that was pasted from the code's own
   output the day it was written pins *whatever the code did*, not *what is correct* — a sign error frozen
   in becomes the golden. Hunt: expected constants with no closed-form / cited derivation next to them;
   fixtures regenerated by the same code they gate with no independent check. Prefer values a human can
   re-derive (`208 − 0.7·age`, `28.7·A1c − 46.7`) or a differential/metamorphic oracle over a magic number.

5. **Unreal fixtures — inputs that never occur.** A fixture built with a *tidy* value the real world never
   produces can only prove the code works on inputs it will never see. The scar: every PPG fixture used an
   **integer `fs`**, so a fractional-sample-index bug (real Polar `fs` = 176.26) shipped green until a
   non-integer-`fs` regression was added (`PPGDEX-PI-AND-PARSE §4`). Hunt: fixtures with round `fs`, exact
   epoch boundaries, no gaps, no clipping, no artifact — then feed the adversarial-but-real twin.

6. **Silent skips that shrink the gate.** A `⊘` skip is **neither pass nor fail** — a green pill can hide a
   leg that never ran. On a fresh clone the **gitignored `uploads/`** absents the entire real-recording
   equivalence surface (GATE-C) and CI stays green on a fraction of the gate (`GATE-INTEGRITY-AND-DEVLOOP
   §G1`; every skip must now be declared in `tests/expected-skips.json`, fail-closed). Hunt: an undeclared
   skip; a precondition (`if (!x) return`) that quietly emits zero assertions; a cold-boot timeout counted
   as a skip that masks a rig that never booted (`sameOriginStatus().bootSkips`, DEX-TEST-DETERMINISM
   2026-07-01).

7. **Asserted-not-computed claims.** A property stated in prose (a commit message, a `note_*` field) is not
   evidence. The scar: `"EXPORT-INERT … outputHash UNCHANGED"` was the repo's most-repeated assertion and
   one was **wrong** — a stale GlucoDex fixture shipped against real CGM data while every gate was green
   (`FIXTURE-VERIFICATION-GATE`). Now `computeHash` / `verifiedUnder` are **computed**. Hunt: any test-
   validity claim carried by a string a human typed rather than a value the machine recomputed.

8. **Partition / sharding holes.** A run that splits work can drop a slice in silence. A **name/pattern**
   shard skips any group no pattern claims and still goes green; only an **index partition** proven by a
   union check is safe (`CI-SHARDING`; `verify-shard-union.mjs --deep`). Hunt: a `--group`/`DEX_GROUP` filter
   that changes the RUN not just the REPORT; a shard scheme with no assertion that ∪shards ≡ the full run.

9. **Two lanes that quietly diverge.** A group must mean the same thing in Node and in the browser. Hunt: an
   assertion reachable in one lane only (a DOM/`DOMParser`/`Worker` dependency) that is silently absent — not
   wrong, but *uncovered where you think it's covered*. Guard lane-specific legs on a capability check and
   make the split explicit, never accidental.

---

## How to verify (mutate — don't eyeball)

- **Mutation loop:** with a green baseline, make ONE surgical break in the guarded code, run just that gate
  (`node tests/run-tests.mjs --group="<name>"` or the browser rig), record green→? , then **revert**. A
  surviving mutation is the finding.
- **Coverage-reachability:** to prove class 2/3, add a `throw` at the top of the exact function the app
  ships and confirm a gate reds; if nothing reds, nothing tests it.
- **Skip census:** diff the live skip set against `tests/expected-skips.json`; run once with `DEX_UPLOADS=`
  pointed at a real corpus and once without — the delta is the coverage the merge path never sees.
- **Fixture realism:** for each committed fixture, name the real-world input property it omits (integer
  `fs`, no gap, no clip) and construct the adversarial twin; prefer a **committed** twin (CI re-runs it) over
  a gitignored real file (CI goes blind) — `FIXTURE-VERIFICATION-GATE`.
- **Shard union:** `node tests/verify-shard-union.mjs --deep` (assertion-for-assertion ≡ unsharded).

---

## Out of scope — do NOT file these (already enforced, or intentional)

- **Classes a META-GATE already catches every push** — do not "audit" these by hand, cite the gate:
  undeclared skips (`tests/expected-skips.json`, fail-closed), shard drift (`verify-shard-union.mjs`),
  fixture reproducibility / stale export (`FIXTURE-VERIFICATION-GATE` → `computeHash`/`verifiedUnder` +
  the `equiv`/golden legs), worker-realm closure (the PPG blob-executes rig). Flag one of these only if you
  can show the **meta-gate itself** has a hole (that IS in scope — audit the auditor).
- **Test pass-/group-COUNT drift run-to-run** — only the all-green pill is the signal; render-coverage legs
  are timing-sized (`CLAUDE.md`). A count change is not a regression.
- **A deliberately Node-only or browser-only group** — `docs-ledger`/`release-ledger` are Node-lane-only by
  design (they read the filesystem; the browser lane can't `readdir`), the render-coverage rig is browser-
  only. A documented lane split is not class 9.
- **The known-good redundancies** — `parseTimestamp` per-node variants, the `fascia` alias, inert `buildHash`
  (see `AUDIT-PROMPT.md` "Out of scope"): their *tests* asserting them are correct, not gaps.
- Anything on the **`CLAUDE.md` "Known non-issues"** list or already open in `DOCS-INDEX.md` — cite it.

---

## Reporting (one entry per finding)

For each finding, give:
- **Severity** — top = *a gate that stays green under a real defect* (hollow gate); then *coverage claimed
  but absent* (class 2/3); then *silent skip / partition hole*; then *fixture realism / lane divergence*.
- **Symptom** — which gate, and what it fails to catch, in one line.
- **Mutation + observation** — the exact one-line code break, the gate output before (green) and after
  (still green = defect). No surviving mutation → mark **HYPOTHESIS**.
- **Root cause** — why the gate is blind (fallback path, missing `env` wiring, tidy fixture, prose claim).
- **Fix sketch + gate cost** — the change that makes the gate bite, and its cost (new `env` entry + group;
  a regen'd fixture per `CLAUDE.md §🔏`; a lane-wiring edit in both runners). One gated change at a time.

Group by gate/module. End with a **prioritized punch-list** (hollow gates first). Where a whole *class* of
gate is hollow, propose the meta-gate that would catch the class, not just the one instance — that is how
this suite has retired each scar above (skips → `expected-skips.json`, closure → the blob-executes rig,
stale fixture → `computeHash`).

<!-- Copyright 2026 Michal Planicka -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

**Status:** IN-PROGRESS — 2026-09-18 · **Created:** 2026-09-18

# Residue rows whose evidence is an ABSENCE — a verification sweep

**Population:** the residue ledger at **`65b9f8db`** — 195 rows, **97 OPEN**. Quote every count in this
ledger as `N at <sha>`: it gained **10 rows in 24 hours** (184 to 195 since 2026-09-17 02:27), so a bare
count measures a tree nobody else has. This sweep opened with two wrong counts for exactly that reason —
93 and 94, both arrived at by correct method against a past. Same defect `CLAUDE.md` section 5 records
for a cadence number quoted without its window.

## Why these rows, and what the rate does NOT say

Kestrel picked up three recorded-as-open items and found two were stale or wrong records rather than
missing work (#2621, #2623). Both shared a shape: **the evidence was an ABSENCE** — "0 X", "no Y
exists", "nothing does Z" — where the query producing the zero had the wrong window, the wrong
vocabulary, or the wrong artifact type.

**Selection criterion.** A row qualifies when the evidence's load-bearing fact is a **non-observation
whose zero survives a wrong window, vocabulary, or artifact type**. Well-denominated zeros over an
enumerated population are **excluded** — `0 failed` of 7160, `0 null AAI` of 117, `0 records with none`
of 5136 — because a zero carrying its own denominator cannot be manufactured by a bad query. That
exclusion takes ~25 candidates to **15**.

**This is a census of the subset, not a sample.** All 97 evidence cells were read, not grepped, so the
15 is a read set. A keyword filter would have counted the word rather than the state.

🔴 **THE RATE BELOW IS A PROPERTY OF THE SUBSET AND MUST NOT BE EXTRAPOLATED.** These rows were chosen
*because* their evidence shape makes them most likely to be wrong; the selection is the entire reason
the rate is elevated. Nothing here licenses a claim about the other ~82 OPEN rows. A ledger-wide figure
needs a random sample of those, which is a separate and larger unit.

**Verified 12 of 15 — 2 falsified, 10 survive.** Kestrel's initial 2-of-3 and this sweep's own first
3-of-4 were both small samples that front-loaded the bad rows.

---

## 1 · FINDING — "wrong when logged" is a distinct and worse defect than a stale window

#2623's failure was a **bad window**: a query that could have been right, run over the wrong interval.
The two rows below are worse, and want a different remedy: **the refuting artifact was already in the
tree at the row's own pinned commit.** Not a query gone stale — a query nobody ran.

### 1.1 `2026-09-12-fix-for-ungated-check-lands-ungated` — FALSIFIED · wrong ARTIFACT TYPE

The row cites a grep for the tool's name under `tests/` returning nothing at `767e0ad0`.

That query is **honest and reproducible** — at `767e0ad0` that directory genuinely held no reference.
The inference from it is false. At the same commit, `tools/wt-done.mjs` carried **three** `--selftest`
occurrences (`:233`, `:234`, `:293`). The gating idiom for `tools/*.mjs` here is the tool's own
selftest, not a file under `tests/`.

⚠️ **The ledger refutes this row two rows away, logged the SAME DAY.**
`2026-09-12-ungated-tool-fix-rule-not-viable` records that **93 tools declare `--selftest`**. Both rows
carry the same log date. Nobody read across them.

Stale as well: #2404 later added the `tests/` gate (6 references across two test files).

### 1.2 `2026-09-12-no-durable-capture-file-deletion-guard` — FALSIFIED · wrong VOCABULARY

The row greps for the literal `65536` and concludes no module implements a capture-file loss check.

`65536` is a buffer-size constant with **no relationship to the concept**. The query could not have
found the guard if it were staring at it.

`capture-host/oxy_inventory.py` `reconcile()` classifies exactly this, in its own docstring: `missing` —
the ledger knows it, disk does not have it — plus `size_drift` for a verified recording whose bytes
changed underneath. **First committed 2026-08-23, twenty days before the row.**

Traced to a live consumer rather than stopping at existence:

    capture.py:5306        import pull_session
      pull_session.py:239  oxy_restart.plan(rows, disk_listing, part_files)
      oxy_restart.py:50    inv.reconcile(ledger_rows, disk_listing)

⚠️ **A NARROWER VERSION SURVIVES AND MUST NOT BE CLOSED WITH THIS ONE.** That path runs at **pull /
cold-start boundaries**, not continuously during a live session. The originating incident was a *live*
ring session losing two files. "No guard exists" is false; **"no guard runs DURING live capture" is
untested**. Land the narrower claim as a NEW row with this evidence and let the old row close pointing
at it — never close a true defect because its stated reason was wrong.

### 1.3 · Peer verification can launder a single bad query into corroboration

Row 1.2 carries "peer-verified 2026-09-12". If the second pair of eyes re-ran the same grep, that is
**one measurement counted twice**. Our convention has no rule requiring the second party to use a
*different* query, and an absence claim is precisely where re-running the same one proves nothing.

---

## 2 · FINDING — the ledger contains its own corrections, and nobody reads across rows

Section 1.1's row is refuted by a row logged the same day, two rows away. The same pattern caught
**this sweep's own author**, twice, in the opposite direction.

**Both near-misses were "adjacency is not equivalence": widen the search until something sharing the
topic appears, then read its presence as refutation.**

| near-miss | what was found | why it is not a refutation |
|---|---|---|
| `2026-09-03-oxydex-proxy-resprate-unattributed` | a `basis` field at `oxydex-dsp.js:5013`, convention documented at `:4842` | `basis` describes the **windowing**, not the **estimator**. It cannot tell a consumer an SpO2-derived proxy from a measured rate — which is the row's defect |
| `2026-09-13-odi-threshold-has-no-injection-point` | the callee accepts a `dropPct` option, documented `:3275` | the row says the **call sites** take no override, and they do not — every site passes the frozen kernel constant |

The first was **already answered in the ledger**: `2026-09-03-oxydex-resprate-has-no-consumer` says, in
as many words, that the export carries the windowing basis and no estimator attribution. The right
answer was one row away and a worse one was supplied instead.

The row's field name was never a guess either: that identifier **is** the real fleet convention, defined
at `integrator-dsp.js:366` and `:485`. OxyDex is the node that omits it. The row is **stronger** than
written.

**Remedy adopted for the rest of this sweep: every verdict carries a positive control, including a
refutation.** A zero with no control cannot separate *absent* from *instrument blind*; a refutation with
no control cannot separate *the row is wrong* from *I found a different thing*.

### 2.1 · The same failure, in the repo's own counting instruction — and it is FIXED here

Both wrong counts that opened this sweep (93, 94) came from stale trees. A third wrong count came from
the documented method.

The ledger's header already carries the right answer, with a verification:

> Open count: an anchored row regex — *verified 2026-09-02: 20 matches against 20 open rows, and 0
> non-row lines match*

and it warns, in the next line, that the obvious substring form **counts the instruction line itself**,
because the line quoting the pattern contains the pattern. Measured there at the time: 17 against 16.

`DOCS-INDEX.md` nevertheless prescribed the substring form, and that is the command a peer ran to get
**98** against a true **97**. Measured today:

| method | result |
|---|---|
| anchored row regex (the ledger's own) | **97** |
| bare substring (what the index prescribed) | 98 |
| gate-faithful parser | **97** |

The single false positive is the ledger's own warning line about the miscount. **A warning that
triggers the defect it warns about is not a warning — it is the defect with documentation attached.**

Fixed in this PR: `DOCS-INDEX.md` now prescribes the anchored form and says why. This is the clearest
case in the sweep of the section-2 pattern — the correction existed, was verified, and sat in a
different file from the instruction that needed it.

---

## 3 · FINDING — a zero that AGREES with the row is the most dangerous result

The sharpest case in the sweep, and a failure mode neither #2621 nor #2623 shows.

Verifying `2026-09-18-as11-implements-robust-caching`'s claim that three vendor UUIDs are named nowhere
else in the repo, a repo-wide grep returned **0 files for all three** — apparent corroboration.

It was instrument blindness. The working tree was 24 hours stale and **did not contain the row itself**,
which quotes those UUIDs. A correct grep must return at least 1. Re-run against `origin/main`:

| target | files |
|---|---|
| the three vendor UUIDs | **2 each** — the GATT handle-map brief and the ledger row |
| control: a real cross-artifact UUID | a brief **and** `capture-host/tests/test_probe_ring_adv.py` |

**The row survives** — no *code* names them. But a zero that confirms the hypothesis is never
scrutinised, which makes it strictly more dangerous than a zero that contradicts one. **The row's own
text is the positive control** for any "named nowhere" claim, and it is free.

---

## 4 · FINDING — line-citation rot silently converts a true row into a refuted one

Every row in this ledger cites lines. Host-axis and seam work has been moving them all week.

`2026-09-02-ppgdex-ambient-collected-unused` cites `ppgdex-dsp.js:679` for its Float32Array store.
`:679` is now host-axis code; the store is at **`:934`**. The row is **correct** — but a verifier who
reads `:679`, finds unrelated code and stops has been handed a false refutation by ordinary drift.

This is how a **true** row gets closed by mistake, and it mirrors section 1: there a wrong inference
survived because nobody checked; here a right claim is at risk because the pointer rotted.

🔴 **CORRECTION — this is NOT a new finding, and the author committing the error is the point.** The
defect is already a row: `2026-09-06-brief-header-file-line-citations-rot`, logged **twelve days
earlier**, whose stated fix is already *"a convention plus a check — cite a greppable IDENTIFIER"*. The
check half was then designed, measured and **refuted** in `BRIEF-CODE-ANCHOR-CHECK-2026-09-11-BRIEF.md`
(DONE, *"BOTH SHAPES TESTED ARE REFUTED — build neither"*), whose §3.1 states the constraint verbatim:
**`file:line` may be DISPLAYED; only the identifier may be ASSERTED.**

So this brief documented "the ledger contains its own corrections and nobody reads across rows" in
section 2, and then committed exactly that failure two sections later. One doc-search would have found
it; it was the top hit on the first query when finally run. **The section-2 pattern is not a property of
other sessions.**

### 4.1 · The rot rate, measured — and why it REFUTES a gate rather than justifying one

Measured at `origin/main` over every `file:line` citation in the ledger, with the denominator published:

| bucket | n |
|---|---|
| citations found, across 77 of 195 rows | **237** |
| path no longer exists | 2 |
| line past EOF | 1 |
| ambiguous bare `:NNN` (no file bindable) | 4 |
| **UNVERIFIABLE — no quotable anchor in reach** | **104 (44 %)** |
| checkable | **126** |
| — anchor present at the cited line | 21 |
| — flagged as drifted | 105 |

A deterministic 12-sample of the 105 was hand-classified: **~7 real rot · ~4 false positive · 1
ambiguous**. ⚠️ **Quote that as n=12 with its interval — true-positive rate among flagged ≈ 55-60 %,
interval roughly 30-85 %** — not as a point estimate. The derived "~48 % of the checkable subset" is a
projection off twelve hand-checks and will not support more weight than that.

Two confirmed drifts are four figures: `computeRespRateProxy` cited at `oxydex-dsp.js:2867` lives at
`:4982` (**2,115 lines**); `correctRR`'s call site cited at `ppgdex-dsp.js:3338` is now `series,`.

**Three independent reasons not to gate, each sufficient:**

1. **Magnitude.** A gate reddening on ~60 existing citations is switched off inside a week —
   `mutate_diff.py`'s own header carries this argument.
2. **Regeneration.** Fix-then-gate does not rescue it: two hand-checked citations drifted four figures
   in under three weeks, so the ledger is red again days after any cleanup.
3. **The instrument's own false-positive rate** (~40 %) would convict correct rows — the
   invariant-convicts-working-code failure.

And **44 % of citations are structurally uncheckable**, so even a perfect checker is silent on nearly
half the population while its green reads as *"citations fine"*.

⚠️ **This refutation is NOT a duplicate of `BRIEF-CODE-ANCHOR-CHECK`'s.** That one failed over *briefs*,
where absent identifiers are structural because a brief describes work not yet done (§7.1: 15 of 15
false positives), and it was **blind to its own defining case** (§7.2). Rows are a different population
— a row records a defect whose code existed at logging time — and this instrument **does** flag its
defining case (`ppgdex-dsp.js:679`, now `try {`). It is refuted for different reasons, and both results
should stand.

**The remedy that survives is a CONVENTION — cite a greppable identifier, let `file:line` be
decoration.** That is an owner call, not this brief's, and it is where this stops.

---

## 5 · FINDING — "gate-tracked" is a third state, beside *wrong* and *stale*

`2026-09-02-pat-detailcorr-unread` is **true**: the value is emitted at
`pat-feasibility-worker.js:559` and read by nothing. It is also **already fenced** — the shared suite
carries a `KNOWN_DEAD` ratchet naming it, whose own comment states what removing it would require.

The defect is real, recorded and gated. That is **bookkeeping, not work**, and a different state from an
open untracked defect. ⚠️ The row must NOT be closed: the ledger's state vocabulary has no value for
this, and inventing a sixth is not this brief's call. Flagged for the owner.

---

## 6 · Verification results — 12 of 15

**FALSIFIED (2)** — sections 1.1 and 1.2.

**SURVIVE (10)**, each with the control that makes its zero load-bearing:

| row | control |
|---|---|
| `2026-09-03-oxydex-proxy-resprate-unattributed` | the method field exists fleet-wide in the Integrator; OxyDex omits it |
| `2026-09-03-oxydex-resprate-has-no-consumer` | the Integrator reads `newMetrics.respRate` **0x** and `newMetrics.stageProxy` **1x** — the control proves the reader works. Assignment sites `:365 :484 :638`, OxyDex absent |
| `2026-09-02-ppgdex-ambient-collected-unused` | widened repo-wide; 3 **homonyms** rejected — one node's `amb` is ambulatory, a UI `.amb` is a CSS class, the synth generator *writes* it |
| `2026-09-06-restart-row-marker-premise-absent` | widened past the row's two verbs to `open(,'w')`, `write_bytes`, `json.dump`, `os.utime`; `cpap_harvest.py:401-413` writes **harvested data**, not a run marker |
| `2026-09-13-odi-threshold-has-no-injection-point` | frozen kernel **and** every call site passes the constant — both legs |
| `2026-09-16-devcaps-has-no-branch-consumer` | the capability getter has **0** callers outside its module; the write side **is** wired |
| `2026-09-02-papers-cohort-never-recorded` | widened to a 5th and 6th artifact; neither names the night list |
| `2026-09-12-sysfs-hci-address-attr-gone` | the sysfs directory **is** readable and lists five other attributes — the absence is not a permissions artifact. Holds on rig across kernels 7.0.0-30 and -31 |
| `2026-09-18-as11-implements-robust-caching` | section 3 |
| `2026-09-02-pat-detailcorr-unread` | section 5 — true **and** gate-tracked |

**NOT VERIFIED (3)** — this brief says nothing about them, pass or fail:
`2026-09-13-webgpu-absent-on-rig` (needs a browser run) ·
`2026-09-17-ble-timebase-edge-stamp-undecided` · `2026-09-17-seam-exposure-is-input-provenance`.

**EXCLUDED on re-check (2), by this brief's own criterion**, having first been listed in error:
`2026-09-06-link-substring-is-not-a-row-match` (0 mismatches over **481**) and
`2026-09-16-agreement-gate-is-15x-coarser-than-sigma` (0 flagged over **117**). Both well-denominated.
Recorded rather than quietly dropped, because an inconsistently applied criterion is the same defect
class this brief is about.

### 6.1 · Incidental — a third epoch count for the ACC respiratory paper

Not an absence row; surfaced while widening the cohort check:

| artifact | epochs |
|---|---|
| the paper, and its served copy | **18,856** |
| the papers audit table | **19,193** |

Material to `2026-09-02-motiondex-epoch-count-disagrees`, whose evidence cites the paper and two other
surfaces. Recorded here; not acted on.

---

## 7 · Done when

- [x] Population pinned to a sha, with the growth rate that makes bare counts provisional
- [x] Criterion stated incl. the well-denominated exclusion; all 97 cells read (census, not sample)
- [x] 12 of 15 verified, each surviving verdict carrying a positive control
- [x] "Wrong when logged" separated from "stale window" as its own finding (section 1)
- [ ] The 3 unverified rows — needs a browser run and two seam checks
- [ ] New row for 1.2's narrower live-capture claim; old row closes pointing at it
- [ ] Section 5's gate-tracked state — **owner**, vocabulary change not ours
- [x] Section 4's citation rot — measured (4.1); gate DECLINED on three independent grounds; already a row (`2026-09-06-brief-header-file-line-citations-rot`), so no new row is owed
- [ ] The citation CONVENTION (identifier over line) — **owner**, out of scope here

**No row's non-state cell was edited by this sweep, and no row was closed.** Rows are append-and-close;
the artifact of a wrong row is a brief section carrying the evidence, per #2623.

**Fleet-Session:** Magpie

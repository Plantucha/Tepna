<!--
  NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-II-2026-08-09-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-15 (**both halves EXECUTED** — §1 PulseDex, §2 GlucoDex; every "Done when" item met, no `KNOWN DEFECT` pin left in the group. See §1-RESULT and §2-RESULT) · **Created:** 2026-08-09 · **Follows:** `NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-2026-08-06-BRIEF.md` §3-RESULT · **Affects:** `pulsedex-dsp.js`, `glucodex-dsp.js` — both compute-path, both owing a re-bundle

# Two nodes fabricate coverage, and both are pinned in the gate that found them

`NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS` §3 asked for an envelope-tracking assertion on the four
ungated nodes. Building it found that **two of the four fail the contract the parent's §7 table said
they satisfied**. The measurements are in that brief's §3-RESULT and are not repeated here; this brief
owns the fixes, which were deliberately kept out of a tests-only PR.

Both defects are **live on real input**, not latent — this is the difference from the parent's §1, where
the fabricating branch fired 0 times in 616 files.

---

## 1 · PulseDex — `durMin` changes meaning by branch, and `coverage` defaults to 100

```js
const times = beatTimes(a, f.tsMs);
const durSec = times[N - 1] || (N * mean(a)) / 1000;
let coverage = 100;                                    // ← pulsedex-dsp.js:1213
if (f.tsMs && isFinite(f.tsMs[0]) && isFinite(f.tsMs[N - 1])) {
  …                                                    // only HERE is coverage measured
}
```

`beatTimes` returns a wall **span** when timestamps are present and a **cumulative RR sum** when they are
not. So `durMin` means ENVELOPE on one branch and DATA on the other — the same defect §1 of the
grandparent fixed in ECGDex, one branch away in a different node. Measured on a 45-minute twin with a
15-minute hole: **1800 s published against a 2699 s span**.

The `coverage = 100` default is the worse half. An untimed RR stream has no gap information at all, so
100 is not a conservative default — it is **a completeness claim made from the absence of evidence**,
which is the failure the Clock Contract §2.6 and this whole brief family exist to prevent.

**Shape of the fix** (a starting point, not a decision):

- `coverage` initialises to **`null`**, not 100. Absent ≠ complete. This is the change with the smallest
  blast radius and it is independently correct regardless of what happens to `durSec`.
- `durSec` on the untimed branch is a **data** measurement being published in an envelope field. Either
  publish `null`, or keep the number and rename what it means — but the two branches must not keep
  sharing one field name. Check `classifyRecording(a, f.t0Ms, durSec)` first: it consumes `durSec`
  immediately, so a `null` there has a consumer, exactly as the grandparent's `Math.max` trap did.

⚠️ **Do not "fix" this by requiring timestamps.** Untimed RR files are a real input class (the whole
`parseRRInput` vals-only path); the fix is to stop claiming what they cannot support.

## 1-RESULT · EXECUTED 2026-08-15

**Shipped as the brief's §1 asked, with one decision the brief left open resolved explicitly.**

| field | means | untimed RR | timestamped |
|---|---|---|---|
| `spanMin` | ENVELOPE — wall span | **null** | measured |
| `recordedMin` | DATA — what the beats account for | beat sum | beat sum |
| `coveragePct` | data ÷ envelope | **null** (was 100) | measured |
| `durationBasis` | which of the two `durationMin` is | `"beat-sum"` | `"envelope"` |

**`coverage` initialises to `null`** — the change the brief called independently correct, and it is. The
`wall > 0 ? … : 100` fallback on the *timestamped* path was the same fabrication one line down and went
with it.

**`durMin` deliberately KEEPS its value, and the brief's `classifyRecording` warning is why.** The brief
said to check that consumer rather than assume it — checked, and it does arithmetic on `durSec`
immediately (`durMin >= 20 * 60`, `durMin.toFixed(1)`), so a null there breaks classification for an
entire real input class. The second consumer is worse: `adaptEnvelopeNode` builds this node's Integrator
fusion window from the exported `durationMin`, so nulling it collapses that window to a **point** — which
is exactly the DEEP-AUDIT-III §6.2 regression HRVDex already paid for, where a 29-day export overlapped
nothing and dragged every other node's `intersectionMin` to 0.

So of the brief's two offered shapes — *"publish `null`, or keep the number and rename what it means"* —
this takes the second. The ambiguity was never the number; it was that **one name carried two meanings
silently**. Publishing both under their own names, plus a `durationBasis` discriminator, ends the silence
without re-opening a regression this family already closed once. `durationMin` is now documented as
"whichever `durationBasis` says", and `spanMin`/`recordedMin` are the unambiguous pair.

**The pins worked exactly as designed and are now CONTRACT.** Fixing the DSP reddened the gate group and
forced the two `KNOWN DEFECT (FOLLOWUPS-II §1)` assertions to be rewritten rather than quietly satisfied.
The replacements assert the *timestamped* branch carries the same three keys with the opposite verdicts
too — a discriminator wired on one branch only would leave a consumer just as unable to tell them apart.

**Compute-path obligations discharged, run rather than asserted** (CLAUDE.md §🔒): `computeHash
e8f4070fe122 → 67624a697ce1` and `manifestHash b0b504918c87 → 1c57b2ca0b66`, both MOVED, so
export-inertness is not available and was not claimed. All three fixtures regenerated with
`tools/regen-pulsedex-goldens.mjs` — **exactly the three new fields moved on each, no existing value
changed** — then `verifiedUnder` re-stamped after a green corpus run. `Data Unifier.html` and
`OverDex.html` rebuilt (they inline `pulsedex-dsp.js`), and `docs/PulseDex.html` with them.

**A finding that is NOT this brief's, surfaced by running its verification.** The re-stamp discharged
**five other nodes' pre-existing debt** — ECGDex, HRVDex, OxyDex, PpgDex and the Integrator were all
sitting UNVERIFIED on `main` before this branch existed, and it is not a side effect of this change:
`dex-contracts.js` is JSDoc-only and inlined in no bundle, and those five bundles are byte-identical to
`main`, so their `computeHash` today IS `main`'s. Measured directly against `origin/main`:

| node | main's computeHash | main's recorded verifiedUnder | |
|---|---|---|---|
| ECGDex | `a9b2b198f69f` | `c2a1071ff8a7` | STALE |
| HRVDex | `710ef1d9e5cf` | `61709b5fc1e3` | STALE |
| OxyDex | `4b53898ab54d` | `74e188da75c6` | STALE |
| PpgDex | `857c02f37ab8` | `91b09c830560` | STALE |
| Integrator | `3f72e7e03f92` | `95653b64ea78` | STALE |

This is `FIXTURE-VERIFICATION-GATE`'s design working, not failing: §3.3 (CI red) was deliberately
deferred because a corpus-less contributor cannot green it, so debt accumulates visibly until someone
holding the corpus runs the tool — and `tools/release.mjs` is the wall that stops it shipping. It does
mean **`release.mjs` would have refused to cut a release from `main` as it stood**, and that five
compute-path changes landed without their verification being discharged. Recorded here rather than
fixed elsewhere, because the discharge is already in this PR's diff and hiding it would be worse than
the width it adds.

*Incidental, and worth recording because it was the first real use:* the regen and verify tools resolved
the corpus from inside this worktree with `DEX_UPLOADS` unset — `▸ corpus: …/Tepna/uploads (primary
checkout (git --git-common-dir))` — which is `FIXTURE-CORPUS-REACHABILITY` (#1314), landed hours earlier.
Before it, this exact step is the one that would have reported the corpus absent.

## 2 · GlucoDex — `recordedSec` and `spanSec` are the same expression

```js
var _sec = Math.max(0, Math.round((_c[_c.length - 1].tMs - r.t0Ms) / 1000));
return { kind: 'continuous', spanSec: _sec, segments: [{ startMs: r.t0Ms, durSec: _sec }],
         recordedSec: _sec, nWithDuration: 1, n: 1 };
```

The comment above it reads: *"here `spanSec` and `recordedSec` agree BY MEASUREMENT, which is precisely
what the sparse case could not claim."* They agree by **construction** and cannot disagree. A CGM wear
with a 6 h sensor dropout reports **100 % coverage**; measured, the planted 21 600 s hole leaves no trace
at all — one segment, `nWithDuration: 1`.

The same comment names **HRVDex's sparse block as its sibling**, and HRVDex is the node that refuses
exactly this fabrication (*"the obvious fix — stamp `durSec = lastTMs − firstTMs` — would FABRICATE
COVERAGE"*). GlucoDex cites the right precedent and then does what the precedent forbids.

**Shape of the fix:** segment the cells on a cadence-derived gap threshold (GlucoDex already computes
`gapMin`/`activeMin` in `analyze`, so the information exists one function away — prefer reusing it over
a second gap definition), sum the segments for `recordedSec`, and set `nWithDuration`/`n` from the real
segment count. Keep `spanSec` as it is; it is correct.

⚠️ **`kind: 'continuous'` is itself the claim under question.** A wear with a 6 h dropout is not one
continuous segment. Whether the kind stays `continuous` with honest segments, or becomes conditional, is
part of this decision — not a detail.

## 2-RESULT · EXECUTED 2026-08-15

`recordedSec` is now the **sum of measured segments**, reusing the node's own gap definition rather than
inventing a second one as the brief asked: the cleaner already flags every gap cell (`FLAG.GAP` /
`GAP_LONG`) and already knows the cadence, so a segment is a maximal run of non-gap cells with duration
`cells × cadence` — the arithmetic `activeMin` uses one function away. `spanSec` is untouched. The two
can now disagree, which was the entire complaint.

**What it found on the real corpus.** The committed 28-day Lingo export claimed one segment covering
everything. It is four, and **20 400 s — 5.7 h — of dropout had been counted as recorded**:

```
recording.coverage.segments.0.durSec: 2449800 → 1206300
recording.coverage.segments.1: undefined → {"startMs":1776602520000,"durSec":35400}
recording.coverage.segments.2: undefined → {"startMs":1776643320000,"durSec":1165500}
recording.coverage.segments.3: undefined → {"startMs":1777819620000,"durSec":22200}
recording.coverage.recordedSec:  2449800 → 2429400      n: 1 → 4
```

⚠️ **`synthetic_glucodex_gap_golden` was asserting the defect over its own planted gap.** That fixture
exists because `FIXTURE-VERIFICATION-GATE` §4 added committed-input adversarial twins precisely so this
class could be caught in CI with no corpus — and it ran on every push, reproducing 258 900 s "recorded"
across a fixture built to contain a hole (now 209 100 s across 2 segments). **A committed adversarial
fixture only tests what an assertion asks of it.** The twin was doing its job; nothing ever compared its
coverage against its own gap. Worth carrying into the next audit that reaches for "we have a twin for
that".

**`kind` stays `'continuous'` — the decision the brief flagged as not-a-detail.** It names the sampling
MODALITY, not completeness: a CGM is a continuous monitor whether or not a sensor dropped out, exactly as
HRVDex's `'sparse'` names spot measurements. Completeness is what `segments`/`recordedSec` are for, and
folding it into `kind` would rebuild the conflation this fix removes. Checked rather than assumed:
nothing in the tree switches on `coverage.kind`; `adaptEnvelopeNode` reads `segments`.

**One deliberate convention change, bounded and gated.** A segment's duration is `cells × cadence`, not
`lastCell − firstCell`. The alternative gives a ONE-CELL segment `durSec: 0` — asserting nothing was
recorded when one sample was, the absent-vs-zero confusion HRVDex's block warns about — and it disagrees
with `activeMin`. The cost is that a gapless record's `recordedSec` exceeds `spanSec` by exactly the final
cell, because `spanSec` measures between sample INSTANTS while a cell covers a cadence of time. Bounded at
one cadence per segment, and asserted, rather than left to be found later as a >100 % coverage ratio.

**This reaches fusion, which is the part that matters beyond the export.** The segments travel to
`adaptEnvelopeNode`, which judges overlap on RECORDED time — so a CGM dropout stops counting as overlap
with another node. That mechanism is what DEEP-AUDIT-III §6.2 built; GlucoDex had been feeding it a single
whole-span segment, i.e. the mechanism was live and its input was the fabrication.

**Compute-path, computed not claimed:** `computeHash 2ab4fab25b6e → 5ad4d400eb4a`, `manifestHash
fa3e8d398d5a → cb3c4dd0e7d6`. 3 fixtures regenerated, `verifiedUnder` re-stamped after a green corpus
run; both orchestrators, `docs/GlucoDex.html` and the 4 analysis tools that inline `glucodex-dsp.js`
rebuilt.

**Both pins are now contract, and the group has none left.** Each of the two `KNOWN DEFECT` pins did
exactly what it was for: the fix reddened the group and forced a deliberate rewrite rather than a silent
pass.

## 3 · What both owe, and why they were not done in the gate PR

Each is a **compute-path** edit to a bundled DSP. Per `CLAUDE.md` §🔏 each owes: a `computeHash` move,
a re-bundle, golden regeneration (`tools/regen-glucodex-goldens.mjs` for GlucoDex, 3 fixtures;
PulseDex has `tools/regen-pulsedex-goldens.mjs`, 3), and a `verify-fixtures` re-stamp under the moved
hash. That is a different blast radius from a tests-only change and belongs in its own PR — one per
node, since they re-bundle independently.

**The gate is already written and already red-capable.** `tests/dex-tests.js`, group *"The four ungated
nodes — duration tracks the ENVELOPE on a gapped twin"*, pins both defects as characterization with a
`KNOWN DEFECT (FOLLOWUPS-II §N)` label. Both pins were **mutation-verified against their own fix**: making
PulseDex's `coverage` null and making GlucoDex's `recordedSec` measured each redden the corresponding
assertion. So whoever executes this brief will be told, by a failing gate, exactly which assertions to
update — the pins cannot be silently satisfied.

## 4 · Done when

- [x] **§1 EXECUTED 2026-08-15** — PulseDex's untimed branch publishes `coverage: null`, and the two
      meanings are resolved as TWO FIELDS (`spanMin` / `recordedMin`) plus a `durationBasis`
      discriminator. The `classifyRecording` consumer was checked, not assumed — and a SECOND consumer
      the brief did not name (`adaptEnvelopeNode`, which builds the Integrator window from the exported
      `durationMin`) is why `durMin` keeps its value. See §1-RESULT.
- [x] **§2 EXECUTED 2026-08-15** — `recordedSec` is the sum of measured segments, cut on the cleaner's
      OWN gap flags and cadence (no second gap definition). `kind` stays `'continuous'` deliberately — it
      names the MODALITY, and nothing in the tree switches on it (checked). The "BY MEASUREMENT" comment
      is replaced by one that states what the fields now mean. See §2-RESULT.
- [x] **BOTH did.** §1 `computeHash e8f4070fe122 → 67624a697ce1`; §2 `computeHash 2ab4fab25b6e →
      5ad4d400eb4a`. 3 fixtures regenerated each, `verifiedUnder` re-stamped after a green corpus run,
      orchestrators + docs + analysis tools rebuilt on both.
- [x] **All four pins converted, each in the PR that fixed its node** — and each fix reddened the group
      first, which is what the pins were for. §2's additions also carry a paired ALLOW (a GAPLESS wear
      must still report one segment and full coverage, or the segmenter is only finding damage) and a
      bound on the cells-×-cadence overshoot. **No `KNOWN DEFECT` pin remains in the group.**

## 5 · Explicitly NOT in scope

- **Adding `endEpochMs` to these nodes.** The grandparent's §7.3 routes that to each node's next
  behavioural re-bundle, and §7.2 weighs it honestly — that reasoning is unaffected by these two
  defects, which are about *coverage*, not about the clock end.
- **Re-auditing the other four nodes.** CPAPDex, HRVDex, OxyDex and PulseDex's timestamped path were all
  measured and all satisfy the contract; those assertions are the ratchet and need nothing further.

## Cross-references
- Parent: `NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-2026-08-06-BRIEF.md` §3-RESULT — the measurements.
- Grandparent: `NODE-EXPORT-DURATION-SEMANTICS-2026-07-27-BRIEF.md` §3 (the contract), §7 (the table
  these two rows falsify).
- The correct template, in-tree: HRVDex's sparse coverage block (`hrvdex-dsp.js`, DEEP-AUDIT-III §6.2).

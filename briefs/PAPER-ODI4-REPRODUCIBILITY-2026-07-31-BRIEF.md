<!--
  PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-04 · **Created:** 2026-07-31 · **Spawned-by:** `DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md` §AD-1a · **Spawns:** `SYNTH-GEN-DESAT-KINETICS-2026-08-01-BRIEF.md` (the fix; this brief cannot close until that one does)

# `papers/odi4-ahi-bias.html` Table 1 does not reproduce, and its input corpus is gitignored

## 1 · What is established

`odi-bias-analysis.js`'s SubjectA path — the one the paper names as its reproduction recipe
(*"open `odi-bias-analysis.html` → Run SubjectA corpus (5 synthetic nights)"*) — was **broken** from the
day `ESM-MIGRATION-FOLLOWUPS-II` removed `oxydex-dsp`'s bare-global spray until 2026-07-31. Its
`parseCSV`/`processNight` calls threw `ReferenceError` inside a `try/catch` that read the failure as
"no usable data", so the page populated an **empty table, silently**. That is fixed.

With the path restored, running it on the corpus currently on disk gives:

| night | ODI-4 today | published "after" (Table 1) | published "before" | reference AHI |
|---|---|---|---|---|
| 1 | 5.6 | 12.0 | 6.4 | 22 |
| 2 | **1.4** | **14.9** | 7.6 | 38 |
| 3 | 1.5 | 1.9 | 0.9 | 7 |
| 4 | 0.5 | 0.8 | 0.5 | 4 |
| 5 | 0.8 | 0.8 | 0.1 | 3 |

Today's values match **neither** the published before-column nor the after-column.

**The measuring apparatus is controlled.** The same headless realm reproduces the committed,
GATE-B-verified `OxyDex_2026-06-13_1056_summary.json` at `odi4.rate = 1.9` exactly, so the mismatch is
not an artifact of running outside the browser page.

## 2 · What is NOT established — and must not be asserted

**The cause is unknown, and the published numbers are not claimed to be wrong.** They were computed when
the path worked. Two candidates, neither excluded:

- **(a) The inputs changed.** `uploads/synthetic/` is **gitignored**, so the five
  `O2Ring S 2100_*.csv` files on any given machine are whatever `synth-gen` last wrote there — not a
  pinned artifact. `genSynthetic` has demonstrably moved since (`REM-STAGING-REDESIGN` corrected the
  Mayer wave from ~0.014 Hz to a real 0.1 Hz, which already forced the §EP-rest pins in the parent brief
  to be re-recorded). This is the **likelier** candidate: night 2 moving 14.9 → 1.4 is an order of
  magnitude, and no baseline-definition change plausibly does that.
- **(b) The detector changed.** The paper's before/after columns straddle `OXYDEX-ODI-CEILING-FIX`
  (trailing-mean → p90 ceiling baseline). A further change since would move the after-column.

Distinguishing (a) from (b) is the entire job, and it is a **one-line experiment once the inputs are
pinned** — which is exactly what is missing.

## 3 · The actual defect is provenance, not arithmetic

A paper whose reference corpus is gitignored cannot be reproduced by anyone, including its author on a
fresh clone. Every other known-answer in this repo is content-addressed
(`FIXTURE-PROVENANCE.json`: `hash(input) + manifestHash → hash(output)`); the pilot corpus behind a
*published* claim is the one that is not. That asymmetry is the finding, and it is worth more than the
five numbers.

## 4 · Done when

- [x] **DONE 2026-08-03 — committed as BYTES.** All ten artifacts are tracked at `uploads/`: the five
      `O2Ring S 2100_2026051*.csv` and the five `ground_truth_night*.json`. Verified 2026-08-04 by
      `git ls-files` (10/10) and by hashing — the pinned copies are byte-identical to the scratch
      `uploads/synthetic/` ones, which is precisely why the defect was invisible on the authoring
      machine and fatal on a clone.
## 6 · Executed 2026-08-04 — (b) is EXCLUDED, and the recipe was unrunnable for a second reason

### 6.1 · The detector did not move the numbers. The inputs did.

§2 called distinguishing (a) from (b) "the entire job". Run four detector vintages spanning the whole
window against the SAME on-disk inputs — `odi4.rate` per night:

| detector vintage | n1 | n2 | n3 | n4 | n5 |
|---|---|---|---|---|---|
| HEAD (2026-08-04) | 17.7 | 33.1 | 2.4 | 0.9 | 0.8 |
| `df2143c` 08-02 | 17.7 | 33.1 | 2.4 | 0.9 | 0.8 |
| `26810fd` 07-31 | 17.7 | 33.1 | 2.4 | 0.9 | 0.8 |
| `26810fd^` pre-07-31 | 17.7 | 33.1 | 2.4 | 0.9 | 0.8 |

**Bit-identical across every vintage.** Candidate **(b) is excluded**: no detector change in this window
moves ODI-4 at all. Yet the same code that existed on 2026-07-31 now yields 17.7/33.1 where §1 recorded
5.6/1.4 — so **the inputs changed**, which is candidate **(a)**, as §2 suspected.

The mechanism is datable: `uploads/synthetic/`'s five CSVs have mtime **2026-08-01 13:30**, i.e. rewritten
*after* §1's measurement — and 25 minutes *before* `3a8a6bf` *"rate-limit planted desaturations; the ODI-4
severity bias does not survive"*. So the corpus on disk today is itself **pre-rate-limit** and will move
again the next time anyone runs `synth-gen`. That is §3's point demonstrated rather than argued.

⚠ **This does NOT recover Table 1.** Today's 17.7/33.1 match neither the published after-column
(12.0/14.9) nor §1's 5.6/1.4. The paper's original bytes are gone; pinning makes the corpus reproducible
**from now on**, it cannot reconstruct what was never committed.

### 6.2 · The pin already existed — the reader was not using it

`.gitignore` allow-lists `uploads/O2Ring S 2100_2026051*.csv` + `uploads/ground_truth_night*.json`, and
all ten **are tracked**. But `odi-bias-analysis.js` read `DIR = 'uploads/synthetic/'` — a **gitignored**
directory. Both copies happen to be byte-identical on the authoring machine, which is exactly why this
went unnoticed: the defect only appears on a **fresh clone**, where `uploads/synthetic/` does not exist
and the paper's recipe fetches five 404s. Repointed to `uploads/`.

### 6.3 · …and even with the right path it could not run: `connect-src 'none'`

The built page set `connect-src 'none'`, so the browser **refused every fetch** and the SubjectA button
rendered an empty table with no error a reader would see. This is a *second*, independent cause of the
same symptom §1 attributed solely to the missing bare globals — the 2026-07-31 fix restored the
functions, but the page still could not reach its corpus.

Measured in a real browser (Playwright/chromium, served over http):

| CSP | result |
|---|---|
| `connect-src 'none'` | **0 table rows**, 10 CSP `Refused to connect` errors |
| `connect-src 'self'` | **5 nights, 5 rows, 0 errors**, fit `ODI≈0.95·AHI · R²=1.00` |

Fixed to `'self'`, which is **not** a new posture: `CPAPDex.src.html` already takes `'self'` for exactly
this reason, in the same words — *"this bundle fetches committed LOCAL sample files; 'self' still blocks
every REMOTE origin."* The no-network invariant (§📚) holds: same-origin cannot reach a CDN, a DOI or a
dataset.

- [x] **(a) vs (b) decided — see §6.1.** (b) excluded on four detector vintages; the inputs changed.
- [x] **DONE — (a). And it is now COMPUTED, not asserted (verified independently 2026-08-04).**
      §6 and the paper both *state* that the cause is the inputs. The stronger form is to hold the bytes
      fixed and vary only the detector, which needs no recovered corpus:

      | night | brief's 07-31 reading | **07-31 detector, today's bytes** | **today's detector, same bytes** | published |
      |---|---|---|---|---|
      | 1 | 5.6 | **17.7** | **17.7** | 17.7 |
      | 2 | 1.4 | **33.1** | **33.1** | 33.1 |
      | 3 | 1.5 | 2.4 | 2.4 | 2.4 |
      | 4 | 0.5 | 0.9 | 0.9 | 0.9 |
      | 5 | 0.8 | 0.8 | 0.8 | 0.8 |

      **Both detector versions agree to the digit on identical bytes**, and both are apparatus-controlled
      — each reproduces the GATE-B-verified `OxyDex_2026-06-13_1056_summary.json` at `odi4.rate = 1.9`
      exactly. So the detector explains **none** of the 07-31 → 08-04 movement, while the files' mtimes
      show them rewritten 2026-08-01 13:30. **(b) is excluded by measurement, not by argument.**

      ⚠ Worth stating plainly: this brief's own §1 "today" column (5.6 / 1.4 / …) is itself now
      irreproducible — the bytes behind it were overwritten a day later. The brief documented the drift
      and was then subject to it, which is the whole case for pinning in one line.

- [x] **DONE 2026-08-03 — corrected in place, the third outcome.** Table 1 carries the pinned corpus's
      single ODI-4 column with a caption stating the before/after columns were removed as unrecoverable
      rather than carried as unverifiable numbers. **Independently reproduced 2026-08-04** from a separate
      headless realm: 17.7 / 33.1 / 2.4 / 0.9 / 0.8 — **5 of 5 exact.**

- [x] **DONE — the recipe reads the PINNED path.** `odi-bias-analysis.js` `DIR` is `'uploads/'`; the only
      remaining `uploads/synthetic/` strings in it are the comment explaining why it must not be. All ten
      files it names are tracked, so the recipe no longer 404s on a fresh clone.

- [x] **DONE — the smoke leg exists and is a KNOWN-ANSWER, not a smoke test.** `tests/dex-tests.js`
      pins the per-night `{ odi4, ahi }` table against the committed bytes, so the published numbers and
      the corpus are bound together and CI re-derives them on every push. That is stronger than the
      "consider a smoke leg" this item asked for: a smoke leg proves the page runs, whereas this proves
      it still produces the published answer.

## 5 · Guardrails

- **Do not tune the detector to recover Table 1.** `OXYDEX-ODI-CEILING-FIX` §2c already set this
  precedent explicitly ("do not tune the surrogate to chase the simulator"); the same applies to chasing
  a published table.
- **Do not regenerate the corpus and quietly re-record the paper.** If the inputs moved, that fact is
  itself the result and belongs in the paper's methods.
- The ×1.1 surrogate is now gated by a known-answer leg (`nsrr-adapter · ingest · known-answer`), so any
  change to it will red the suite. That gate is not evidence about the pilot's numbers, only about the
  constant.


---

## 6 · §2 ANSWERED — 2026-08-01. It is **(a), the inputs**, and the mechanism is now measured.

### 6.1 · The discriminating experiment

§2 listed two candidates and excluded neither. One experiment separates them, by holding the inputs fixed
and varying only the code: **run the repository's earliest committed detector against today's corpus.**

| | night 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| detector at `176ea8c` (2026-07-01) on today's inputs | 5.6 | 1.4 | 1.5 | 0.5 | 0.8 |
| detector today on today's inputs | 5.6 | 1.4 | 1.5 | 0.5 | 0.8 |
| **published Table 1** | **12.0** | **14.9** | **1.9** | **0.8** | **0.8** |

**Identical.** The ODI-4 path has not moved since the repo's first commit, so candidate **(b) detector
drift is excluded** and **(a) the inputs changed** is what remains. Consistent with it: the corpus was
**never tracked in git at any point** — `git log --all -- uploads/synthetic/` is empty — so there is no
version of these files to recover, and the ground-truth JSONs record `ahiTarget` but **no seed and no
generator version**.

### 6.2 · The corpus is internally COHERENT — which is what makes the next part serious

A regenerated corpus could simply be mismatched to its ground truths. It is not:

| night | ahiTarget | planted events | min SpO₂ (raw) | % below 90 % |
|---|---|---|---|---|
| 1 | 22 | 169 | 85 | 3.4 % |
| 2 | 38 | 279 | 81 | 24.7 % |
| 3 | 7 | 55 | 89 | 0.1 % |
| 4 | 4 | 31 | 90 | 0.0 % |
| 5 | 3 | 23 | 91 | 0.0 % |

Severity ranks agree across every column. Night 2 really is the severe night. So the question becomes:
why does a night that spends **a quarter of itself below 90 %** score **ODI-4 1.4/h**?

### 6.3 · Because the detector rejects it — correctly

| night | desats found | excluded as artifact | kept | ODI-4 |
|---|---|---|---|---|
| 1 | 135 | **92** | 43 | 5.6 |
| 2 | 242 | **232 (96 %)** | 10 | 1.4 |

The synthetic desaturations fall too fast to be real. `SELFGATE.FALL_RATE_MAX` is 1.5 %/s because a
systemic desaturation is rate-limited by circulation and lung O₂ stores; the corpus reaches **4 %/s**, with
**32 % of one-second falls on night 2** past the ceiling (16 % on night 1, ≤ 4 % on the three mild
nights). A 4 %/s edge is a probe squeeze, and `selfGateDesat` is right to drop it.

Standing tool, so this is re-checkable rather than a one-off: **`tools/synth-desat-kinetics.mjs`** (raw
CSV only — no DSP, no bundle — so it cannot drift with the code it judges; `--selftest` pins its mirrored
constant against `oxydex-dsp`).

### 6.4 · The consequence for the paper, stated carefully

The generator plants more events on severe nights, so the artifact rejection **scales with severity** —
which reproduces a severity-dependent ODI-4 deficit *with no detector bias present at all*. That deficit
is the paper's central finding.

**This does not show the paper is wrong.** Its corpus is gone; whether it had the same defect is
unknowable. What is established is narrower and still serious: **on the corpus that exists today, the
paper's headline result is fully explained by an artifact gate correctly rejecting an unphysiological
fixture.** So the pilot no longer demonstrates the thing it claims, and a status banner now says so at the
top of `papers/odi4-ahi-bias.html`.

### 6.5 · Why Table 1 was NOT "corrected" to the new numbers

The obvious move — republish Table 1 as 5.6 / 1.4 / 1.5 / 0.5 / 0.8 — would be a **worse** false claim
than leaving it. Those numbers measure the self-gate rejecting a bad fixture; presenting them as the
pilot's ODI-4 result would dress a fixture defect as a physiological finding. Same reasoning as §5's
guardrail, one level up: don't tune the detector to the oracle, and don't publish the oracle's failure as
a result.

For the same reason **the corpus was not pinned in this pass**, though §4 asks for it: pinning is right,
but pinning *this* corpus would enshrine the defect as a content-addressed known-answer. Fix the
generator, regenerate, then pin — the order now specified in
`SYNTH-GEN-DESAT-KINETICS-2026-08-01-BRIEF.md` §4.

### 6.6 · Status against §4's Done-when

- [x] **(a) vs (b) decided** — inputs, by the era experiment in §6.1.
- [x] The §6 "Run it" recipe verified end-to-end (it was broken; fixed in the parent brief's work).
- [x] Paper carries an honest status banner naming what is and is not established.
- [x] **Corpus pinned 2026-08-03 (§7)** — the deferral's blocker (`SYNTH-GEN-DESAT-KINETICS`) has been
      **DONE since 2026-08-01**. Five nights + five ground truths committed as BYTES (3.8 MB, synthetic,
      no privacy bar), seed `424242`, `VERSION synth-gen/2.1`, hashes in the paper.
- [x] **Table 1 REPLACED 2026-08-03 (§7)** — not reproduced: the old corpus cannot be recovered, so the
      unverifiable before/after columns were removed rather than carried. One ODI-4 column from the
      current detector on the now-committed corpus, with a full provenance line.
- [x] **Smoke leg LANDED 2026-08-03 (§8)** — and it went to the NODE lane, not render-coverage: with the
      inputs committed it no longer needs a browser `fetch`. 12 assertions pinning Table 1's five ODI-4
      values and the planted AHIs, plus an anti-vacuity count. CI re-runs it every push.

**This brief stays open** and is now downstream of `SYNTH-GEN-DESAT-KINETICS`. The question it was
spawned to answer is answered; the remedy it prescribed turned out to have a prerequisite.

---

## §7 · EXECUTED 2026-08-03 — the corpus is pinned and Table 1 is replaced

### 7.1 · The deferral's blocker had been gone for two days

§6.6 deferred the pin behind `SYNTH-GEN-DESAT-KINETICS`. That brief has been **DONE since 2026-08-01**
with zero open items, so §6.5's prescribed order — *"fix the generator, regenerate, then pin"* — was
sitting at step 2 with nothing in the way. Fourth stale premise found this way; the pattern is always the
same, and always found by checking the tree rather than the status line.

### 7.2 · The paper was making a FALSE provenance claim

`papers/odi4-ahi-bias.html` told readers the pilot used *"the five **committed** synthetic overnight
O2Ring recordings"*. Checked three ways: **zero** SubjectA bytes in `origin/main`, **none** present in
`uploads/` on this machine, and the analysis page fetching five hardcoded filenames that resolve to
nothing on a clean checkout. The paper asserted reproducibility it did not have — which is §3's own
finding (*"a paper whose reference corpus is gitignored cannot be reproduced by anyone, including its
author on a fresh clone"*) sitting unnoticed inside the paper's own text.

### 7.3 · Pinned as BYTES, deliberately

§4 allowed either committed bytes **or** a recorded seed + version. **Bytes were chosen**, because a
recorded seed alone is effectively what existed before: the generator moved and the corpus died silently,
which is precisely why Table 1 stopped reproducing. Bytes cannot move without producing a diff. The seed
and version are recorded *as well*, so the regeneration recipe is documented and checkable — but the
bytes are the pin.

The default seed `424242` reproduces the **exact five filenames** the analysis page hardcodes, which is
itself a small confirmation that the recipe is the right one.

### 7.4 · Table 1 is REPLACED, not reproduced

The old corpus cannot be recovered, so its before/after columns are not reproducible by anyone. They were
**removed** rather than carried as unverifiable numbers — the third outcome §4 explicitly permits. What
replaces them is one ODI-4 column from the current detector on the committed corpus:

| night | ODI-4 (pinned) | planted AHI | ODI−AHI | previously published (after) |
|---|---|---|---|---|
| 1 | 17.7 | 22 | −4.3 | 12.0 (bias −10.0) |
| 2 | 33.1 | 38 | −4.9 | 14.9 (bias −23.1) |
| 3 | 2.4 | 7 | −4.6 | 1.9 (bias −5.1) |
| 4 | 0.9 | 4 | −3.1 | 0.8 (bias −3.2) |
| 5 | 0.8 | 3 | −2.2 | 0.8 (bias −2.2) |

**The severity-proportional under-count has largely flattened** — roughly constant at 2–5 events·h⁻¹
instead of growing to −23. **This is NOT evidence the detector improved.** The corpus changed at the same
time, and the desaturation-kinetics fix was made precisely because the earlier kinetics were unrealistic.
Two variables moved, so no before/after inference is available and the paper now says so in place. What
the new column supports is narrower and reproducible: *on a corpus anyone can re-run*, the residual
under-count is roughly constant.

### 7.5 · Still open

- The **smoke leg** for the SubjectA path (§4's last item). Now much cheaper than before — the inputs are
  committed, so a node-lane leg no longer needs a browser `fetch` or a gitignored corpus. Left for a
  separate unit rather than bundled here.
- The paper's **Figure 1** still renders from the analysis page and has not been regenerated against the
  pinned corpus; its caption describes the old calibration.

### 7.6 · §8 — the smoke leg, and why it could go to the node lane

§4 guessed this leg *"may belong to the render-coverage lane rather than the node lane"* because the
SubjectA path is browser-`fetch`-based. **Pinning the corpus removed that constraint**: the inputs are
committed, so the node lane reads them straight off disk via `pairCommitted` — the same path the OxyDex
equiv legs already use — and CI re-runs the whole thing on every push.

`ODI-4 pilot — the paper Table 1 numbers, on committed bytes` (12 assertions): each night's ODI-4 against
the value printed in Table 1, each night's planted AHI read from the **committed ground truth** rather
than retyped, an anti-vacuity count so a vanished corpus cannot leave the group silently green, and the
paper's shape claim (a roughly constant 2–5 events·h⁻¹ under-count, not a severity-graded one) asserted
as a bound.

Mutation-verified: `ODI_DROP: 4 → 3` reds it; removing the corpus wiring reds the anti-vacuity leg.

**CI caught a one-lane wiring on the first push** — node green, browser RED with exactly 6 failures,
because `env.odiPilot` existed only in `run-tests.mjs`. That is the failure `Dex-Test-Suite.html` already
documents for `motiondex-dsp` (*"it was in NEITHER lane… every source-mirror assertion silently had
nothing to read"*), and it is why this repo's rule is **both runners or neither**. Now wired in both.

**What it does not pin, deliberately:** the corpus BYTES. Flipping one SpO₂ sample of ~27 600 leaves every
rate unchanged to one decimal, so the gate survives that — a property of a per-hour index, not a hole.
Byte integrity is the ledger's job, and Table 1's caption carries the SHA-256 prefixes for it. This leg
pins the numbers; the hashes pin the bytes.

**The failure this closes.** Table 1 stopped reproducing for months and nothing noticed, because its
corpus was gitignored and its numbers were re-run by nobody. Both halves are now fixed: the corpus is
committed, and something re-runs it every push.

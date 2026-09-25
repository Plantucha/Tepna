<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** IN-PROGRESS (§3.1 answered 2026-09-18; **§3.2 consumers ENUMERATED and the PpgDex reader WIRED 2026-09-25, Kestrel** — the triage stamp earlier that day read "PpgDex ingests `_PPGRUNS.txt`" off the DSP signature, and enumerating the callers showed that `parsePPG(text, { runsText })` (#2316) was reached by NO production path: not the app drop, not either PPG adapter, not the Unifier's pairing — only a unit test. Worse, every RUNS/SEAMS sidecar name fell through both bare-name classifiers and was queued as a RECORDING. Both fixed in one unit (the §3.2 table names the wire per stream; gate group `SAMPLE-VALIDITY-ENVELOPE §3.2`, 16 assertions). What remains: the ECG, ACC and PPG2W sidecars are written by the box and read by nothing — one node unit each, ECG first; done-when 3 (a planted run reaches `null` and nothing else, across nodes), 4 (the unsafe read made impossible by a test) and 5 (parent §1.2 line updated). Owner: Kestrel, per the owner's 2026-09-24 greenlight) · **Residue:** 2026-09-25-ppg2w-routes-to-spo2 · **Created:** 2026-09-17 · **Promoted-from:** `BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md` §1.2 (whose §5 closes when 1.2–1.7 are each executed **or promoted**; this is the promotion, and §1.4's was the precedent) · **Owner:** unassigned · **Relates:** CLAUDE.md §∅ ABSENCE IS NULL (non-negotiable, owner-reinforced 2026-09-06), `signal-frame.js`, the sidecar shipped in #2317

> **Read §1 before sizing this.** The parent states the goal as *"the transport emits an envelope, not
> a scalar"*. Taken literally at the wire that **contradicts §∅**, which prescribes the opposite
> mechanism for the same problem and gives a cost reason. Reconciling the two is this brief's first
> task and probably most of its value; building anything before that is building the wrong thing.

---

## 1 · The contradiction to resolve FIRST

Two house rules answer one question, and they disagree about *where*:

| | says | mechanism |
|---|---|---|
| **CLAUDE.md §∅** | *"Validity must travel **OUT-OF-BAND** … records where the signal was absent in a **sidecar** (a span list is orders of magnitude smaller than the data), and consumers read the sidecar"* | sidecar beside immutable bytes |
| **parent §1.2** | *"The transport emits an **envelope, not a scalar**: `{value, validity, device_seq, host_monotonic, host_wall}`. A consumer cannot obtain a number without also obtaining its validity, because no other shape exists to read"* | per-sample envelope |

**They are not actually in conflict, and the resolution is the design.** They answer different
questions that the word "transport" fuses:

- **Storage** is settled and must not be re-litigated. §∅ is non-negotiable, owner-reinforced, and its
  cost argument is decisive: a per-sample envelope on disk multiplies a 127-sample frame by the size of
  a struct, for a stream whose absence is 149 runs in 3048 samples. **Captured bytes are immutable
  evidence.** The sidecar stays.
- **Consumption** is what §1.2's Done-when actually asks for — *"no consumer can reach a sample value
  without its validity"* — and that is a **TYPE** property, not a storage format. It is satisfiable
  with the sidecar underneath.

So the working hypothesis to verify, not to assume: **sidecar on disk → validity view in the frame →
no DSP reads a raw sample array again.** If that composition holds, this unit is a boundary change,
not a format change, and the parent's *"cost: real"* framing belongs to §1.1, not here.

⚠️ **Verify that hypothesis against the code before designing on it.** `signal-frame.js` today carries
`sqi`, `usable` and `reason` **per FRAME**; the sidecar carries validity **per SPAN**; §1.2 wants it
**per SAMPLE**. Three granularities, and nobody has checked that the middle one can serve the other
two without a per-sample allocation the frame currently avoids. That check is §3's first step.

---

## 2 · The evidence, already measured — do not re-derive it

From the parent, and from the 2026-09-06 all-hands:

- O2Ring `_PPG.txt`, 2026-09-05: **3048 samples of exact `0` in 149 runs**, 105 of them ≥ 10
  consecutive, longest 78 samples (0.62 s), against a modal baseline of 114–119 — **in-band blanking
  inside complete 127-sample frames**, not a delivery gap.
- **Every fixture reproduced it faithfully, so every gate was green.** That is the shape of the defect:
  the bytes are honest (`oxyii.py` `parse_ppg` returns the payload untransformed, `capture.py` `run_oxyii` writes it
  through), and what was missing was an interpretation layer.
- `∅ ABSENCE IS NULL` held for two thousand commits **everywhere someone had written it down** — Clock
  Contract §2.6's stamps, `parse_live`'s scalar ranges — and failed in the one path where nobody had.
  **That is the argument for a type over a convention**, and it is the whole case for this unit.

---

## 3 · The work, in the order that stops it being the wrong work

1. ~~**Reconcile the three granularities**~~ ✅ **ANSWERED 2026-09-18 — YES, and cheaply. Measured on
   a real night (2026-09-17, all six sidecars), not reasoned about.**

   | stream | spans RECORDED | runs detected | samples examined |
   |---|---|---|---|
   | H10 `_ACC` | 0 | 3,751,708 | 4,485,636 |
   | Verity `_ACC` | 0 | 973,354 | 1,119,120 |
   | Verity `_PPG` | 0 | 1,225,602 | 1,225,940 |
   | O2Ring `ACCRAW` | 0 | 31,828 | 221,225 |
   | O2Ring `PPG2W` | 0 | 4,413,253 | 4,416,362 |
   | O2Ring `_PPG` | **4** | 1,462,153 | 2,787,279 |

   **k = 4 spans across the whole night and all six streams.** So a per-sample validity view is
   `is index i inside any recorded span?` — O(log k) with O(k) memory, and with k=4 the allocation
   question the step was framed around simply does not arise. The middle granularity serves the other
   two, and the composition §1 hypothesised holds.

   ⚠️ **The millions of "runs" are NOT absence events** and it would be easy to read them as such:
   `mean_run=1.91`, `class=variable` — that is the natural run-length structure of a varying signal.
   Only runs ≥ `min_run=200` are RECORDED, which is the §∅ rule keying on run length rather than on
   value membership.

   ⚠️ **THE REAL LIMIT, and it is what the validity view may and may not claim.** Because the writer
   records only runs ≥ 200 samples, a view derived from the sidecar says *"valid unless a LONG
   blanking run was detected"* — NOT *"valid"*. Blanking shorter than the threshold is not in the
   file and a consumer will read those samples as good. That is a deliberate trade (a threshold keyed
   to run length is what separates blanking from a beat marker), but the envelope must state it
   rather than let `validity: true` imply more than the sidecar can support.

   **The four spans are also a working demonstration**, which is why this is a measurement and not a
   formality: one 1992 ms run at `first_index=0` (ring warmup) and three at 04:18–04:23, all
   `closed=0`, i.e. still open when recording stopped — the doff at the end of the night. The detector
   caught exactly what it was built for, and tonight was otherwise clean.
1b. **THE FORMAT, AS SHIPPED — a description, not a design.** The writer half already exists and
   runs on every stream (`_RunSidecar`, writers.py; retrofit #2317, end-of-night back-check #2315),
   which is why §3.1 could measure a real night across all six sidecars. Written down here because
   it is the contract between the writer and the node-side reader, and a reader must not infer it
   from a sample file.

   - **Placement and name.** Beside the stream, never inside it: `<base>.txt` → `<base>RUNS.txt`,
     the rule `_SeamSidecar` mirrors for `SEAMS`. A stream with no entry in `RUN_MIN_BY_STREAM`
     (currently `ppg1 · ppg · ppg2w · acc · accraw`, all at `T_STUCK`) has **no file at all**.
   - **Record.** `Phone timestamp;stream;value;first_index;n_samples;dur_ms;closed;rule;bracket;contact`
     — one row per recorded run. `first_index` and `n_samples` are in the **stream's own sample
     index**, so a consumer answers *"is sample i inside any span?"* without a clock.
   - **Header.** One `#` line carrying the rule that produced the rows (`rule=stuck min_run=200
     t_stuck=200 …`), so the file states its own threshold rather than a reader assuming this
     release's constant. `#` lines fail every row filter, the shape `# timebase=` uses.
   - **`closed=0` means the span was STILL OPEN when recording stopped** — it is not a zero-length
     span and not an error. Three of §3.1's four spans are `closed=0`: the doff at the end of the
     night. A reader must treat an open span as running to the end of the stream.
   - **⚠️ The claim the file supports is narrower than "valid".** Only runs `≥ min_run` are recorded,
     so the sidecar supports *"valid unless a LONG blanking run was detected"*. Blanking shorter than
     the threshold is **not in the file** and a consumer will read those samples as good. That is the
     deliberate §∅ trade — keying on run length is what separates blanking from a beat marker — and
     the envelope must state it rather than let `validity: true` imply more than the file can carry.
   - **⚠️ AN ABSENT SIDECAR IS "VALIDITY UNKNOWN", NEVER "NO ABSENCES".** This is §∅ one layer up, and
     it is the reader's single most important branch. A file is missing for reasons that are not
     equivalent: the stream is not in `RUN_MIN_BY_STREAM`; the capture predates #2317; the sidecar
     could not open (the writer keeps recording and counts it in `errors`). None of those is evidence
     that the night was clean. An EMPTY sidecar is different and is informative: it has a header, so
     it says what was looked for and that nothing met the threshold.
   - **Provenance is not yet in the record.** Who observed the run — emitter, capture path, or the
     end-of-night back-check — is not a column today. A reader must not infer it; if it becomes
     load-bearing it is an additive column, and this bullet is where that gets recorded.

2. ~~**Enumerate the consumers, do not guess them.**~~ ✅ **ENUMERATED 2026-09-25 (Kestrel) — by the
   INGEST ENTRY POINT per sidecar stream, which is where a sidecar can attach, rather than by every
   downstream `rec.ch` read (80 in `ppgdex-dsp.js` alone, all fed by one parser).** Read off
   `capture-host/writers.py RUN_MIN_BY_STREAM` (what is written) and `git grep` of the root `*.js` (who
   parses which file):

   | stream (writer) | sidecar | parse entry the sidecar must reach | reads it on `main` |
   |---|---|---|---|
   | `ppg` Verity 3-LED | `…_PPGRUNS.txt` | `ppgdex-dsp.js parsePPG` ← `ppgdex-app.js` drop · `adapters/polar-sense-ppg.js` · Unifier/OverDex `pairCompanions` | **YES — from this unit.** The DSP took `opts.runsText` since #2316 and **no production caller passed it** (the app grouped acc/gyro/magn/ppi/marker only; both adapters called `parseFn(text)`; the Unifier had no `runs` kind; the only test drove `parsePinnedRuns` directly) |
   | `ppg1` O2Ring finger | `…_PPGRUNS.txt` | same parser ← `adapters/o2ring-ppg.js` | **YES — from this unit** |
   | `ppg2w` O2Ring dual-wavelength | `…_PPG2WRUNS.txt` | `oxydex-dsp.js parsePPG2W` ← OxyDex's own drop handler. The `ppgdex-dsp.js` dual path is **DEAD** — see the enumeration below | **YES — #3070** |
   | `acc` Polar H10 / Verity | `…_ACCRUNS.txt` | `ecgdex-dsp.js parseDeviceACC` · `ppgdex-dsp.js` / `motiondex-dsp.js parseSensorXYZ` | **NO** |
   | `accraw` O2Ring | `…ACCRAWRUNS` | no root `*.js` parses ACCRAW at all | n/a |
   | `ecg` Polar H10 | `…_ECGRUNS.txt` | `ecgdex-dsp.js parseECGText` ← `ecgdex-app.js` · `adapters/polar-h10-ecg.js` · `dex-ingest.js planIngest` | **NO** |

   ⚠️ **THE `ppgdex-dsp.js` DUAL PATH IS DEAD FOR `ppg2w` — enumerated by EXECUTION, 2026-09-25 (Magpie).**
   This cell named two entry points and the second one cannot be reached. `ppgdex-dsp.js` really does accept
   two channels (`parsePPG`: *"TWO channels are accepted ONLY as the O2Ring's raw dual-wavelength
   `_PPG2W.txt`"*), so the code exists — nothing routes a file to it. Every route was RUN against
   `Wellue_O2Ring_…_PPG2W.txt`, each with the `…_PPG.txt` control beside it so a null answer is about the
   subject and not the harness:

   | route | `…_PPG2W.txt` | control `…_PPG.txt` |
   |---|---|---|
   | `DexIngest.ppgKind` (PpgDex app drop) | **`'skip'`** | `'ppg'` |
   | `DexIngest.foreignKind` | `'spo2'` | — |
   | `DexIngest.planIngestPpg` | **0 ppg primaries**, set aside as `spo2` | 1 primary |
   | `adapters/o2ring-ppg.js` `detect` | **0** | **0.97** |
   | `adapters/polar-sense-ppg.js` `detect` | **0** | 0 |
   | `SignalAdapters.route` best | `oxydex-spo2` @ 0.95 — *not* a ppg adapter | `o2ring-ppg` @ 0.97 |
   | `SignalOrchestrate.streamKind` (Unifier/OverDex) | **`null`** | `'ppg'` |
   | `SignalOrchestrate.pairCompanions` | **`null`** for the whole set | pairs |

   The cause is one regex shared by all of them: the stream suffix is matched as `_PPG\b` / `_PPG\.`, and
   `_PPG2W` has a word character after `PPG`, so neither alternative fires. That is the SAME cause as the
   sidecar misclassification recorded in the next paragraph — appending to the stream suffix defeats the
   boundary — reaching a different file. So the dual path needs no sidecar: it needs a router that can see
   the stream at all, and that is a separate decision (open the route, or delete the dual path), not a
   validity-envelope item. **Tripwire, not deletion:** `tests/dex-tests.js` now asserts each cell above, so
   the day a route DOES reach `ppgdex-dsp` with a `_PPG2W.txt` the suite reds and names this row — the
   sidecar is then owed by whichever route opened.

   ⚠️ **A SEPARATE, LIVE FINDING FELL OUT OF THAT ENUMERATION** (residue `2026-09-25-ppg2w-routes-to-spo2`):
   `SignalAdapters.route` hands the raw 125 Hz dual-wavelength WAVEFORM to **`oxydex-spo2` at 0.95 with no
   runner-up**, so it is not even flagged `ambiguous`. That is the §1.4 tie `adapters/o2ring-ppg.js`'s own
   header describes — *"`oxydex-spo2` matched the vendor token alone and claimed BOTH at 0.95"* — fixed for
   `_PPG.txt` and still open for `_PPG2W.txt`, where there is no competitor to tie with. What
   `oxydex-spo2.parse` then DOES with it is **NOT MEASURED**: the probe returned a null frame for the real
   SpO₂ CSV control too, so that harness cannot answer the severity question and its silence is not a
   negative (§4b). Measuring it needs the real host page.

   ⚠️ **And the sidecars were being INGESTED AS WAVEFORMS.** Measured 2026-09-25 before any fix:
   `DexIngest.ppgKind('Polar_VS_…_PPGRUNS.txt')` → `'ppg'` and `ecgKind(…)` → `'ecg'`; the same for
   `_ACCRUNS`, `_ECGRUNS`, `_ECGSEAMS` — the name is built by APPENDING to the stream suffix, so `_PPG\b`
   never matches it, no companion suffix matches it, and both classifiers fell through to their
   bare-name default. A night-folder drop queued every sidecar as a recording in PpgDex AND ECGDex; only
   the O2Ring's `_PPG2WRUNS` escaped, via the vendor pattern. This is the `PMDARRIVAL` / DEEP-AUDIT-VI
   F12 class a fourth time. Fixed in the same unit (`nonSignalName` sets RUNS/SEAMS aside; `ppgKind`
   claims `_PPGRUNS` as the `runs` companion first), gate-backed by the `SAMPLE-VALIDITY-ENVELOPE §3.2`
   group in `tests/dex-tests.js` — classification, planner eligibility, Unifier pairing, a planted
   sidecar populating `rec.pinnedCrossCheck` (null without one), and source-mirrors on the three callers.
   `trace-to-the-consumer`: a mechanism's consumers are the deliverable, not the site you wrote. The
   remaining three readers (ECG, ACC, PPG2W) are each a node unit that moves that node's `computeHash`
   and re-verifies its fixtures; stage per node, ECG first (its sidecar is `ECG_RUN_MIN`-keyed and the
   H10 saturation work already reasons about runs).
3. **Make the unsafe read impossible, not merely discouraged.** A guard a consumer may bypass is a
   convention again, which is the thing that failed. Whatever the shape, the acceptance test is that a
   reviewer cannot write the old code by accident.
4. **A planted blanking run propagates to a `null` metric or a coverage-annotated one, and to nothing
   else** (the parent's Done-when, kept verbatim).

---

## 4 · What this brief deliberately does NOT decide

- **Whether the wire format changes.** §1's resolution says it should not; that resolution is a
  hypothesis until step 1 checks it.
- ~~**Whether a consumer REFUSES or annotates.**~~ 🟢 **ANSWERED — owner ruling 2026-09-17, recorded in
  `CLAUDE.md` §∅ because it is fleet doctrine and not this brief's to own: a DISCONTINUITY refuses
  (`null` + a named reason); reduced COVERAGE annotates (the value, with `n` / the covered span).** The
  line is whether the window still describes ONE continuous stretch of signal, not how much is missing.
  So this brief no longer has to hold that question open, and **it is now an INPUT to §3 rather than an
  output**: a blanking run is discontinuity, therefore a planted run must reach a `null`, and the
  "or a coverage-annotated one" half of §3.4 applies to sparse windows, not to blanked ones.
  ⚠️ It does not generalise. §1.7's refusal for adapter leases stays declined — there the loss is a
  night's CAPTURE, here it is declining to publish a meaningless number.
- **Migration cost.** A change at the DSP read boundary moves `computeHash` on every node that adopts
  it, so every fixture re-verifies. Stage per node; OxyDex first, as the roadmap does.

---

## 5 · Sequencing

**Not concurrent with `BLE-TIMEBASE-AT-THE-EDGE`'s residue** (they share the refuse-or-annotate
question) and **not concurrent with the measurement-instance contract**
(`MEASUREMENT-INSTANCE-CONTRACT-2026-09-17-BRIEF.md`), which adds a `quality` block to the export and
would collide on the same semantics. This is a THIRD statement of one idea — validity travelling with
a value — at a third granularity; whoever picks up the second should read the other two first.

## Done when

- [x] §3.1's reconciliation is written and checkable — **answered YES 2026-09-18** with k=4 measured on a real night, and the real limit (records only runs ≥ 200 samples) stated in §3.1.
- [x] The consumer set is ENUMERATED, not asserted — **2026-09-25, §3.2's table**, and the enumeration is what found the reader with no caller and the sidecars ingested as waveforms.
- [ ] A planted blanking run reaches a `null` or coverage-annotated metric and nothing else.
- [ ] No consumer can reach a sample value without its validity — demonstrated by a test that fails
      when the old read is reintroduced, not by inspection.
- [ ] The parent's §5 is re-read and its §1.2 line updated to record this promotion.

## Cross-references
- Parent: `BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md` §1.2 · sibling promotion: `BLE-TIMEBASE-AT-THE-EDGE-2026-09-16-BRIEF.md` (§1.4).
- Doctrine: `CLAUDE.md` §∅ — non-negotiable, and the source of §1's cost argument.
- Shipped retrofit: the sidecar (#2317) + the end-of-night back-check (#2315).
- Adjacent contract: `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17-BRIEF.md` (validity at the MEASUREMENT granularity).

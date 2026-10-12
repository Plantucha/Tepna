<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-10-12 · **Created:** 2026-10-04

# PAT-HAT-RING-FLOOR — the finger leg joins the arrival-floor axis, and the hat is solved on three floors

> **Owner, 2026-10-04 (relayed by Kestrel):** E11's consumer side, approved in advance — *"the finger leg
> placed on the ring's arrival-FLOOR axis, the page's RAW card replaced by the corrected/raw pair with both
> σ sets, the Verity corner re-solved on the corrected legs, and the hat brief updated with the first
> corrected night as evidence."*

Rule 0: `node tools/doc-search.mjs --read "corrected PAT three-cornered hat: finger leg on the arrival floor
axis, raw vs corrected sigma, Verity corner"` → `briefs/RESIDUE.md` (0.681), `pat-classic-vs-fused.js`
(0.656), `briefs/PAT-HAT-DRIFT-DIFFERENCED-2026-09-27-BRIEF.md` (0.634), `pat-feasibility.js` (0.634). The
consumer side is unbuilt; the capture side landed today as #3267.

**A new brief rather than an edit to `PAT-HAT-DRIFT-DIFFERENCED-2026-09-27-BRIEF.md`, which is DONE and
verified.** That brief's acceptance items were all met; this is a different unit with its own acceptance,
and reopening a DONE brief to carry it would make its status a lie. It closes that brief's residue row
(`2026-09-28-ring-has-no-arrival-floor-axis-so-no-corrected-pat-hat`) and is linked from it.

## What was true until #3267

Both PAT pages solve the hat on RAW receive stamps, so **every corner's σ includes its device's link
buffering, not only pulse timing** — labelled on both pages since #3195, never corrected. The H10 and the
Verity write `_PMDARRIVAL.csv`, which puts chest → ankle on the arrival-floor axis (#3150); the ring had no
arrival sidecar at all, so the finger could not join. Measured on the 2026-09-26 trio night with the two
Polar sidecars only: chest → ankle **raw 499 ms vs corrected 342 ms** (156 ms of buffering removed), and
with the finger left RAW, chest → finger **471 ms > chest → ankle 342 ms** — the ankle pulse reading
*before* the finger one — while finger → ankle coupled **571 of 22,655 beats = 0 windows**. A hat cannot be
solved across mixed axes, and the pages say so instead of mixing them.

## The design, and the one thing that decides it

`floorMap` keys each packet on its **last** sample's device stamp (`c[4]`, `last_sensor_ns`) and requires
`d > 0`. The ring has no clock, so E11 writes those two columns BLANK — and `+"" === 0` in JS, so the
existing guard already skips every ring row. **No fabricated zero can enter the floor through the existing
path**; the ring needs its own key, and E11 wrote exactly the one it needs.

**TWO counters exist for the ring's PPG, and only one of them may anchor a floor:**

| counter | what it is | may it anchor? |
|---|---|---|
| `_PPG.txt`'s `sensor timestamp [ns]` column | the HOST-SYNTHESIZED 125.000 Hz grid (`O2PpgGrid`), anchored on the session `t0`, with honest gaps inserted from ELAPSED HOST TIME (`capture.py:954` — *"grid position of the NEXT sample — counts inserted gaps, not just arrivals"*) | **NO.** It is derived from the host clock, so a floor taken against it measures partly its own construction. Clock Contract §7: a stream whose inter-sample deltas are ≥99 % one value was DRAWN and is never a clock — this grid is 8.000 ms by construction. |
| the sidecar's `first_sample_idx` | the RING's own cumulative stream position (`oxyii.ppg_stream_offset`, `[20:24]` u32 LE), as the device reports it | **IN PRINCIPLE YES — IN FACT THE FIELD IS DEAD ON THIS RING.** See the correction below. |

### 🔴 CORRECTION, 2026-10-04 evening: the field this brief anchors on is device-dead

Measured after this brief was written (Wren, two independent witnesses; I confirmed the second myself):
**`ppg_stream_offset` is ZERO on every frame this ring has ever sent.** 819 `*_OXYFRAME.txt` files from
2026-07-25 to 2026-10-04 carry no nonzero `ppg_offset` row, and the committed real frame
`tests/test_oxyii.py::_REAL_PPG_FRAME` reads `[20:24] = 00000000` while its `[0:4]` duration says
**10,719 s** — a frame three hours into a session reporting position zero. The firmware never fills the
vendor's field.

**What this does NOT mean.** No wrong floor was ever produced. Measured on all-zero rows, both halves
already refused: `ringDevColumn` returned *"positions overlap or go backwards at frame 1 (0 after 126)"*
and `floorMap` returned *"0 usable 10-min floor window(s) … refused as smeared, median spread 6000.0 ms"*.
The design's refusals held; what they lacked was a reason a reader could act on, since both describe a
corrupt capture rather than a permanent property of the device.

**What it does mean.** The finger leg is **absent on this ring, structurally**, until some other device
position exists. `ring-offset-never-advances` now says so by name, keyed on NON-ADVANCE rather than on
the value 0 — because `ppg_stream_offset`'s own docstring records that *"0 is a real offset — it is what
the first frame of a session reports"*, so a value-keyed detector would refuse a legitimate first frame,
and §∅ says to detect by the stream's own behaviour and not by value membership.

**And `126 × frames` is NOT a substitute.** `O2RING-PROTOCOL` §3b measured N = 126 samples per status
frame as a lock, where `126 × frames − samples` gives the exact dropped count. That works as a LOSS
measure because it compares two host-side quantities to find drops *inside delivered frames*. As a floor
anchor it is a host-maintained sum in disguise: there is no device-side frame counter — we count replies
RECEIVED — so a frame lost in transit makes the product under-count by exactly 126, which is precisely
the dropout an arrival floor exists to expose. A position that cannot see a dropout cannot anchor a floor.

**Acceptance item (b) of RING-POLL-SPLIT is therefore blocked on the same probe**: with `0x04`'s offset
dead, the 0x03 header probe (P1) is the only remaining candidate for a device position on this ring.

So the finger leg's device axis is `first_sample_idx / O2PPG_FS`, and the per-frame floor is
`arrival − (first_sample_idx + n_samples − 1) / O2PPG_FS` — keyed on the frame's LAST sample for the same
reason `floorMap` already is: the first sample also carries the frame-fill time, which smears any stream
whose frame size varies (measured 2026-09-27: Verity acc 118 → 11 ms spread when keyed on last).

**Mapping feet to device positions uses the sidecar, never the grid.** An honest gap writes NO rows — the
survivors are not compressed, the grid index jumps — so a file row index is not a device position whenever
a gap exists. The sidecar's frames are delivered in order and each declares `(first_sample_idx, n_samples)`,
so walking them converts the k-th delivered sample in the file into an exact device offset. **It refuses**
when `Σ n_samples` over the frames does not equal the file's row count: a mismatch means the accounting
differs and a position cannot be mapped, which is the same refusal the ECG and Verity legs already carry.

## Acceptance

- [x] The finger leg is placed on the ring's arrival-FLOOR axis from the sidecar's own counter, never the
      synthesized grid, and refuses with a NAMED reason when the frame accounting does not match. #3270,
      #3274. The named reason reaches a reader as of 2026-10-12 — see the section below; until then
      `floorMap`'s refusal masked it on every real night.
- [x] Both pages (`pat-feasibility.js`, `pat-classic-vs-fused.js`) replace the RAW card with the
      corrected/raw PAIR, both σ sets shown, neither presented as a delta. #3270.
- [x] The Verity corner is re-solved on the corrected legs — `threeHat(cpFCorr, cpCorr, cpFACorr)`. Built
      and reachable in the chest → ankle corrected coupling; `threeCorr` itself is unreachable on this
      firmware, because its finger leg never solves. Stated, not hidden.
- [x] The regression gate is green and the plant drives a SYNTHETIC frame-arrival sequence — still
      synthetic, and now BY FIRMWARE rather than by the capture's age: eight real nights exist and all of
      them exercise only the refusals.
- [x] Residue `2026-09-28-ring-has-no-arrival-floor-axis-so-no-corrected-pat-hat` closed `fixed #3267`.

## ⚠️ What this brief may NOT claim yet (HISTORICAL — answered below on 2026-10-04, and over the whole population on 2026-10-12)

**No existing night carries a ring arrival sidecar.** E11 landed in #3267 today and the writer runs in the
daemon, so the first `PPG_FRAME` rows exist only after the box restarts on it — the owner's deploy. Until
then:

- the plant is a **synthetic frame-arrival sequence**, stated as such;
- the evidence line below stays OPEN, and no corrected finger number may be quoted;
- one question is **unanswerable until a real night exists**: whether `ppg_stream_offset` advances across a
  dropout (the ring kept sampling and frames were lost in transit) or only counts delivered samples. If it
  advances, the floor sees the dropout as real lost device time, which is correct; if it does not, a
  dropout compresses the device axis and the floor reads a step. The implementation must therefore REFUSE
  on a step rather than interpolate across it, and the first real night decides which behaviour the ring
  has. This brief does not guess.

**Evidence (first corrected night): 2026-10-04, and it ANSWERS the open question — the offset does NOT
advance.** Measured read-only on the rig mirror
(`/srv/data/tepna-corpus/smoketest-captures/2026-10-04`, ring session `…20261004220023`): across the whole
night `first_sample_idx` has **ONE distinct value, 0** — on **22,645 of 22,645 `PPG_FRAME` rows** and on all
**2,407 `PPG_FRAME_A` rows**. The question this brief refused to guess at ("whether `ppg_stream_offset`
advances across a dropout … the first real night decides which behaviour the ring has") is therefore
settled in the second direction: a dropout COMPRESSES the device axis, so a floor built on this field would
read a step as elapsed device time.

**So the hat on this night is TWO corrected floors plus ONE NAMED REFUSAL, not three.** The finger leg
refuses as `ring-offset-never-advances`, which is this brief's designed outcome rather than a failure, and
**no corrected finger σ may be quoted** — for this night or any night from this firmware. §∅: the refusal
carries its own reason rather than borrowing the ankle's.

The raw hat on the same night, as ONE recording (22:02 → 04:15, n = 38 five-minute windows): σ chest
**77.5 ms**, σ finger **165.7 ms**, σ ankle **REFUSED (negative variance −5183)**. ⚠️ This does NOT reproduce
`PAT-HAT-DRIFT-DIFFERENCED-2026-09-27`: σ is 3–6× that night's legs (10.8 / 24.9 / 28.3 ms) and the negative
corner has MOVED from the chest to the ankle. Different night, different grid (5-min vs 30-min blocks) and
6.2 h against a full night — so the pair is two observations, not a trend. And n = 38 is **not** an
UNDERPOWERED verdict: this tool prints no CI, and 09-27's came from a bootstrap not re-run here. All that is
defensible is that 38 windows is strictly less resolved than the 98 at which the chest CI already spanned
zero, so a negative ankle variance cannot be separated from a small positive one.

---

## 🔴 2026-10-12 — the whole population, and the refusal a reader actually got

**The evidence above rested on ONE night. It now rests on every night this firmware has produced.**
Measured read-only on the rig mirror, **9 ring sessions on 8 nights** (2026-10-04 → 2026-10-11; 10-05 holds
two). `first_sample_idx` has **ONE distinct value, 0, on 215,532 of 215,532 `PPG_FRAME` rows**. Nonzero
rows: **0**. No night differs, so the sentence "or any night from this firmware" is now a measurement
rather than an extrapolation from a single capture.

| night | `PPG_FRAME` rows | `PPG_FRAME_A` rows | distinct offsets | Σ `n_samples` / `_PPG.txt` data rows |
|---|---|---|---|---|
| 2026-10-04 | 22,645 | 2,407 | 1 (value 0) | 2,848,032 / 2,848,032 |
| 2026-10-05 | 276 | 111 | 1 (value 0) | 34,354 / 34,354 |
| 2026-10-05 | 27,260 | 3,496 | 1 (value 0) | 3,411,111 / 3,411,111 |
| 2026-10-06 | 27,809 | 4,904 | 1 (value 0) | 3,493,771 / 3,493,771 |
| 2026-10-07 | 32,425 | 10,379 | 1 (value 0) | 4,045,909 / 4,045,909 |
| 2026-10-08 | 24,127 | 3,464 | 1 (value 0) | 3,032,570 / 3,032,570 |
| 2026-10-09 | 21,125 | 5,731 | 1 (value 0) | 2,637,716 / 2,637,716 |
| 2026-10-10 | 36,399 | 4,533 | 1 (value 0) | 4,565,496 / 4,565,496 |
| 2026-10-11 | 23,466 | 3,398 | 1 (value 0) | 2,946,372 / 2,946,372 |

### The dead field is the ONLY blocker — the accounting is already exact

The design carries a second refusal: `Σ n_samples` over the frames must equal the `_PPG.txt` row count, or
a position cannot be mapped. **It agrees exactly on all nine sessions — 27,015,331 declared samples against
27,015,331 data rows, delta 0 on every one.** So a firmware that filled the offset field, or any other
device position, would unblock the finger leg with nothing else standing behind it. The frame accounting
needs no work.

⚠️ **Count the header lines, do not assume one.** A ring `_PPG.txt` carries TWO: `# timebase=host-disciplined`
and the column header. A `wc -l` minus one reports a delta of exactly −1 on every night and invents a
systematic accounting defect that is not there. Derive the header count from the content.

### CORRECTION — the `PPG_FRAME_A` rows do not report 0. They report NOTHING.

The evidence line above puts the one value 0 "on all 2,407 `PPG_FRAME_A` rows". It does not. Read as raw
bytes, a `PPG_FRAME` row ends `;250;0` and a `PPG_FRAME_A` row ends `;6;` — the offset field is EMPTY.
`capture.py:5928` writes `None` there, because 0x03 `LIVE_SAMPLES_A` carries no cumulative position at all.
38,423 `PPG_FRAME_A` rows across the 8 nights, every one blank. **The writer is §∅-correct and the brief
understated it:** the absence is written as an absence, never as a zero. The two row types differ in kind —
one reports a dead field, the other reports no field — and `ringDevColumn` skips the blank by
`c[6] === ''`, never by reading it as 0.

### 🔴 THE DESIGNED REFUSAL WAS UNREACHABLE ON REAL DATA — fixed in this PR

This brief argues at length that `ring-offset-never-advances` is needed because the two incumbent guards
"describe a CORRUPT capture, and a reader who believes them goes looking for a bad file or a resync". The
named refusal shipped in #3274, is pinned by the suite, and **no reader could ever see it.** The ring leg
asked `floorMap` FIRST and took its reason, so on all nine real sessions a reader got:

> `O2Ring PPG: device-counter segments overlap (the counter went backwards) — one device time would map to two host times`

The overlap is a **consequence** of the dead field — every frame sits at one position, so the segments
collide — so the message named the symptom and buried the cause. The outcome the brief calls "this brief's
designed outcome rather than a failure" was, on real data, exactly the reading it was written to prevent.
Measured 9/9 before the fix, 9/9 naming the structural reason after it.

**Both incumbent messages exist, and the brief quotes the one the real nights do NOT produce.** The
quotation above — *"0 usable 10-min floor window(s) … refused as smeared, median spread 6000.0 ms"* — is
still reachable: it is what `floorMap` says on a dead-offset sequence whose packets do not collide, and the
suite exercises exactly that shape. On all nine real sessions `floorMap` refuses EARLIER, on segment
overlap, so that is the sentence a reader actually met. Neither names the device. A quoted refusal message
is a measurement of one input shape, not of the code.

**The fix:** each `ringDevColumn` refusal now carries a machine-readable `kind`
(`offset-dead` · `no-position` · `overlap` · `accounting`), and `ringLegRefusal` ranks the two halves — a
**device-level** absence outranks `floorMap`, because it holds for every night this firmware will record,
while `floorMap`'s overlap and spread complaints describe one capture. The per-capture kinds stay behind
`floorMap`, whose message is the more specific of the two there. Precedence is by kind, not a blanket
preference for either half, and the suite pins both directions plus the all-ok case.

### What this changes about the hat, and what it does not

Nothing about the σ figures. The finger leg still refuses on every night, no corrected finger σ may be
quoted, and the hat on this firmware is still **two corrected floors plus one named refusal**. Acceptance
item 3 — the Verity (ankle) corner re-solved on the corrected legs — is built and reachable in the
chest → ankle corrected coupling, but `out.threeCorr` itself cannot be produced on any capture from this
firmware, because its finger leg never solves. The brief is DONE on the code and honest on the data; the
capability gap stays tracked where it belongs, on `RING-POLL-SPLIT` acceptance item (b), whose 0x03 header
probe (P1) is the only remaining candidate for a device position.

```json
{ "schema": "tepna.verdict/1", "gate": "ring-arrival-floor-population-2026-10-12", "status": "PASS",
  "population": { "checked": 9, "eligible": 9, "excluded": 0 },
  "criterion": { "name": "distinct_first_sample_idx_values_per_session", "threshold": 1, "unit": "count", "direction": "lte" },
  "result": { "distinctValues": 1, "value": 0, "ppgFrameRows": 215532, "nonzeroRows": 0,
              "ppgFrameARowsBlank": 38423, "accountingDeltaMax": 0,
              "namedStructuralRefusalBeforeFix": "0/9", "namedStructuralRefusalAfterFix": "9/9" },
  "evidence": ["/srv/data/tepna-corpus/smoketest-captures/2026-10-0[4-9]+2026-10-1[01]/Wellue_O2Ring-S_S8AW2100_*_PMDARRIVAL.csv",
               "pat-feasibility-worker.js ringDevColumn/ringLegRefusal", "tests/dex-tests.js pat-feasibility · floor · ring"],
  "reason": null,
  "producedBy": { "tool": "pat-feasibility-worker.js ringDevColumn (extracted, run read-only over the rig mirror)", "commit": "34b4e4c1" },
  "at": "2026-10-12T14:40:00Z" }
```

**Scope of the PASS:** it decides that the offset field is dead across the whole available population and
that the structural refusal now reaches a reader. It does **not** decide that the ring can never anchor a
floor — a different device position, or a firmware that fills this one, is untested and unexcluded.

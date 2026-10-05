<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS — 2026-10-05 · **Created:** 2026-10-04

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

- [ ] The finger leg is placed on the ring's arrival-FLOOR axis from the sidecar's own counter, never the
      synthesized grid, and refuses with a NAMED reason when the frame accounting does not match.
- [ ] Both pages (`pat-feasibility.js`, `pat-classic-vs-fused.js`) replace the RAW card with the
      corrected/raw PAIR, both σ sets shown, neither presented as a delta.
- [ ] The Verity corner is re-solved on the corrected legs.
- [ ] The regression gate is green and the plant drives a SYNTHETIC frame-arrival sequence.
- [ ] Residue `2026-09-28-ring-has-no-arrival-floor-axis-so-no-corrected-pat-hat` closed with the PR.

## ⚠️ What this brief may NOT claim yet

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

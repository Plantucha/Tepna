<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED — 2026-10-04 · **Created:** 2026-10-04

# RING-POLL-SPLIT — one opcode for the wave: what the experiment can test tonight, and the two things it cannot

> **Owner, 2026-10-04 15:2x (relayed by Kestrel):** a config-selectable ring poll mode `split` = `0x02`
> RT_PARAM for the 1 Hz vitals + `0x03` for the wave (no `0x04`), the vendor's own split. Criterion as
> relayed: samples per full hour against 125.000 × device-seconds, markers excluded, ≥ 99.9 %, on ONE
> experiment night against 09-28..10-04 as controls; flag default OFF; the seaming fallback is not built
> unless this fails.

Rule 0: `node tools/doc-search.mjs --read "ring poll split: 0x03 RT_WAVE alone vs 0x04, one wave parser
one buffer, PLETHA leftovers, 125 Hz shortfall"` → `ext:memory/owner-decisions-2026-09-26.md` (0.654),
`briefs/RESIDUE.md` (0.649), `capture-host/capture.py` (0.644),
`O2RING-RAW-DUAL-WAVELENGTH-FOLLOWUPS-2026-08-05` (0.637), `O2RING-PROTOCOL-2026-07-17` (0.624).

**The premise is sound and is not in question here:** the vendor's one wave parser serves `0x03` and the
wave half of `0x04` out of one buffer, we poll `0x04` every cycle and `0x03` after it, and polled ALONE on
2026-09-06 `0x03` returned **125.058 Hz over 119.7 s (592 replies, 1 saturated)** — the 125.000 ADC to
0.05 %. What follows is what the repo already measured about *how to score it* and *what it rests on*.

## ① The criterion as relayed would REFUSE a working mode

`oxyii.parse_samples_a`'s docstring, measured 2026-09-06 over 119.9 s:

> on `0x03` the marker does NOT play that role: markers arrive at **0.534/s against a reported 62.0 bpm**
> — about HALF a marker per beat, where `0x04` measured almost exactly one — and subtracting them moves
> the rate **AWAY** from the ADC (**125.058 → 124.444**). So on this stream the raw row rate is the better
> estimate and **a consumer must not "correct" it**.

"Markers excluded" is `0x04`'s correction, where removing the inserted row is what recovers 125.000 from a
126.06 row rate. Applied to `0x03` it computes **124.444 / 125.000 = 99.56 %** and fails the ≥ 99.9 % bar
**on a stream delivering 100.05 %**. The gate would refuse the thing it exists to test.

**Corrected criterion for the experiment arm:** the RAW row rate on `0x03`, markers INCLUDED, against
125.000 × device-seconds, ≥ 99.9 %. Pre-stated, and pre-stated per OPCODE because the marker's meaning is
an opcode fact, not a device fact.

## ② The control arm must sum BOTH opcodes, or the result is pure accounting

Residue `2026-09-27-the-0x04-shortfall-is-the-0x03-stream` (which withdrew the remedy an earlier row the
same day had proposed) measured on `smoketest-captures/2026-09-07`, four full hours:

| hour | 0x04 ADC samples | deficit vs 125.000 | 0x03 rows | closure |
|---|---|---|---|---|
| 23 | 445,784 | 4,216 | 4,233 | 100.4 % |
| 00 | 445,892 | 4,108 | 4,117 | 100.2 % |
| 01 | 445,508 | 4,492 | 4,380 | 97.5 % |
| 02 | 445,376 | 4,624 | 4,556 | 98.5 % |

Four hours: deficit **17,440**, `0x03` delivered **17,286**, unclosed **154 = 0.0086 %** of the 1,800,000
expected. **The samples are not being lost. They are routed.** So scoring the controls on `0x04` alone
(~99.1 %) against the experiment's `0x03` alone (~100 %) manufactures an improvement that is arithmetic,
not device behaviour — and that is the exact shape the withdrawing row warned about: *"a 0x04-only
denominator reports a ~1 % deficit on EVERY ring night for what is a routing split."*

**Corrected control arm:** `0x04 + 0x03` summed per full hour, which already reads ~99.99 %. The honest
question is therefore **not completeness** but whether ONE opcode carrying the wave is better than two on
the properties that remain: per-sample placement, frame accounting, stalls, reconnects, battery.

## ③ 🔴 Split mode may DELETE the corrected PAT hat, and that is unmeasured

E11 (#3267) writes `first_sample_idx` from `oxyii.ppg_stream_offset` — **`0x04`'s `[20:24]`, u32 LE**. It
is the ring's own cumulative stream position, and #3270's three-floor PAT hat exists only because of it.

`0x03`'s reply header is **exactly 6 bytes** (measured 2026-09-06: `payload_len − declared_count == 6` on
every reply of two runs), with the u16 LE declared count at `[4:6]`. **`[0:4]` is unexamined** and no
cumulative position is known on this opcode. If there is none, then on a split night the arrival rows
carry no device position, `ringDevColumn` refuses, and the hat stops existing — trading the finger's floor
axis for a completeness gain that ② says is not real.

**A host-maintained running sum is NOT a substitute.** It would hide exactly the dropouts the floor exists
to see, and writing it into that column would be a fabricated device position (§∅) wearing a new costume.

## ④ 🔴 The vitals half rests on an opcode we have NEVER polled

`O2RING-PROTOCOL-2026-07-17` §306 marks `0x02` RT_PARAM **❌ ours**, and §356 says the staging it carries is
*"reachable only by polling `0x02` directly — **which we have never done**"*. There is no frame builder, no
parser, and no measured reply: `grep -cE 'def param_frame|def parse_rt_param|OP_RT_PARAM' capture-host/oxyii.py`
→ **0**. Its layout is known from vendor SDK sources only.

A failed vitals poll **drops the link** today (`capture.py`, the `live_frame` write), while the wave polls
are explicitly optional. So building the night's vitals on an opcode with no measured reply risks losing
**SpO2 and HR** — the ring's primary signal — not merely the wave.

## ⑤ THE NO-SPLIT CONTROL — night `2026-10-04`, ring session `…20261004220023`

Measured on the box, read-only, 2026-10-05. **It confirms the routing model on a second independent night
and corrects one word of how the control was handed over.**

| hour | PPG rows | markers | ADC (0x04) | Hz | deficit vs 450,000 | 0x03 rows | 0x03 ÷ deficit | **sum vs crystal** |
|---|---|---|---|---|---|---|---|---|
| 23 | 451,787 | 3,830 | 447,957 | 124.433 | 2,043 | 1,887 | 92.4 % | **99.965 %** |
| 00 | 452,222 | 3,958 | 448,264 | 124.518 | 1,736 | 1,703 | 98.1 % | **99.993 %** |
| 01 | 451,690 | 3,952 | 447,738 | 124.372 | 2,262 | 1,943 | 85.9 % | **99.929 %** |
| 02 | 450,743 | 3,926 | 446,817 | 124.116 | 3,183 | 2,606 | 81.9 % | **99.872 %** |
| 03 | 450,556 | 3,633 | 446,923 | 124.145 | 3,077 | 1,924 | 62.5 % | **99.744 %** |

22:00 and 04:00 are partial — session start 22:00:23, last write 04:17 — and are excluded for the reason
②'s table excludes partial hours: a partial hour's denominator is not an hour.

**What it CONFIRMS, which is the point of a second night.** The two streams together account for the
125.000 Hz crystal to between **0.007 % and 0.26 %**, matching residue
`2026-09-27-the-0x04-shortfall-is-the-0x03-stream`'s 0.0086 % over four hours of 2026-09-07. **The samples
are routed, not lost** — now shown on a night recorded a month later with a different session shape. That
is why criterion ②'s control arm must sum both opcodes.

**⚠️ What it CORRECTS.** This was handed over as *"0x04 ALONE fed PPG.txt losslessly"*. Two senses of
lossless have to be kept apart, and only the first holds:

- **against its own declarations — yes.** Rows match the device's declared `ppg_sample_count` to within
  roughly 80 per hour, so the WRITER loses essentially nothing of what the device hands it;
- **against the crystal — no.** 0x04 alone runs at **124.12–124.52 Hz**, short by **1,736–3,183 samples
  per hour**, and 0x03's 1,703–2,606 rows/h cover **62–98 % of exactly that deficit**.

So this is **not** a no-split night. It is a night where the split is **smaller and noisier** than on
2026-09-07 — 62–98 % closure per hour rather than ~99 % over four — and **0x04 alone is not the full ADC**.
That is the measurement the experiment turns on: criterion (a) scored on a single opcode would report a
deficit on a healthy night, so the two-stream sum stays the honest control arm.

**Markers counted out by the residue row's method:** 3,633–3,958 per hour, tracking the ring's own pulse
rather than a rate — which is what identifies them as one row per beat and not samples.

## Two preconditions, both READ-ONLY, both box-local (Wren's lane)

`capture-host/probe_oxyii_0x03.py` already exists and already logs reply headers; it is the template for
both. Neither needs a whole night.

- **P1 · does `0x03`'s `[0:4]` advance with delivered samples?** One short worn run, reporting whether it
  is monotonic and whether its increments match the declared counts. Decides ③, and therefore whether the
  corrected hat survives a split night.
- **P2 · does `0x02` RT_PARAM answer at all, and does its reply parse?** One short worn run. Decides ④,
  and therefore whether the specified design can run without risking the vitals.

## The owner's choice, with the arithmetic beside it

| | vitals source | wave source | needs | risk |
|---|---|---|---|---|
| **(a) as specified** | `0x02` (never polled) | `0x03` only | P2 | a night's SpO2/HR if `0x02` does not answer |
| **(b) reduced-cadence `0x04`** | `0x04` at ~1/10 s (proven path) | `0x03` every cycle | nothing new | vitals at 0.1 Hz instead of 1 Hz for one night |

**(b) answers the same question tonight and risks nothing**: if one opcode draining the buffer is what
recovers the full rate, then `0x03` at full cadence with `0x04` reduced to a tenth shows it — the shared
buffer is drained almost entirely by `0x03`, and the residual on `0x04` becomes the measurement. It also
keeps `ppg_stream_offset` arriving ten times a minute, so ③ stops being fatal: the hat's floor would have
anchors at 0.1 Hz instead of ~1 Hz, which is coarser but not absent.

**Recommendation: run P1 and P2 read-only first, and run the night under (b).** (a) becomes safe the
moment P2 says `0x02` answers.

## THE CRITERION, TWO-PART AND PRE-STATED (owner's deputy, 2026-10-04, after ①–④)

Both parts must hold. **(b) is an adoption gate in its own right: it binds regardless of (a).**

**(a) THE RATE.** `0x03`'s **RAW row rate, markers INCLUDED**, ≥ **99.9 %** of 125.000 × device-seconds on
the experiment night. The controls (09-28..10-04) are scored as **`0x04` + `0x03` SUMMED** — the ~99.99 %
of the table above — so the question being asked is *"the whole waveform in ONE positioned stream"* and
not completeness, which ② shows is already met by the two streams together.

**(b) A DEVICE POSITION EXISTS FOR THE FLOOR.** Either `0x03`'s `[0:4]` is the cumulative stream position
(P1 decides, before the night) or **split mode is NOT adopted even if (a) passes** — trading the finger's
floor axis for an accounting gain is a loss, not a trade. This is why (a) alone cannot carry the decision.

**No whole night goes to the experiment until P1 answers.** P1 is with Wren as a read-only
`probe_oxyii_0x03.py` header run.

## Acceptance (unchanged in shape, corrected in content)

- [ ] P1 and P2 run and recorded.
- [ ] A config flag selecting the wave-poll mode, **default OFF**, so main's behaviour is byte-identical.
- [ ] E11's arrival logger follows the frame-carrying command, writing the position column **BLANK** when
      that command carries none — and the consumer's refusal NAMES split mode rather than today's
      misleading *"a pre-E11 capture carries arrival rows with no stream position"*.
- [ ] Criterion part (a): raw row rate on `0x03`, markers included; controls summed over both opcodes;
      ≥ 99.9 %; one experiment night against 09-28..10-04.
- [ ] Criterion part (b): a cumulative device position exists on the carrying opcode, or the mode is not
      adopted whatever (a) says.
- [ ] `capture.py` refuses NOT_APPLICABLE under the module-level declaration; whatever the diff gate
      un-hides elsewhere is drained.
- [ ] The seaming fallback stays unbuilt unless this fails.

**Nothing here is claimed about a night that has not run.** No experiment night exists; the figures above
are all from 2026-09-06 and 2026-09-07 smoketests and from the opcode docstrings they produced.

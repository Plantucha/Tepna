<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED (P1 and P2 RUN 2026-10-06, worn, box-local (Wren): P1 rate PASS — 125.236 Hz over unsaturated replies, 1 of 2958 saturated; P2 PASS, n = 1 — 0x02 answers and its 20-byte payload is byte-identical to the first 20 bytes of the 0x04 payload, and SUSTAINED 120/120 at 1 Hz with no 0x04; criterion (b) FAIL — 0x03 [0:4] is constant 0, not a stream position, and 0x04 [20:24] is dead too: neither opcode carries a moving position on this unit (2026-10-06); split mode is not adopted by the criterion, and the premise correction is the owner’s. See §P1/P2 results) · **Created:** 2026-10-04

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

## §P1/P2 results — 2026-10-06, worn, box-local (Wren)

The owner wore the ring, off the charger, during both runs. The daemon was held down ONLY by the deadman form
(`tepna-restart.sh stop 20`):
- P1: 00:23:57Z until the deadman's own restart at 00:43:58Z.
- P2: 00:44:12Z until `restart` at 00:44:33Z (21 s).
- The header run (owner-run, 180 s) at 01:29:15Z, and the sustained `0x02` run (120 s) at ~01:45Z, each in its own
  deadman window, the daemon restarted straight after.

The per-reply logs stay on the box (`/srv/tepna/probe/`), per the corpus rule; the numbers below are copied from
them.

**P1 · `0x03` record rate — PASS.** `probe_oxyii_0x03.py --seconds 600` at the default 5 Hz poll:
- 2958 replies, 0 truncated, **1 saturated (0.0003)**;
- the rate over the unsaturated replies is **125.236 Hz over 599.6 s**, within 0.19 % of 125.000 (`rate_all_hz`
  125.22);
- markers 426, at 0.707 Hz, so 124.513 Hz without them;
- the 591 interleaved `0x04` polls report a PR mean of 51.5.

This re-measures, worn and for ten minutes, the 2026-09-06 result of 125.058 Hz (592 replies, 1 saturated).

**Criterion (b): FAIL — `0x03`'s `[0:4]` is NOT a stream position.** P1's merged probe logs only the declared
count and the sample BODY, so a header run followed: a scratch copy of the probe recording `payload[:6]` per reply,
180 s worn, read against the reading stated before it ran ("POSITION if `[0:4]` steps by exactly the previous
reply's declared count on ≥ 95 % of consecutive pairs"):
- `[0:4]` is **0 on all 887 replies**; every one of the 886 steps is 0;
- it matches the previous declared count on 11 of 886 pairs (1.2 %), which is the replies that declared 0;
- the read is sound: `[4:6]`, the declared count, lives in the same 6 bytes and varies reply to reply
  (250, 0, 40, 13, …), so the header was read, and `[0:4]` is genuinely constant.

The same session's `0x04` `[20:24]` also read 0 on all 177 frames. That is not a failed control: it is the field
`oxyii.ppg_stream_offset` documents as measured dead on this ring since 2026-10-04 (zero on every frame of 819
files). **So neither opcode carries a moving device position on this unit.** By the criterion as written, split
mode is not adopted. The premise behind (b), that split mode would trade away the finger's floor axis, assumed
`0x04` carried a live position; on this ring it does not, so split mode would lose nothing that works today.
Whether that changes the decision is the owner's call; this brief records the measurement, not the decision.

**P2 · `0x02` RT_PARAM answers. The finding of the night: its 20-byte payload is byte-identical to the first 20
bytes of the `0x04` payload.**
- The run: `probe_oxyii_opcodes.py --from 0x02 --to 0x02`, after a `--dry-run` that planned one opcode and sent
  nothing.
- The reply frame: `a5 02 fd 01 0014`, then 20 B, then CRC.
- Laid beside the session's `0x04` frame (`a5 04 fb 01 0022`, then 34 B), the `0x02` payload equals `0x04[0:20]`
  exactly. `0x04` is the same parameter block plus the wave tail.
- So **`oxyii.parse_live` reads it with no new code**, identically to the `0x04` frame: SpO₂ 98, PR 51, PI 1.6,
  motion 0, battery 100, run_status 2, worn.

That answers ④'s premise ("no frame builder, no parser"): the parser already exists, because the payload is the
one we already parse.

**Sustained, without `0x04`: PASS.** A scratch poller sent `0x02` (empty payload, as the sweep sent it) once a
second for 120 s and never sent `0x04`, the split-mode condition. All **120 of 120** requests were answered with a
20-byte payload `parse_live` reads; no other opcode arrived; every reply was worn; SpO₂ 96–98, PR 49–57; latency
median 43 ms, max 291 ms. Read before the run: SUSTAINED if ≥ 95 % answered and parsed.
**Limit, stated:** two minutes, not a night. A full night under split mode is the experiment itself.

```json
{"schema": "tepna.verdict/1", "gate": "oxyii-0x03-record-rate", "status": "PASS", "population": {"checked": 2933, "eligible": 2958, "excluded": 25}, "criterion": {"name": "rate_within_candidate", "threshold": 0.02, "unit": "fraction", "direction": "lte"}, "result": {"replies": 2958, "replies_truncated": 0, "replies_with_records": 2933, "saturated_replies": 1, "saturated_fraction": 0.0003, "cap": 250, "total_records": 75365, "rate_all_hz": 125.22, "rate_unsaturated_hz": 125.236, "span_s": 599.864, "unsaturated_span_s": 599.603, "matched_hz": [125.0], "closest_fraction": 0.0019}, "evidence": ["capture-host/probe_oxyii_0x03.py"], "reason": null, "producedBy": {"tool": "capture-host/probe_oxyii_0x03.py", "commit": "f780a14e"}, "at": "2026-10-06T00:34:16Z", "scope": "internal"}
{"schema": "tepna.verdict/1", "gate": "oxyii-0x02-rt-param-answers", "status": "PASS", "population": {"checked": 1, "eligible": 1, "excluded": 0}, "criterion": {"name": "replies_answered_and_parsed", "threshold": 1, "unit": "replies", "direction": "gte"}, "result": {"replied": true, "payload_len": 20, "payload_equals_0x04_prefix_20": true, "parse_live": {"spo2": 98, "pr": 51, "pi": 1.6, "motion": 0, "batt": 100, "run_status": 2, "worn": true}}, "evidence": ["capture-host/probe_oxyii_opcodes.py", "capture-host/oxyii.py"], "reason": null, "producedBy": {"tool": "capture-host/probe_oxyii_opcodes.py", "commit": "f780a14e"}, "at": "2026-10-06T00:44:30Z", "scope": "internal"}
{"schema": "tepna.verdict/1", "gate": "oxyii-0x02-rt-param-sustained", "status": "PASS", "population": {"checked": 120, "eligible": 120, "excluded": 0}, "criterion": {"name": "answered_parsed_fraction", "threshold": 0.95, "unit": "fraction of requests", "direction": "gte"}, "result": {"requests": 120, "replies": 120, "parsed": 120, "answered_parsed_fraction": 1.0, "payload_lens": [20], "other_ops_seen": {}, "worn": 120, "spo2_values": [96, 97, 98], "pr_range": [49, 57], "latency_s": {"min": 0.023, "median": 0.043, "max": 0.291}}, "evidence": ["capture-host/oxyii.py"], "reason": null, "producedBy": {"tool": "capture-host/oxyii.py", "commit": "f780a14e"}, "at": "2026-10-06T01:47:00Z", "scope": "internal"}
{"schema": "tepna.verdict/1", "gate": "oxyii-0x03-header-is-stream-position", "status": "FAIL", "population": {"checked": 886, "eligible": 886, "excluded": 0}, "criterion": {"name": "hdr_0_4_steps_equal_prev_declared_count", "threshold": 0.95, "unit": "fraction of consecutive pairs", "direction": "gte"}, "result": {"replies": 887, "pairs": 886, "step_equals_prev_count": 11, "step_equals_prev_count_fraction": 0.012, "constant_pairs": 886, "distinct_hdr_0_4": [0], "declared_count_varies": true, "sibling_0x04_offset_20_24_distinct": [0]}, "evidence": ["capture-host/probe_oxyii_0x03.py", "capture-host/oxyii.py"], "reason": "0x03 [0:4] is 0 on all 887 replies (every step 0); it steps by the previous declared count on 11 of 886 pairs (1.2 %), far below 95 %", "producedBy": {"tool": "capture-host/probe_oxyii_0x03.py", "commit": "f780a14e"}, "at": "2026-10-06T01:32:00Z", "scope": "internal"}
```

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

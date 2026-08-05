<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-05
**Supersedes:** O2RING-RAW-STREAMS-ABSENT-2026-08-04-BRIEF.md

# O2Ring `cmd 0x05` — a two-channel raw optical stream we concluded did not exist

> **Framing note (2026-08-05):** earlier revisions called this "raw dual-wavelength PPG". The stream is
> real, structured and two-channel; that it is a *plethysmogram*, and that the channels are RED and IR,
> are **not** established — see §1.2④. The title and the capture stream name (`ppg2w`) predate that
> finding; the name is kept because a shipped stream name is a compatibility surface, not a claim.

## 1 · The correction

`O2RING-RAW-STREAMS-ABSENT-2026-08-04` concluded this ring exports no raw red/IR waveform, and that
re-deriving SpO₂ from it is therefore impossible. **The premise was wrong, so the conclusion does not
follow.** The ring does export both channels, on `cmd = 0x05`.

**The miss was a DECODE failure, not an argument failure** — corrected 2026-08-05 after checking the
prior art this project already cites (see §1.1; the first draft of this brief got the mechanism wrong).
The sweep probed all 256 opcodes and scored `0x05`'s fixed 922-byte reply with a generic noise metric
over undifferentiated bytes. Nothing about that reply is noise; the metric simply had no record framing
to see structure through. Read as 9-byte records of `{u32, u32, u8}`, both channels are ordered
waveforms:

| | range | median \|Δ\| | ratio = median\|Δ\| / range |
|---|---|---|---|
| channel 0 | 8585 | 127 | **0.0148** |
| channel 1 | 5471 | 92 | **0.0168** |
| channel 0, SAME data shuffled | — | — | **0.3395** — 23× rougher |

A waveform's successive-difference ratio is « 1; the shuffle destroys ordering and the ratio jumps by
23×. The payload is structured, and the structure is temporal.

**The lesson generalises past this ring, and it is not the one the first draft drew.** A sweep that
scores replies with a *generic* statistic can only see structure the statistic is shaped to detect: 922
bytes of interleaved little-endian u32 pairs are indistinguishable from noise under a byte-wise metric,
and become obviously periodic under the right framing. So a sweep's negative means **"no structure my
decoder could see"**, never "no capability". (The weaker trap is real too — a sweep tests opcodes, not
the argument space behind each — but it is NOT what happened here, and saying so would be a tidier
story than the truth.)

### 1.1 · Prior art this project already had, and what is actually new

`O2RING-PROTOCOL-2026-07-17-BRIEF.md` §1 and `CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md` already
established the protocol-family split, and both cite
[`nglessner/o2ring-s-protocol`](https://github.com/nglessner/o2ring-s-protocol) as the reference for the
family this ring speaks. **That repo documents `0x05` already** — as `922 bytes · count + 102 × 9-byte
records · "Purpose unknown"`, obtained with an **empty** payload.

Two consequences, both of which cut against the first draft:

1. **The 922-byte structured reply is not argument-gated.** It arrives with an empty payload too. So
   `{0x07, 0x01}` (the argument `lepu-blepro`'s `oxyIIGetRtPpg` specifies) may be irrelevant here.
   **Untested** — the ring was unreachable when this was written, and a same-session control decoding an
   empty-payload reply the identical way is what would settle it. Until then this brief must not claim
   the argument unlocked anything. `rt_ppg_frame()` keeps sending it because that is what was actually
   measured, not because it is known to be required.
2. **The family is NOT publicly undocumented** — an earlier revision of §5 said so, which was wrong.

**What IS new here:** the *purpose* of `0x05` (raw two-wavelength PPG, evidenced by the ordering test
above rather than asserted), and the **record base offset of 2** — a `u16` LE count, where the reference
reads a `u8`. The offset is self-proving: at base 2 the u32 pairs decode into smooth waveforms, and at
any other base the fields straddle record boundaries and shred into noise. That is a concrete, checkable
correction to send upstream.

## 1.2 · HARDWARE RUN, 2026-08-05 — three questions answered, one still open

Run on device `S8AW2100`, finger worn, ring-reported SpO₂ **97 %** (median of 30 polls). The capture
daemon was taken off the link with `tepna-restart.sh stop 10` — the sanctioned passwordless verb, which
arms a deadman timer *before* stopping, so the box restarts itself even if the operator never returns.
30 polls, 3060 samples. Raw data: `/tmp/rprobe.json` on the capture host.

**① The argument is IRRELEVANT — now measured, not inferred.** The probe alternated `{0x07, 0x01}`
against an **empty** payload: 15 replies each, **every one 922 bytes with 102 records**. §1.1 predicted
this from `nglessner`'s empty-payload observation; it is now a direct A/B on our own hardware. The
argument neither unlocks nor changes the reply. `rt_ppg_frame()` may keep sending it or stop; it makes
no difference.

**② The record count is a CAP, confirmed.** 102 records on all 30 replies regardless of spacing.

**③ ~~THE BUFFERS TILE~~ — RETRACTED, and the rate measured instead (later the same day).** The first
run claimed the buffers tile because the seam step between replies (760) was only 1.07x the median step
inside one (712). **That test is worthless on this signal**, and a second run proved it: at poll spacings
of 0.5 / 1.0 / 2.0 s it reported "contiguous" at *all three*, which is impossible — 102 records arriving
every 2 s would mean a 47 Hz device. On a smooth waveform a gap of hundreds of samples still lands close
in VALUE, so a value-based seam test cannot see it. It never had the sensitivity to support the claim.
The dependent claim — "`fs = 102 / poll interval`" — was likewise an artifact: it returned 154.5, 87.7 and
47.4 Hz at the three spacings, i.e. it merely restated `102/dt`.

**The test that does work is STARVATION.** Poll fast enough and the buffer cannot refill, so the count
falls below the cap and `count = fs · dt` becomes measurable. At spacings of 0 – 0.3 s the counts spread
right across `0, 4, 10, … 70, 102` instead of pinning at 102 — the cap is real, and the fill rate is
observable. Over the 35 unsaturated, non-empty replies:

| estimator | fs |
|---|---|
| least squares `count = fs·dt + c` (c = 7.9 records) | **125.7 Hz** |
| forced through the origin | 155.5 Hz |
| median of per-point `count/dt` | 150.7 Hz |

**What is solid: it is NOT the 200 Hz the SDK README claims** — every estimator lands well below it.

**The value to compare against is 125.000 Hz, not 125.738.** `DEVICE-RATE-TRUTH-2026-08-05` §2 settled
this: the ring's ADC is **125.000 Hz exactly** (4 MHz ÷ 32000, a clean divider chain), and
`O2PPG_FS_DEFAULT = 125.738` is a *row* rate — the pleth inserts one extra row (the `156` beat marker)
per detected beat, so `125.738 ≈ 125 + 44 bpm` describes one night's heart rate, not a clock. That brief's
own summary line: *"125.0 is right about the ADC and wrong about the row axis. 125.738 is the reverse."*
An earlier revision of this section compared the fit against 125.738; that was citing a constant this
project has already refuted.

**And `0x05` carries NO beat markers, so its row rate should be the ADC rate flat.** Checked on the 3060
samples: there is no fixed sentinel value (the most-repeated `u32` occurs 2–3 times, i.e. chance), and
the apparent single-sample outliers are not insertions but **level shifts** — e.g. `1309930 → 994120 →
993543`, which steps down and *stays* down, the signature of an AGC gain change between buffers rather
than one spurious row. So unlike the pleth, this stream needs no marker→beat-event extraction and gets no
`+ beats/s` inflation.

So the prediction for "same ADC, delivered raw" is **125.000 Hz flat**, and the least-squares **125.7 Hz**
is consistent with it. Still **do not quote a rate**: the three estimators disagree by 25 %, the residual
RMS is 10.3 records against counts of 10–50, and n = 35. What is established is the *bound* (« 200 Hz)
and the *absence of markers*; a longer starvation run at several spacings settles the value.

**④ IR vs RED — CLAIMED SETTLED, THEN WITHDRAWN THE SAME DAY. Treat as UNSAFE.**

The ratio-of-ratios over the 3060-sample concatenation gave `R = (AC/DC)_ch0 / (AC/DC)_ch1 = 0.4885`
→ SpO₂ ≈ 97.8 % against a reported 97 %, where the swap gives 59 %. I recorded that as settled
(`channel 0` = RED, against the SDK). **A later periodicity check removes its foundation**, and the
number is retained here only so the reasoning can be audited:

| | AC/DC |
|---|---|
| `channel 0` | 0.1184 |
| `channel 1` | 0.2425 |

**Why it is unsafe.** `R` is defined on the *cardiac* AC — the pulsatile component — and nothing here
demonstrates the measured AC is cardiac:

- **An AC/DC of 12–24 % is far too large for a pulse.** Perfusion index at the finger runs ~0.5–2 %.
  Ten times that is the scale of baseline drift or motion, not a plethysmographic pulse.
- **No cardiac periodicity is detectable, anywhere.** Autocorrelation over 6547 provably-unsaturated
  samples is a smooth monotonic decay (0.94 at lag 20 → 0 near lag 175 → −0.45), with **no local bump
  at any lag from 20 to 2200** — a range covering every sample rate from 1 Hz to ~2400 Hz at the
  measured 66 bpm. A pulsatile signal must peak at its beat period. This one never does.
- **Nor within seam-free buffers.** Averaging autocorrelation across 30 full 102-sample buffers (which
  sidesteps any cross-poll gap) shows the same featureless decay — no peak at lag 51, so **56 Hz is
  excluded too**.

So the 97.8 % agreement is not a validated ratio-of-ratios; it may be coincidence, and one coincidence
at one saturation is exactly the evidence this brief has twice refused elsewhere. **Do not assign
wavelengths on this basis, and do not compute SpO₂ from these columns.**

**What the same data still supports:** the two channels are genuinely distinct optical channels, not one
photodiode at two gains — fitting `ch1 = k · ch0` gives `k` drifting 0.7139 → 0.5320 with residual RMS
from 0.049 % to 7.06 % of DC, where a gain pair would hold `k` constant at ~zero residual by
construction. Two channels, differing non-trivially. Which two, and of what, is open.

**The one honest reading of the shape:** each 102-sample buffer contains roughly ONE swing. At the
measured 66 bpm that would put ~0.91 s in a buffer, i.e. fs ≈ 112 Hz — consistent with ③'s 126–156 Hz
range and with the ADC's 125.000, and consistent with the swing being the cardiac cycle. Consistent
with, not evidence for: one cycle per window is precisely the case where periodicity cannot be
confirmed, because there is no repetition to detect.

⚠️ **And a caveat on this brief's own headline evidence.** The shuffle test in §1 (`median|Δ|/range`
0.0148 vs 0.3395) proves the samples are **ordered**. It does *not* prove they are a plethysmogram — a
smooth monotonic ramp passes it trivially, and buffer 0 of this run is exactly that (102 samples, **zero**
turning points, an 11.7 % monotonic slide). Reading one buffer would have concluded "not a waveform".
Across all 30 the mean turning-point count is **9.9** (max 31) and direction splits 17 up / 13 down, which
is what real structure looks like. The ordering statistic was necessary, never sufficient; the population
is the evidence.

## 2 · Wire format (`cmd = 0x05`; the argument is optional — §1.2①)

```
[0:2]        u16 LE   record count            (observed: 102, every reply)
[2 : 2+9N]   N × 9 B  { u32 LE chA, u32 LE chB, u8 motion }
[2+9N : ]    trailer  (observed 2 B; not decoded, not assumed to be padding)
```

Measured on device `S8AW2100`. The reply is 922 B while the declared 102 records occupy 920 B, so two
bytes are over. `oxyii.parse_rt_ppg` takes the count from the device's own field and bounds the slice
by the buffer, so a trailer of any size is ignored rather than absorbed into a record — and a
*truncated* reply yields only whole records instead of records zero-padded out of absent bytes.

`motion` is recorded as the raw byte. The vendor doubles it for display; that is presentation, not a
measurement, and is not applied to a stored value.

## 3 · Two things this does NOT establish — and must not be written as if it did

### 3.1 · Which channel is which wavelength — ANSWERED 2026-08-05 (see §1.2④); kept for the reasoning

The SDK names the first u32 IR and the second RED. **That is a vendor-header claim, not a
measurement**, and here it would be load-bearing: SpO₂ comes from the ratio-of-ratios
`R = (AC/DC)_red / (AC/DC)_ir`, so a swapped pair does not fail loudly — it produces a confident wrong
saturation. The columns are therefore recorded in device order as `channel 0;channel 1`, per §🎫's rule
that a surfaced number carries its evidence and never borrows authority it has not earned.

**The test that settles it, and why it is decisive rather than suggestive:** `R ≈ 0.5–0.6` at 98 % SpO₂
and `R ≈ 1.0` at 82 %, so the two assignments are nowhere near a tie. Take one buffer, compute AC/DC per
channel, form `R` both ways, and compare against the SpO₂ the ring itself reports over `cmd = 0x04` in
the same session. The correct assignment lands near the ring's own number; the swap lands roughly 25–30
saturation points below it. One reading on a healthy finger separates them.

Blocked on 2026-08-05 only by reachability: BlueZ reported `Connected: yes` while the ring was invisible
to discovery — a connected peripheral stops advertising, so `bleak`'s discovery-based connect failed
"not found" while the capture service held the link. `capture-host/unwedge.sh` (stop service → drop the BlueZ
link → cycle both adapters → probe → restart service via an `EXIT` trap) is the recovery. **No new
protocol work is required.**

### 3.2 · The sample rate

The SDK README says 200 Hz. **Every reply measured here carried exactly 102 records regardless of poll
spacing**, which is the signature of a fixed buffer cap — `cmd = 0x03` behaves identically and caps at
250 — not of a sample rate. A constant count under a varying poll interval cannot distinguish "200 Hz,
buffer full" from "102 Hz, buffer sized to the poll".

Consequences, all deliberate:

- `BUS.register("o2ppg2w", …, fs = 0)` — declaring an unmeasured rate would put a fabricated number on
  a monitor card, which is the failure `DEVICE-RATE-TRUTH` exists to prevent.
- The per-record step is the **buffer span over its records**, not a nominal rate.
- `sensor timestamp [ns]` is written as **0** on every row. The ring exposes no device clock on this
  opcode, and the 125 Hz pleth's `O2PpgGrid` cannot be borrowed — it is built on a *measured* 125 Hz
  step, so reusing it would stamp this stream with another stream's rate. A zero column reads as "no
  device timebase"; a plausible one would read as a measurement.

Note this also means the buffer may be **full** rather than complete: when the poll is slower than the
true rate, samples were dropped before we asked, and the honest 1 s span across a full buffer shows up
as a visible rate error a reader can find — where a fabricated per-sample rate would hide it.

## 4 · What landed

| file | change |
|---|---|
| `capture-host/oxyii.py` | `OP_RT_PPG` · `RT_PPG_ARG` · `rt_ppg_frame()` · `parse_rt_ppg()` + the WHICH-IS-WHICH record |
| `capture-host/writers.py` | `"ppg2w"` header + `write_ppg2w()` |
| `capture-host/capture.py` | opt-in stream, decode branch ahead of the `OP_LIVE` gate, back-timing, teardown |
| `capture-host/tests/` | 6 parser tests, 1 writer-join test, extended header-parity gate |

**Monitor:** `BUS.register("o2ppg2w", "Raw 2-wavelength (O2Ring)", "raw", 0, chans=2, labels=("ch0","ch1"))`
surfaces it like any other stream. No `monitor.html` change is needed, and that was **traced rather than
assumed** — the two places a new key could go wrong both resolve correctly:

- `isPpgKey` is anchored `/^ppg(_|$)/`, so `o2ppg2w` does not match and is not mistaken for a Verity
  3-LED stream (the exact bug issue #410 fixed for the Verity, which rendered flat when it did match).
- `streamKind` therefore falls through to `chans > 1` and classifies it **`'multi'`** — a 2-channel raw
  card like acc/gyro, NOT an HR-derived waveform. Correct: deriving a pulse rate needs a sample rate,
  and §3.2 says we do not have one.
- `stream_health(fs=0, …)` takes the event-stream branch (`4.0 / (nominal_fs or 1)` — no division by
  zero) and can only report `stall` on prolonged silence, never `weak`. Rate-judging a stream with no
  known rate is exactly the arithmetic that must not run.

**Opt-in, not on by default** (`"ppg2w" in dev["streams"]`), and a failed `0x05` poll must not drop the
link the way a failed vitals poll does — an experimental stream may not cost a night of oximetry.

### 4.1 · Verification

- Header-parity gate extended. It has an exhaustiveness tripwire — `set(HEADERS) == set(psl) | {…}` —
  which **caught this change** and refused it until the new header was justified against a real export.
  PSL never talked to an O2Ring, so there is no vendor layout to be byte-compatible with; `ppg2w` reuses
  PSL's `channel N` idiom so one parser still reads it.
- The parser tests were verified against **four hand-applied mutants** rather than trusted for passing:
  little-endian → big-endian (3 failed), `min(n, avail)` → `n` (1), record offset `2 + i·9` → `i·9` (3),
  and `RT_PPG_ARG` `{0x07,0x01}` → `{0x01}` (1). Baseline green on restore, `__pycache__` cleared between
  rounds. A test that passes without ever failing is not evidence.
- **No ingest collision:** `dex-ingest.js` routes on `/_PPG\b|_PPG\./`, and `_PPG2W` matches neither —
  there is no word boundary between `G` and `2`. Verified by executing the regexes, not by reading them.
  This matters because PPGDex selects its layout by column count (`nCh === 1 ? [ch0] : [ch0,ch1,ch2]`),
  so a two-column optical file reaching that path would read an absent third channel.

## 5 · Follow-ups (deliberately NOT in this changeset)

1. ~~Settle IR vs RED~~ **DONE 2026-08-05 (§1.2④): `channel 0` = RED, `channel 1` = IR, against the
   SDK's naming.** Re-confirm at a different saturation before any clinical number rests on it.
2. **Measure the rate — now a one-line change.** §1.2③ showed the buffers TILE, so `fs = 102 / poll
   interval`; the probe simply has to record a timestamp per poll. (The count-varies-with-spacing test is
   redundant: 102 was constant across every spacing tried, which is why tiling — not the count — is what
   yields the rate.)
3. **PPGDex two-channel ingest.** Wavelength identity does not matter for pulse/HRV — *either* channel
   is a valid plethysmogram — so this is unblocked by §3.1. It needs a `nCh === 2` branch and therefore
   a DSP change: three build systems re-bundled, GATE A/B, and `computeHash` re-verification against the
   real corpus per §🔏. Kept out of this changeset so a Python-only leg is not held behind the heavy gate.
4. **OxyDex SpO₂ derivation — UNBLOCKED by §1.2④.** The ratio-of-ratios already reproduces the ring's own
   reading to within ~1 point on one session with a textbook `110 − 25R`. What remains is calibration, not
   identification: the ring does not publish its constants, so this must ship as a *comparison* against
   the ring's SpO₂ (and a disagreement detector) long before it is ever a replacement. Note the honest
   ceiling — agreement at one saturation near 97 % says little about the desaturations that matter
   clinically, and those are exactly where a generic calibration drifts.
5. **Contribute upstream — to the project that documents OUR family.**
   [`nglessner/o2ring-s-protocol`](https://github.com/nglessner/o2ring-s-protocol) — the reference
   `O2RING-PROTOCOL` §1 and `CAPTURE-HOST-FOLLOWUPS` already cite, and the one that documents THIS
   family (`e8fb…`, `0xA5`). It lists `0x05` as `922 bytes · count + 102 × 9-byte records · "Purpose
   unknown"`. Two checkable things to send it, per §1.1: the **purpose** (raw two-wavelength PPG, with
   the ordering measurement as evidence) and the **record base offset of 2** (`u16` LE count, where it
   reads a `u8` — and the offset proves itself, since only base 2 decodes into smooth waveforms).

   Do **not** send it to the legacy-family projects. Their opcode table is for a different service:

   | | `farolone/wellue-o2ring-protocol`, `MackeyStingray/o2r`, `ecostech/viatom-ble` | this ring |
   |---|---|---|
   | service UUID | `14839ac4-7d7e-415c-9a42-167340cf2339` | `e8fb0001-a14b-98f9-831b-4e2941d01248` |
   | header byte | `0xAA` | `0xA5` |
   | `0x03`/`0x04`/`0x05` | FILE_OPEN / FILE_READ / **FILE_CLOSE** | wave buffer / live poll / **RtPpg** |

   ⚠️ **Both services are present on this device** — an earlier revision of this section said they
   "never coexist", which is wrong and is contradicted by our own `CAPTURE-HOST-FOLLOWUPS`: the ring
   *exposes* the legacy `14839ac4…` service and simply **ignores every command on it** (connects, 0
   data). That is why `o2r` and `viatom-ble` fail silently against it rather than failing to connect.
   So `0x05` genuinely means FILE_CLOSE on one service and RtPpg on the other, on the same ring.

   `nighttimecf/o2ring-analyzer` is NOT a candidate — it analyses O2 Insight Pro CSV exports and never
   touches the device.

6. **Look for a JSON config opcode on OUR family.** `o2r`'s `CMD_CONFIG = 0x16` sets time, alert
   thresholds and vibration strength with a JSON payload. If `e8fb…` has an analogue, it is a far
   cleaner settings route than the byte-poking that found `0x83` buzzing the ring, and it would replace
   guesswork with a documented surface. Cheap to test the moment the ring is reachable.

<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-05
**Supersedes:** O2RING-RAW-STREAMS-ABSENT-2026-08-04-BRIEF.md

# O2Ring raw dual-wavelength PPG — the stream we concluded did not exist

## 1 · The correction

`O2RING-RAW-STREAMS-ABSENT-2026-08-04` concluded this ring exports no raw red/IR waveform, and that
re-deriving SpO₂ from it is therefore impossible. **The premise was wrong, so the conclusion does not
follow.** The ring does export both channels, on `cmd = 0x05`.

The reason the sweep missed it is worth recording, because it is a general trap rather than an
oversight. That sweep probed all 256 opcodes with arguments `none / 00 / 01 / 02`. Under those
arguments `0x05` returns a fixed 922-byte reply, which a generic noise metric scored as noise — a
correct measurement of the wrong request. The vendor SDK (`lepu-blepro` 1.3.6, `oxyIIGetRtPpg`)
specifies the argument **`{0x07, 0x01}`**, and no prior probe here ever sent it. Decoded with that
argument, both channels are ordered waveforms:

| | range | median \|Δ\| | ratio = median\|Δ\| / range |
|---|---|---|---|
| channel 0 | 8585 | 127 | **0.0148** |
| channel 1 | 5471 | 92 | **0.0168** |
| channel 0, SAME data shuffled | — | — | **0.3395** — 23× rougher |

A waveform's successive-difference ratio is « 1; the shuffle destroys ordering and the ratio jumps by
23×. The payload is structured, and the structure is temporal.

**The lesson generalises past this ring:** an opcode sweep tests *opcodes*, not the *argument space*
behind each one. A negative result from a sweep is "no response to the arguments tried", never "no
such capability". Our brief stated the stronger claim, and it stood for a day.

## 2 · Wire format (`cmd = 0x05`, arg `{0x07, 0x01}`)

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

### 3.1 · Which channel is which wavelength (blocks SpO₂)

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
surfaces it like any other stream; no `monitor.html` change is needed, because the O2Ring card set is
keyed off the registration rather than hardcoded.

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

1. **Settle IR vs RED** via §3.1. Everything below is gated on it.
2. **Measure the rate** — poll at several spacings and check whether the record count ever falls below
   102. A count that varies with spacing is a rate; a constant one is a cap.
3. **PPGDex two-channel ingest.** Wavelength identity does not matter for pulse/HRV — *either* channel
   is a valid plethysmogram — so this is unblocked by §3.1. It needs a `nCh === 2` branch and therefore
   a DSP change: three build systems re-bundled, GATE A/B, and `computeHash` re-verification against the
   real corpus per §🔏. Kept out of this changeset so a Python-only leg is not held behind the heavy gate.
4. **OxyDex SpO₂ derivation** — the actual point of a dual-wavelength stream, and the one piece that is
   genuinely blocked on §3.1. Reference-free SpO₂ needs calibration constants the ring does not publish;
   expect this to be a *comparison* against the ring's own SpO₂ before it is ever a replacement for it.
5. **Contribute upstream — but to the right protocol family.** Surveyed 2026-08-05, the two public
   reverse-engineering projects ([`farolone/wellue-o2ring-protocol`](https://github.com/farolone/wellue-o2ring-protocol),
   [`MackeyStingray/o2r`](https://github.com/MackeyStingray/o2r)) document a **different GATT service
   from ours**, and the distinction matters more than the opcode numbers:

   | | those projects | this ring (`oxyii.py`) |
   |---|---|---|
   | service UUID | `14839ac4-7d7e-415c-9a42-167340cf2339` | `e8fb0001-a14b-98f9-831b-4e2941d01248` |
   | header byte | `0xAA` | `0xA5` |
   | `0x03` / `0x04` / `0x05` | FILE_OPEN / FILE_READ / **FILE_CLOSE** | wave buffer / live poll / **RtPpg** |
   | `0x16` | `CMD_CONFIG`, JSON (`{"SetTIME":"…"}`) | not known here |

   A separate service, not a firmware variant of one — so our `0x05` cannot contradict their
   `FILE_CLOSE`; the two never coexist on a characteristic. The `e8fb…` OxyII family therefore appears
   **publicly undocumented**, which makes the contribution larger than a single opcode note: it is a
   second family. Submit it as such, and only after §3.1 and §3.2, so we send results and not
   hypotheses. `nighttimecf/o2ring-analyzer` is NOT a candidate — it analyses O2 Insight Pro CSV
   exports and never touches the device.

6. **Look for a JSON config opcode on OUR family.** `o2r`'s `CMD_CONFIG = 0x16` sets time, alert
   thresholds and vibration strength with a JSON payload. If `e8fb…` has an analogue, it is a far
   cleaner settings route than the byte-poking that found `0x83` buzzing the ring, and it would replace
   guesswork with a documented surface. Cheap to test the moment the ring is reachable.

<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-10-04 · **Created:** 2026-10-04

# SOLID-NIGHT §3.4 `rtc` — the device's own RTC, judged against the host that disciplines it

**Supersedes:** nothing. **Residue:** `2026-10-04-a-read-inside-the-push-sequence-reports-a-half-applied-time`

## 1 · Why a band, and why it is not the `clocks` band

`clocks` asks *was a device-vs-host comparison recorded at all* and PASSes on the first `read` row with a
parseable offset. It never looks at the value. So a ring night whose RTC sat seconds off the host passes
`clocks` today, and nothing in the verdict says what the comparison found. `rtc` is that second question.

The ring is the only device with an answer: `oxyii.SET_UTC_TIME (0xC0)` pushes host wall-clock to its
onboard RTC so its stored-session `.dat` stamps line up with the NTP-synced host, and
`O2RING-PROTOCOL-2026-07-17-BRIEF` §153 says that RTC **must never stamp the waveform**. A Polar is
disciplined nowhere and logs nothing, so its band is `NOT_APPLICABLE` — examined, and the rule does not
bind. A ring night with no log is `UNKNOWN`: the rule binds and the input is absent (§∅).

## 2 · The bounds, PRE-STATED from the mirror before any night was judged

Measured 2026-10-04 over **620 `*_RTCLOG.csv`** in `/srv/data/tepna-corpus/uploads/vigil-archive/captures`
— 44 nights carrying ring logs, 2883 `read` rows. Header
`Phone timestamp;event;rtc_offset_s;battery_*`; events `push` · `read` · `battery`.

| quantity | measured | bound | why that bound |
|---|---|---|---|
| `\|rtc_offset_s\|` on reads CLEAR of a push | n 2788 · p50 0.5 · p95 1.5 · p99 4.4 · p99.9 6.1 · **max 6.3** | `RTC_OFFSET_MAX_S = 8.0` | ~1.3× the observed maximum — it fires on nothing the mirror holds |
| read cadence | p50 600.4 s · p99 606.4 · max 761.5 | `RTC_READ_GAP_MAX_S = 900.0` | a 10 min poll; past this is a window nobody read |
| start-to-end drift, spans > 4 h | n 46 · p50 26.3 ppm · p95 78.3 · max 98.3 | `RTC_DRIFT_MAX_PPM = 100.0` | crystal-plausible, above the observed maximum |
| resets | **0 in 620 logs** | any reset FAILs | see §4 — a tripwire with no validated positive |
| pushes per log | p50 1 · max 38 · 136 logs with none | — | "every push recorded" is vacuously true on 136 logs and is not evidence |

### 2.1 ⚠️ The offset column is TWO populations, and that is the whole design

Binned by seconds since the last push:

| since push | n | `\|offset\|` p50 | p95 | max |
|---|---|---|---|---|
| 0–2 s | 204 | 0.80 | 1.50 | 6.9 |
| **2–5 s** | **166** | **5.90** | **9.60** | **11.9** |
| 60–300 s | 55 | 0.70 | 1.80 | 2.9 |
| > 3600 s | 1674 | 0.40 | 1.10 | 1.9 |

Essentially every read above 6 s sits inside one 2–5 s window after a push. That is a read landing
mid-push-sequence reporting a **half-applied time**, not a drifting RTC — clear of a push the clock is
tight. A bound applied to every read would therefore fail nights on the band's own instrument, so the
band judges reads taken clear of a push and **states how many it set aside**: §🧾's
`checked + excluded = eligible`, published rather than implied. The spike itself is a capture-side
defect and is the residue row above, not this band's business.

### 2.2 ⚠️ The bound was wrong for an hour, and the correction is the point

`RTC_OFFSET_MAX_S` was first derived at **5.0** from a population of 2184 reads with max 3.3 s. That
measurement took reads > 60 s after a push **only where a push had already been seen**, which silently
dropped every read before a log's first push — and those carry free-run from whenever the RTC was last
set. Over the population the band *actually judges* the maximum is **6.3**, not 3.3, and a 5.0 bound
FAILED 2 of 44 real nights (2026-08-30 at 6.3 s, 2026-08-29 at 5.1). **A bound measured on a narrower
population than it is applied to is two populations wearing one number.** Caught by running the band
over the mirror before writing the brief, not by re-reading the derivation.

### 2.3 Drift is NULL unless the span can resolve it

The log records `rtc_offset_s` to **0.1 s** (110 distinct values, minimum spacing 0.1), so a ppm figure
has a floor of `0.1 / span`. Measured against it: spans > 0.2 h give `|ppm|` p50 **83.3** against a floor
of **166.7** — the median sits *below* the noise. Only spans > 4 h clear it (floor 6.9). The band
publishes drift only where the span resolves the bound `RTC_DRIFT_RESOLVE = 4` times over, and otherwise
reports **null with the floor named**. A number there would be absence-as-value in reverse (§∅).

## 3 · One log per SESSION

The ring writes one RTC log per capture session. **2026-08-29 holds 290 of them** against a median
night's 3, so a band reading a single file is not reading the night, and a per-night push count means
nothing without the session count beside it. `rtc_events` reads every log the night holds.

## 4 · What FAILs, and what it is honest to claim

A **reset** FAILs: the disciplined time was lost, so no offset after it describes the clock we set.
⚠️ The mirror holds **zero** resets in 620 logs, so this arm has never fired on real data — a tripwire,
not a validated discriminator, and the band's own comment says so rather than let a FAIL imply the
detector has seen one. The offset bound is the same shape: set above everything observed, following
§A5's precedent that a detector with no validated positive reports rather than convicts on a tail.

## 5 · The plant, quoted and not predicted

Run over the mirror at `claude/rtc-band-mg`:

| night | logs | push | read | verdict |
|---|---|---|---|---|
| 2026-10-02 | 2 | 4 | 50 | **PASS** — within 1.2 s, drift −2 ppm over 13.4 h, longest unread stretch 372 min — 45 checked, 5 set aside |
| 2026-10-01 | 2 | 4 | 105 | **PASS** — within 1.0 s, drift +5 ppm over 22.5 h, unread 357 min — 101 checked, 4 set aside |
| 2026-08-29 | 290 | 527 | 255 | **PASS** — within 5.1 s, drift −50 ppm over 22.1 h, unread 559 min — 82 checked, **173 set aside** |
| 2026-09-05 | 44 | 71 | 105 | **PASS** — within 1.6 s, drift +20 ppm over 25.0 h, unread 308 min — 95 checked, 10 set aside |
| 2026-08-20 | 1 | 1 | 12 | **PASS** — within 1.6 s, drift −17 ppm over 1.7 h, **read throughout** — 11 checked, 1 set aside |

⚠️ **2026-10-04 is not in this table and could not be.** The mirror holds no ring RTC log for it:
`tepna-archive-pull.timer` runs 13:30, after the box's 13:00 SD harvest, so today's night has not landed.
The unit was specified against 10-04's log (4 pushes, 43 reads, −1.1 → −0.6 s, 0 resets); that shape is
the synthetic plant in `test_THE_10_04_PLANT_a_disciplined_ring_night_PASSES_and_states_its_population`,
and 10-02 and 10-01 are the nearest real nights. A synthetic is not presented as the night.

## 6 · Not done here

- **No registry entry.** The SOLID-NIGHT bands are not in any `*-registry.js`: they are verdict bands,
  not surfaced metrics carrying an evidence badge, so there is no `evidence` field to set to `measured`.
  Said rather than invented.
- `verdict-adoption.json`'s `solid-night` note was **stale** and is corrected here: it still said the
  sample "is UNKNOWN on the timebase term, as every real night is until the residual pass lands", which
  #3245 changed — the sample now PASSes every term. The prose documenting an adopted gate had outlived
  the gate's behaviour by one PR.

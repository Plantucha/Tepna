---
bump: patch
type: fixed
brief: none
---

QC coverage divided one device's rows by the **session** span — the union across devices — so a device
that stopped early was charged for the time another kept recording, and **"stopped early" and "dropped
packets while recording" produced the same number.** Those are opposite findings: one is correct
behaviour, the other is the loss the metric exists to catch.

Coverage's own comment states the definition it was not implementing: *"did we receive the packets the
device was SENDING"*. It is now `rows / (rate × the DEVICE's own span)`, and the early stop is its own
published quantity.

**Measured on 2026-09-23**, one session 23:13:18 → 04:49:58, span 20,200 s:

| device | own span | own ÷ session | published | new coverage | `stopped_early_s` |
|---|---|---|---|---|---|
| H10 ecg | 20,089 s | 0.9945 | 0.99 | **1.00** | 0 |
| Verity ppg | 18,499 s | 0.9158 | 0.92 | **1.00** | 1,701 s (28.4 min) |
| Ring ppg | 18,699 s | 0.9257 | 0.92 | **1.00** | 1,501 s (25.0 min) |

Every published number was that ratio to four decimals, and QC's own `gaps` was **empty** for the night —
so the "missing 8 %" was two devices stopping half an hour before the third, not absence. The premise
this started from ("≈0.90 on every stream") was wrong in a useful way: the H10 read 0.99, so the split
was per DEVICE, and two of the Verity's were on a *measured* rate, which ruled the rate out as the cause.

**New fields:** `span_basis` (`device`, or `session` when a file carries no device clock and its own start
cannot be bounded — dropping such files would move the start later, shorten the span and INFLATE
coverage, so absence falls back rather than shrinking the denominator), `span_sec`, `stopped_early_s` with
`session_end` named beside it, and `stopped_early_reason: None` as a declared slot for Wren's wear-end
unit. `coverage_basis` keeps the rate's provenance; publishing only one factor of a two-factor denominator
is how the number came to mean two things. `_DEGRADED_BELOW` is unchanged.

**THE SHIFT IS PINNED, AND THE ALERT IS NOT LOST.** A stream that died at hour one of a six-hour session
used to read 0.18 and land in `degraded`; against its own span it delivered everything it sent, so
`coverage` now reads 1.00 with `stopped_early_s` carrying the five hours. That is more informative — the
old number could not tell it from a stream losing five hours of packets while still connected — but on its
own it would have retired the alert.

So the session-span ratio **stays, as its own named field** (`session_coverage`), and `degraded` keeps
keying on it: nothing that was flagged before stops being flagged, and **no threshold had to be invented**
to keep it — the number that was already there is named instead of overwritten. The twin pins both at
once: the hour-one stream reads `coverage` 1.00, `stopped_early_s` 16,489, `session_coverage` 0.18, and
`degraded`. When `stopped_early_reason` arrives (a doff is correct behaviour, a link loss is not),
`degraded` moves to coverage plus an *unexplained* early stop and `session_coverage` stays as the reader's
cross-check.

`session_coverage` is computed whenever the session span exists, independently of whether the device's own
span could be bounded — so the alert never quietly depends on a file carrying a device clock.

⚠️ **The existing suite could not have caught any of this**: `_cap` writes clockless `i;i` rows, so
`span_sec` is None, every fixture falls back to the session span, and all 170 tests pass unchanged either
way. The four new tests use `_cap_timed`, which carries real device stamps — the same fixture-fidelity gap
that let three tests pass on a full sha where production supplies an abbreviation.

⚠️ **The three new tests first passed in EDT and failed in CI's UTC by exactly 14,400 s.** `_session_of`
turns the `_YYYYMMDDHHMMSS_` filename stamp into an epoch with `datetime.strptime(...).timestamp()` — a
NAIVE datetime, so the conversion uses the reader's zone — while `mtime` is an absolute epoch that does
not move. Pairing a hardcoded epoch with a civil filename stamp is self-consistent only in the zone the
epoch was chosen in. The fixture now derives the session end from the stamp's own epoch plus the span, so
it holds in any zone, and the twin is parametrized over `UTC` and `America/New_York` so it cannot pass in
one zone again. Verified with `TZ=UTC ./check.sh`, which is what CI runs.

⚠️ **A production observation that follows and is NOT fixed here:** because that conversion uses the
reader's zone, `nightqc.summarize`'s session span is correct on the capture box (reader and writer share
a zone) and wrong by the zone delta for anyone running it over copied nights elsewhere. On-box behaviour
is unchanged by this PR; the off-box case is worth a row of its own rather than a silent widening of this
one.

The in-recording loss is planted and still reads as a loss: a Verity keeping its full span and losing 40 %
of its rows in one block reads **0.60** with `stopped_early_s = 0`, and a deeper loss still reaches
`degraded`. A device-span denominator that blinded that case would have traded one artifact for a real
blind spot.

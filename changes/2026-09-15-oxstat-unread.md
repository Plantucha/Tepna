---
bump: patch
type: added
brief: none
---

SHHS1 ships the out-of-band validity signal §∅ asks for, and nothing in this repo reads it.

§∅ says a value that was not measured is null — and, for the case where the sentinel is *in band*,
that "a consumer cannot null what it cannot distinguish", so **validity must travel out-of-band**.
SHHS1 carries exactly that: an `OX stat` channel, 1 Hz, sample-aligned with `SaO2`. No file in the
repo mentions it.

`to1Hz(sig, 40, 100)` nulls out-of-**range** samples — the 2026-09-12 fix, since withdrawn by its own
remedy. That guard is structurally unable to see an **in-range** sample the device flagged, which is
the residual case.

## Measured — 300 records, 278 with the channel

| | |
|---|---|
| ODI-4 as shipped | median **3.05** /h |
| ODI-4 with flagged samples nulled | median **2.15** /h |
| median change | **−0.700 /h — 23.0 %** |
| lowers ODI-4 on | **258/278 = 92.8 %** (raises on 3) |
| moves ≥ 1.0 /h on | **110/278 = 39.6 %** |

Worst single record: `shhs1-204801`, 30.8 → 16.2 events/h, with 22.4 % of the night flagged.

The design is paired: **one** `edfToOxyRows`, then `processNight` twice over the same rows — as
shipped, and flag-masked. Same detector, same rows, one difference, so the change is attributable to
the flag and nothing else.

## The flag is not assumed to mean "invalid" — it is shown to separate populations

No NSRR documentation was consulted and no meaning is imputed from the value names. The evidence is
distributional, which is what §∅ prescribes. Over 12 records / 367,680 samples:

```
stat 0   349,554   100.0% in-range   mean 95.00   p5 92.19
stat 1       162   100.0% in-range   mean 87.95   p5 74.22
stat 2    14,691    50.5% in-range   mean 94.19   p5 88.28
stat 3     3,273     0.1% in-range
```

Stat 3 and half of stat 2 are **already** excluded by the range guard. What survives it is 2.06 % of
all samples: in-range, flagged, accepted. Stat 1's p5 of **74.22** against stat 0's 92.19 is the
concerning part — flagged samples look like deep desaturations.

## Two things this does NOT show

**It is a consequence, not a remedy.** `OX stat`'s semantics are not established here. A flag may mark
a condition under which the reading is still true, so "mask it" is a hypothesis. Naming the fix needs
the channel documentation and is a separate unit — and 22 of 300 records carry no such channel, so any
remedy must handle its absence without treating absent-flag as flagged, or as clean by fiat.

**It does not rescue the ODI-4 surrogate — it deepens the gap.** `papers/odi4-ahi-bias.html` finds
ODI-4 *under*-reads scored AHI; masking pushes ODI-4 **lower still**, so a flag-aware detector sits
further below the reference, not closer. Read as "the under-count was an artifact", the sign is
backwards.

Filed as `2026-09-15-nsrr-ignores-oximeter-status`. No behaviour changed.

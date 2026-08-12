<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: PAT-OFFSET-ESTIMATOR-FOLLOWUPS-2026-08-12-BRIEF.md
---
`_PREF_RATE`'s comment claimed PPG 55 Hz was "the only rate those devices offer". It is not.

The SDK-MODE block twenty lines above has always documented the Verity's menu as 28/44/55/135/176.
The two lines contradicted each other and this was the one being read, which is plausibly why nothing
above 55 Hz was ever tried.

55 stays the default — it is all a normal-mode menu lists, and `chosen_rate` degrades to the nearest
offered rate — but the comment now records what it costs, measured on the 2026-08-11 box night:

  * one sample is 18.14 ms at 55 Hz;
  * systolic-foot scatter between the THREE co-located LEDs of one device (same clock, same pulse, so
    this is detection error alone) was 22.8-24.2 ms IQR, sigma ~12.7 ms — almost exactly one sample
    period, despite `refineFeet` interpolating sub-sample with the intersecting-tangent method the
    literature rates most accurate;
  * PPG beat detection found 20,911 beats against the ECG's 31,615 — a third never came out.

Raising a device stays a per-device config choice (`rates.ppg` + `sdk_mode: true`), not a change to
the default, and the comment carries the two things that make it safe: ~3.2x PPG volume at 176 Hz, and
confirm the rate from the RECORDED fs rather than the ACK, since SDK-MODE trap 2 makes a refusal look
transient and records the night at 55 believing it asked for 176.

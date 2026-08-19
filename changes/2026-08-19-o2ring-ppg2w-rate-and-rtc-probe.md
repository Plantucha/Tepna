---
bump: minor
type: added
---

**The O2Ring `ppg2w` sample rate is measured for the first time: ~100 Hz.** `tools/ppg2w-rate.mjs` derives
it from a coverage-calibrated count against the calibrated 125 Hz pleth — both streams cover the same
session, the pleth's count vs its KNOWN rate measures coverage, and that coverage applied to ppg2w's count
yields its rate. Gap-immune and waveform-free.

    2026-08-17: pleth 124.2 Hz raw (coverage 99.4%) → ppg2w 100.19 Hz  (round 100, residual 0.2%)
    2026-08-12: pleth (coverage 100.6%)             → ppg2w 100.99 Hz  (round 101, residual 0.0%)

⚠️ A first draft cross-correlated the pulse WAVEFORMS and returned **7 Hz** against a ~100 Hz direct count —
the autocorrelation locked on a harmonic and needed a bandpass the unknown fs made un-settable. The ratio
has no such failure mode: it never asks what the samples mean. Recorded because the wrong method looked
principled and the sanity number (direct count) is what exposed it.

**This unblocks the SpO2-trend prerequisite.** `ppg2w` is the raw two-wavelength stream; SpO2 is the
ratio-of-ratios of its channels, and a trend channel needed the rate to place samples in time. Rate now
known; the remaining blockers are WHICH-IS-WHICH (channel↔wavelength unproven) and the absent vendor
calibration curve — so any derived SpO2 ships `experimental` tier (valid for trends, never absolute) and is
its own follow-up.

**`probe_rtc_read.py` — the differential read-time probe (settles pull-time).** The ring has a clock (0xC0
writes it) but no documented read. This double-reads each read-only opcode (`0xE1`/`0x00`/`0xE4`) `--gap`
seconds apart; an RTC field betrays itself as bytes that advance by ~gap in some encoding. Read-only,
link-guarded. ⚠️ **Blocked on hardware, not code**: the ring only advertises when worn, and it was idle
(charger) at probe time — 18 other BLE devices seen, not it. Deployed to the box and ready to run the next
time the ring is on a finger.

Both tools carry selftests (`ppg2w-rate --selftest`: 6 assertions incl. an anti-hardcode control that a
130 Hz stream reads 130, not 100). Gate: `npm run test:tools`, biome clean.

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: PAT-OFFSET-ESTIMATOR-FOLLOWUPS-2026-08-12-BRIEF.md
---
nightqc reads the rate off the DATA, so a night is judged at whatever Hz it actually ran.

Three additions, all rate-agnostic by construction, ahead of running the Verity at 176 Hz:

`measured_hz` — the rate a stream file actually carries, from the DEVICE timestamps (the host column is
back-timed across each packet and measures packet cadence, not sample rate). Median inter-sample delta
rather than (n-1)/span: one dropout inside the window inflates the span and makes an endpoint estimate
UNDER-report, which would file a successful 176 Hz swap as a failure.

`rate_reality` — requested against measured, per stream. Coverage already noticed a rate swap, but named
it wrong: a refused 176 Hz delivers 31 % of the configured expectation and reports `degraded`, which
reads as dropped packets and sends you after the radio. This names it a rate fault.

`host_jitter` — host-side delivery jitter per packet. The DEVICE clock supplies the expected cadence, so
differencing consecutive `arrival - device` delays leaves only what the host added; a rate change cannot
move it. On 2026-08-11 it already found the Verity at 100-240 ms IQR against the H10's 45 ms — same host,
same night, same radio.

Coverage now divides by the MEASURED rate: delivery reads ~100 % at whatever rate ran, and the rate
mismatch is reported separately. Not tautological — `measured_hz` reads a 4000-row head while coverage
counts every row against the whole session span.

⚠️ The fractional rates are real and now documented with their mechanisms: H10 ACC is EXACTLY 645 ticks
of a 32768 Hz clock (50.7876 Hz, never 50), the Verity's 55.114/176.429 share one timebase at ratio
3.2013 against a nominal 3.2, and ECG is 129.995. Row inflation was ruled out directly — file rows equal
summed `n_samples`, ratio 1.000000 on all three Polar streams. The O2Ring is the exception and is pinned
by a test: its file adds a row per `156` beat marker, so counting rows yields ~125.7 for a 125.000 Hz
ADC, and only the `sensor timestamp` layout guard stops that being reported as a rate.

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: PPG-FOOT-PLACEMENT-FOLLOWUPS-2026-09-01-BRIEF.md
---
`pat-per-led`'s SNR column prints a real value for the first time — the guarded read of an
un-exported function had shown n/a since the tool was written.

`P.channelSNR ? P.channelSNR(c, fs).snr : NaN` always took the NaN arm: `channelSNR` is local to
`ppgdex-dsp.js`, never on the namespace, and the guard made the absence look like data. The triage
found a third option past export-or-delete: **`bandpass` and `std` ARE exported**, so the tool now
computes the identical spectral quantity by delegation (same ≤90 s mid-recording window,
0.7–3.0 Hz pulse band over 4.0–8.0 Hz noise band) — no DSP edit, no re-bundle, no divergable
filter copy. A 3-check selftest pins it against arithmetic (a two-tone plant; doubling the noise
tone must halve the ratio — gain-independent, so a constant-returning or wrong-band wrapper
fails). Execution proven on the 2026-08-16 box night: 20.59 / 19.99 / 20.44.

The `channelSNR` export itself still rides the next real re-bundle (the wrapper is marked to
delete then). FOLLOWUPS §2 stamped resolved; one residue recorded honestly there — `pat-per-led`
walks only date-directory corpora, so the flat canonical `Ecg nightly` yields a headers-only run
(out of §2's scope).

---
bump: minor
type: added
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

PpgDex now reports PER-CHANNEL detector noise for the Verity's three optical channels, with no
reference of any kind, via a three-cornered hat over their pairwise beat-time differences.

The three channels arrive in the SAME ROWS, so independent detection on each gives three observers of
one pulse on one axis. The physiology is common to all three and cancels in every pairwise difference;
the Allan deviation of each difference is then the SUM of two channels' noise, and the classic split
separates them:

    sigma_i(tau)^2 = 1/2 ( AVAR(i-j,tau) + AVAR(i-k,tau) - AVAR(j-k,tau) )

The same identity `integrator-tch.js` applies across NODES, applied here across CHANNELS of one sensor.
Built on the `allanFromPhase` that #1220 ships, so the existing cross-language parity gate covers it.

Measured on three real Verity nights: 99.8-99.9 % of beats form triples, ZERO negative-variance taus
out of 14/14/13, and all nine per-channel slopes fall in [-1.019, -0.995]. Non-negativity is the
identity's own independence check, so it never tripping is a measurement rather than an assumption.
Per-channel sigma at one beat runs 5.1-6.1 ms for channel 0 against 6.2-8.6 ms for the others, which
pairwise ADEV could never say — it can only ever report "channel i + channel j = 9.2 ms".

⚠️ TWO SCOPE LIMITS, BOTH SHIPPED IN THE PAYLOAD RATHER THAN NOTED AFTERWARDS.

**It measures NOISE, never CORRECTNESS.** A three-cornered hat is blind to anything that moves all
three corners together, and this suite has already been bitten by exactly that: PPGDEX-OPTICAL-POLARITY
(#1200) ran for three weeks with `orient()` choosing the wrong sign and ALL THREE CHANNELS AGREEING on
it, feet ~900 ms early on every channel at once. Under that failure the mutual differences stay small,
the non-negativity check stays clean, and this function reports three healthy channels at slope -1. A
gate assertion pins this: shifting all three channels by 900 ms leaves the split byte-identical. The
orientation the split was computed under (`polarity`, `polarityFlipped`) therefore travels with the
result, and `scope` states the limit in the exported object.

**The channels are not independent optics, and the hardware is why.** The Verity Sense carries SIX
LEDs of ONE wavelength (green) in a ring around a shared front end, so the three channels differ in
ILLUMINATION GEOMETRY over largely the same tissue, not in wavelength and not in detector. Everything
common to that front end cancels: motion at the site, contact pressure, ambient leakage, perfusion.
The published sigma is the INDEPENDENT RESIDUAL — a lower bound on a channel's true timing noise, and
the bound is loosest in exactly the conditions that matter most. This is not the multi-wavelength
motion-cancellation fusion that VIGIL-DEEP-ANALYSIS §6 refuted for this device: that combined channels
to cancel motion, which one wavelength makes impossible; this decomposes noise and is explicit that
the motion term is invisible to it.

`polarityFlipped` comes from `applyConsensusPolarity`'s return value, which the call site had been
discarding. It is the only surviving record that the three channels ever disagreed on orientation —
after that call the signs are unanimous BY CONSTRUCTION, so a post-consensus unanimity check is
vacuous and this count is not.

Refuses rather than approximating: fewer than three channels returns null (a two-corner hat is not a
hat), fewer than 200 triples returns null, and a tau whose split goes negative yields null for that
channel rather than a clamped zero pretending to be a measurement.

Naming is deliberate — "channel", not "LED". The device has six LEDs and the file exposes three
channels; the mapping between them is not in the data, and `ledAgreementPct` already means something
else in this node.

---
bump: patch
type: changed
brief: DEEP-AUDIT-V-2026-08-04-BRIEF.md
---

`DEEP-AUDIT-V` closes. Re-checked against `origin/main` eleven days on: **every filed finding is
resolved** — of 21, **20 cite a fix in source and F12 is refuted by measurement**; none open.

**Six were opened and read, not counted.** A citation can be aspirational, so F10, F11/F24, F16,
F20/F21, F22/F23 and F5 were verified in the code. All are real behaviour — `MAGN?` with the N optional
in both alternations, the coospo adapter gating on the NAME or the header LINE, `absIdx` present-gating
its inputs and returning `null`, the ECGDex worker shipping raw stamps back, OxyDex's *"NOT COMPUTABLE
is `null`, never 0"*, the TCH corner-label refusal.

**F20/F21 shipped a better fix than the brief prescribed, and documented why.** The brief called for
`Function.toString()`-ing `clock.js`'s `parseTimestamp` into the worker. That cannot travel — it closes
over module-scope helpers (`_ckMk`, `_dmy`) — and a serializer would live in the shared spine and
re-stamp all 8 provenance fragments for a bug in one app. The worker now returns raw stamp *strings* and
the main thread parses once with `DexClock`. Three parsers became one, and the one is the gated one.

⚠️ **F12 nearly got filed as the open item.** It is the only finding with no source citation, which reads
exactly like unfinished work. `DEEP-AUDIT-V-FOLLOWUPS` had already reproduced it over **every** IMU file
rather than one night, and the load-bearing half did not survive: all 61 GYRO files declare `[dps]`, not
one file anywhere has `max|gyro| > 2000` (the unmissable tell of raw LSB), and the claimed "543 files in
raw LSB" cannot reproduce because 61 is the total. Better still, the refutation names the discriminator
the brief already carried and read past — the no-gyro control (68 % / 100.4 ms) **equals** the "fixed"
result (66 % / 99.2 ms), so the conversion deleted the gyro term rather than correcting it. §4.7's
*"reproduce before this drives a DSP edit"* did its job.

⚠️ **Method note, because the first scan was wrong.** Counting citations by grepping `DEEP-AUDIT-V` beside
an F-number reported **eight** findings open. Files cite the brief as `DA-V §2.7 F17` and as a bare
`// F21:`, so the pattern under-reported — a **false absence**, which reads as "there is work here" and
would have sent someone to redo finished work. Widening the pattern took one command; the direct reads
are what make the corrected count trustworthy rather than the count itself.

**Not verified in this sweep, and recorded as such**: the tier-0 procedural items (browser re-base;
independent reproduction of F12's magnitudes, now moot) and tier 3.5's `no-fabricated-tier` widening. The
group exists and `badgeForLabel` is gated fleet-wide, but whether 3.5's specific extension landed was not
confirmed — F1/F14/F2/F3 all cite fixes, which is suggestive and not the same as checked. They carry to
`DEEP-AUDIT-V-FOLLOWUPS`.

Docs only: no code, no bundle, no fixture.

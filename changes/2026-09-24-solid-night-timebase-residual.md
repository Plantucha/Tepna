---
bump: minor
type: added
brief: SOLID-NIGHT-2026-09-23-BRIEF.md
---

TODO: one imperative sentence — this becomes the changelog bullet.

The SOLID-NIGHT §3.4 timebase term is measured instead of pending. Per Polar primary file, inside the
worn interval, one residual anchor per BLE batch: the device axis is classified as a clock or a drawn
counter, the host column is tested for independence, and the rate is bounded.

Three determinations that previously hid behind "timebase scan not built":

- a DRAWN device axis (modal inter-sample delta share >= 0.67) is UNKNOWN and never yields a rate.
  `independent` cannot see this — `clock.js` measured a real O2Ring counter reading `independent: true`
  at 2765.5 ppm for a device with no oscillator, because a 1 s-granular fabrication produces a LARGER
  residual spread, not a smaller one.
- a host column that only rounds the device (residual spread <= 2 ms) is UNKNOWN: no second clock.
- an implausible rate (|ppm| >= 50000) is FAIL — refused, never corrected.

The A5 step tripwire is a separate unit and is deliberately not half-built: the brief makes its fire
UNKNOWN `unrecorded-shift-candidate`, never a FAIL, and it needs a no-record check across three sources
plus two guards with their own named UNKNOWNs. The band therefore still ends UNKNOWN on a healthy axis,
but now names what it measured.

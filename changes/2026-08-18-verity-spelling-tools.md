---
bump: patch
type: fixed
---

**Four tools could not see the Polar Sensor Logger half of the Verity corpus — and the spelling was only
half the blindness.** The capture host writes `Polar_VeritySense_<serial>`, PSL writes
`Polar_Sense_<serial>`; one armband, same serial. Fixed: `acc-acc-control`, `dual-clock-rate`,
`known-clock-recovery`, `beat-error-recovery`.

**The control did the work twice.** After the spelling fix, `acc-acc-control` still matched **0** PSL files
— because PSL also writes the stamp as `YYYYMMDD_HHMMSS` (underscore inside) where the capture host writes
14 contiguous digits, and the pattern's `(\d{14})` was a second, independent blindness. Both patterns now
accept `(\d{8}_?\d{6})` and the stamp is normalised before the positional slices. A fix verified only by
"the code changed" would have shipped half-blind; the 0→54 count is what caught it.

Controls, on the real PSL tree ("Ecg nightly", 777 entries):

    acc-acc-control  ACC matches:  0 -> 50 H10 + 54 Verity
    dual-clock-rate  filter:      50 -> 104  (the 54 new = exactly the Polar_Sense files)

**Three of the seven flagged tools were NOT blind, and the distinctions matter:**

- `wearable-sync` already matches both — `/^Polar_(Sense|VeritySense)_/`. A literal grep for `Polar_Sense`
  cannot see a regex alternation; the sweep that flagged it has the same name-keyed blindness it hunts.
- `device-stability`'s only match is a selftest *fixture*; its `parseName` is fully generic.
- `trio-batch` is **deliberately** capture-host-scoped — its own comment says *"token `VeritySense` (not
  `Sense`)"*. Widening it would change what a batch run covers. Left alone, per that documented decision.

Selftests green (`known-clock-recovery`, `beat-error-recovery`); the other two have none. biome clean.

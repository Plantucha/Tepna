---
bump: patch
type: fixed
brief: none
---

PpgDex and PulseDex now open on the longest recording of a drop, and PpgDex shows no NaN on a short fragment.

- A night handed over from the vigil monitor carries its next-morning fragment. Both apps showed the file that they parsed last, so the fragment hid the overnight recording.
- `personalize` in `ppgdex-profile.js` ran on a fragment with no rMSSD. It wrote NaN into the HRV score, the VO2max estimate and the shared profile. It now writes `null`, and the hero card says that the session has no rMSSD.
- The PpgDex KPI tiles for pulse HR, rMSSD and SDNN show a dash when the value is absent.

Found in the vigil usability audit of night 2026-11-04. The PpgDex goldens moved only their embedded `manifestHash`.

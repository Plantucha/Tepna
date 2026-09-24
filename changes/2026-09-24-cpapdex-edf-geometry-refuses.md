---
bump: patch
type: fixed
brief: none
---
An EDF is read **by position**, so an unreadable `samples-per-record` field was never one signal's problem — it was the stride of every signal after it.

Absorbed as `0`, a null `samples-per-record` made `bytesPerRecord` too small, made `numRecords` (computed from `-1`) too large, and left the decode pointer un-advanced for that signal — so every later signal in every record read from the wrong offset. The output was not missing data. It was a complete set of plausible, wrong numbers, which is the one result no consumer can detect. The file now **refuses**, naming the signal — the same refusal it already makes for a short header and a bad signal count, one field later. Annotation signals are included deliberately: they occupy record bytes like any other.

A **degenerate digital range** is a different absence and gets a different answer. `(pMax - pMin) / (dMax - dMin || 1)` silently rescaled a signal by a factor of `(digMax - digMin)`, and because `NaN || 1` is `1`, an entirely *absent* calibration took the same path. That is one signal's absence, not the file's, so the signal is now `calibrated: false` with `NaN` samples and the night still parses.

⚠️ **The corpus refuted the first version of this fix, and that is the part worth keeping.** A blanket `recDurSec > 0` requirement rejected **two real nights** — caught by `regen-cpap-goldens`, not by the 1182 passing CPAP assertions, because every synthetic fixture has a positive duration. The real `20260612_222819_EVE.edf` writes `recDur = 0.00` with labels `["EDF Annotations","Crc16"]`: ResMed's event files carry no periodic sampling and EDF+ allows it.

So the two cases are split the way §∅ splits them — a field that could not be **read** is absent; one that was read and says zero is a **measurement**:

- `null` ⇒ refuse, the geometry is unknown
- `0` ⇒ accept, and every `fs` is **null** — never `0`, which reads as a measured rate, and never `spr/0 = Infinity`
- `< 0` ⇒ refuse, that is not a duration

Export-inert, computed not asserted: all six CPAP fixtures regenerate with **0 moved, 0 skipped**, including both real corpus nights, and the only fields that changed in any golden are `manifestHash`/`computeHash`.

The twin builds real EDF bytes and blanks one header field at a time, with the offsets derived in-test from the EDF layout rather than memorised. It carries the corpus filename and the reason for the zero case, so the next reader does not re-derive it. Reverting the parser reds 7 of the 9 original assertions; the two that survive are the well-formed-file controls, which must pass on both sides.

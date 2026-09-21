---
bump: patch
type: fixed
brief: none
---

**`validatePPI` ran Malik correction a second time on the export's already-corrected `nn`, and
`correctRR` is not idempotent.** Measured on a real 24,898-interval H10 night: pass 1 corrects 19,
pass 2 another 11, pass 3 one more. So the self-vs-firmware comparison put a twice-corrected self
series against a once-corrected device series, and `selfEctopyCorrected` — published as "how much
artifact the self side carried" — was the second pass's count (11 on that night, where the real pass
found 19). Residue `2026-09-13-ppgdex-correctrr-not-idempotent`; the row had placed the double pass
at the foot/peak spine pair, which are built from raw times and corrected once — the location was
wrong, the class was right.

The self side is now taken as-is; its correction count is the caller's one real pass
(`corr.nCorr`), or `null` when a caller cannot say — never a re-run's number. The device side is still
corrected once. Gated with a plant a pass would remove: the self series comes through with its
length intact, the count is the caller's, and a decoy proves the plant has teeth. On the committed
PpgDex fixture night the second pass had removed nothing, so the export is byte-identical and
verify-fixtures re-stamps it; PpgDex, both orchestrators and eight analysis tools rebuilt.

Fleet-Session: Magpie

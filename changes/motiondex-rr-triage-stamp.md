---
bump: patch
type: fixed
brief: MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md
---

**Two IN-PROGRESS briefs stamped with their verified state: the code is complete, and everything
still open is data-blocked.**

Both read as live work. Neither is. The stamp exists so the next reader does not re-derive that —
the same rediscovery cost the roster contract's triage-first rule is meant to prevent.

**`MOTIONDEX-RESPIRATORY-RATE`** — Part (A) landed in `7002778`; §10 built the figure layer; §11 ran
§1's corpus after discovering the apparatus was blind to *every* box-captured night; §12 fixed a
pre-flight that had been misreporting corpus size. **Nothing is open to code.** What remains is
§12.3's conclusion: the paper figures need paired `Polar_H10_*_ACC.txt` + `CPAP/<date>/*_BRP.edf` for
the same nights, and locally only **6 dates intersect** — the archive's own 104 ACC files are
`Polar_Sense_*` (Verity), which this tool does not pair. That is an owner data-staging action.

**`…-FOLLOWUPS`** — §2·§3·§4 gated and mutation-verified; §5 a recorded caveat (the confidence gate
is not an apnea filter); §6 closed as *probably never* (gravity-roll IQR 13.1–17.9° across 26 nights
is one posture, so the corpus cannot supply the contrast); §7 needs a second subject; §8 **refuted by
measurement** — "there is nothing left to notch".

⚠️ Recorded because it is the item most likely to be re-proposed: the shared **`nativeHz(rows)` spine
helper** stays deliberately unbuilt. It would re-stamp all 8 `manifestHash` values for exactly one
caller, and its proposed lint — *"no DSP computes a rate as `n / durSec`"* — was measured to have
**no subjects**, the only hits being genuine event rates. The local `nativeHz` now present in
`ppgdex-dsp.js` and `resp-acc-analysis*.js` is **not** that helper and does not discharge it.

Kept IN-PROGRESS rather than DONE: §1's corpus-run acceptance box is genuinely unmet. Kept out of the
queue because no code can meet it. Docs-only — headers plus their two `DOCS-INDEX` pills.

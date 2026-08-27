---
bump: patch
type: changed
brief: SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md
---

The σ_Verity = **3.51** figure is traced. §11 retired the weighting class; this locates the rest.

**Pre-registered before looking:** 3.51 belongs to a different generation/corpus, and "reproduces" means
landing within **±0.10 bpm (3.41–3.61)** — a band fixed in advance and not widened afterwards.

**The producing configuration is named in `PAPERS-ROADMAP`, on an axis I had not enumerated:** *"a
reference-free σ is not a number — it is a number PER WINDOW LENGTH … Verity 2.36 → 3.51 (+49 %) … from a
one-hour window to a whole night."* So 3.51 is the Verity corner at **whole-night window on the 17
box-captured nights available 2026-08-08**. Window length was in neither my hypothesis nor my enumerated
search space; `doc-search` found it in one query, which is the mandate earning its keep.

**But nothing reproduces it today.** Window sweep 3600 s → whole-night over 54 nights: **0.58 → 0.72**.
Box-era subset: 1.15 plain / 0.94 fused. The roadmap's own window 07-16…08-08 (n=23): median **1.19**,
**max 2.365** — not one night reaches the 3.41 floor. Pooled-seconds: 1.35. The window effect is real and
reproduces in kind (+24 % here vs +49 % then), but it acts on a corner that is now ~3× quieter.

**The discriminator is generation.** `ppgdex-dsp.js` has changed **20 times since 2026-08-08**, including
filtfilt running unpadded from zero state (DC transient at both record ends), the frequency domain
computed over `correctRR`'s substituted intervals, and a crystal axis running backward "hiding real
dropouts". The exports were regenerated under the current generation; 3.51 was produced by a PpgDex that
no longer exists.

🔴 **Verdict: located as a generation, not reproducible as a measurement.** Both halves are the result.

**Correction owed to published methods, now two-part:** state the **window length** (a σ without it is
underdetermined by up to +49 %) *and* the **generation** (the DSP producing the intervals moved 20 times
in three weeks, so corpus + window is still not enough to make the number re-derivable).

⚠️ The generation attribution rests on the code having demonstrably changed on the relevant paths, **not**
on a re-run. Checking out the 2026-08-08 `ppgdex-dsp.js`, regenerating the 17 nights and re-running the
whole-night hat would settle it beyond inference; that is a separate unit and is labelled as such.

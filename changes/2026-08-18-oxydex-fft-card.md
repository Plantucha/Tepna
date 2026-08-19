---
bump: patch
type: fixed
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

**The OxyDex `SpO₂ FFT` card documented the method its own code argues against.**

`OXYDEX-FFT-CYCLE-NULL-2026-08-16-BRIEF` replaced a raw argmax with a significance test two days ago;
the reference guide was never revised. Stale on four independent counts:

| the card said | `oxydex-dsp.js` does |
|---|---|
| `argmax \|X(f)\|²` | tests peak HEIGHT against a fitted AR(1) red background (Mann & Lees 1996) |
| band `0.003 – 0.1 Hz` | `_FFT_LO_HZ = 0.005` → `_FFT_HI_HZ = 0.05` (200 – 20 s) |
| `DFT on ≤3600 samples` | the record's own Fourier bins (k/N), `_FFT_MAX_BINS = 400`, strided |
| `None / >120 s` ⇒ no pattern | returns **null** whenever no bin clears significance, at any period |

The method claim is the serious one: the code does not merely differ, it argues against the card —
*"in a red spectrum the argmax sits near the low-frequency end by construction, so its position carries
no information."* A reader following the guide would attribute meaning to a number the implementers
deliberately stopped producing. The band error compounds it — `0.003 Hz` is a 333 s period, outside the
searched range entirely, so the card promised detections the code cannot return.

Only `0.003` was mechanically detectable (`tools/formula-constant-audit.mjs` flags a formula constant
absent from the node's source, fleet-wide: 7 guides, 381 formulas, 67 constant-bearing). The other three
came from reading the card against the code once the constant pointed at it — the sweep is a finder, not
a judge, and its yield here was one true positive that opened onto three more.

Card rewritten to state the periodogram, the real band and bin policy, the red-noise background, the
Šidák + ×2.2 inflation threshold, and the null return.

The remaining 5 fleet flags are triaged non-defects, recorded in the findings rather than suppressed
(reciprocal period restatements, a thousands-separated cohort size, and the cited sensor's nm
wavelengths). A list of known-fine flags goes stale silently — the failure this audit is about.

⚠️ `oxydex-dsp.js:1696`'s own header comment is also stale (`0.01–0.05 Hz` vs constants of
`0.005–0.05`) and is deliberately NOT fixed here: a comment edit moves `manifestHash` AND `computeHash`,
owing a corpus re-verification of every OxyDex fixture for a cosmetic gain. It should ride the next PR
touching that file's compute path.

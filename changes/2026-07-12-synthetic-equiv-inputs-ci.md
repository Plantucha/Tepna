<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite, OxyDex, PulseDex, HRVDex, GlucoDex, PpgDex, ECGDex]
brief: CPAP-REAL-CORPUS-2026-07-11-BRIEF.md
---
Make the `compute() ≡ committed export` equivalence gate actually run in CI — it never has. Every node now has a committed, synthetic, vendor-format input.

**The gate was decorative.** All eight equivalence legs skipped on any fresh clone:

```
⊘ OxyDex / PulseDex / HRVDex / GlucoDex / PpgDex / ECGDex / HRVDex(events) / PulseDex(events)
  "committed input absent — uploads/ is gitignored (personal data); this leg runs locally"
```

Each node's equivalence input is a **real recording**, so it is gitignored, so **CI never executed the
diff**. The GATE-C surface — the one CLAUDE.md §🔏 relies on to catch *"a code change that moved a
fixture's OUTPUT"*, and the only thing that closes the loop GATE B cannot — has been running **solely on
the maintainer's machine**. A regression that silently moved an export would have gone green through CI.

Found while executing §P2 (§M5 in the brief). §P2 fixed CPAPDex; this fixes the rest.

**The fix is the privacy constraint's own answer:** an input containing no personal data can be
committed. `tools/make-synthetic-inputs.mjs` emits one per node, in the exact vendor format each parser
expects — the **format** is reproduced, the **data** never is:

| node | vendor format | synthetic input |
|---|---|---|
| OxyDex | O2Ring/Wellue CSV (1 Hz SpO₂, DMY stamps) | 2 h with four desaturations |
| PulseDex | Polar H10 RR text | 30 min, RSA-modulated |
| HRVDex | Welltory HRV summary CSV | 30 daily readings |
| GlucoDex | Abbott Lingo CGM CSV (zoned ISO) | 3 days, three meal excursions |
| PpgDex | Polar Verity raw PPG (3 LED + ambient) | 40 s, with a prominent diastolic wave |
| ECGDex | Polar H10 raw ECG (130 Hz µV) | 60 s, full PQRST morphology |

All closed-form and physiologically plausible; no recording of any person, no device identifier.
Deterministic (no RNG, no `Date.now()`), so re-running reproduces every file byte-for-byte — which is
what lets GATE B content-address them.

**Result — the gate now has teeth everywhere:**

```
✓ OxyDex [synthetic].compute()   ≡ committed export — byte-identical
✓ PulseDex [synthetic].compute() ≡ committed export — byte-identical
✓ HRVDex [synthetic].compute()   ≡ committed export — byte-identical
✓ GlucoDex [synthetic].compute() ≡ committed export — byte-identical
✓ PpgDex [synthetic].compute()   ≡ committed export — byte-identical
✓ ECGDex [synthetic].compute()   ≡ committed export — byte-identical
```

Equivalence group **17 → 38** assertions. GATE B: **4 → 10** content-addressed fixtures.

**These ADD to the real-recording legs, they do not replace them.** The real inputs still run locally and
exercise genuine vendor quirks; the synthetic twins run *everywhere*. In `dex-tests.js` the twins are
derived from the real cases programmatically — same node, same `run`/`pick`/`fixPick`, only the input
differs — so a twin cannot drift from the case it mirrors.

**Honest limit.** This makes the existing gate *execute*; it does not strengthen what it asserts. The
ECGDex and PpgDex exports are event-only, and their real committed fixtures likewise carry zero events —
so those two legs pin `recording.contentId` (a content-fold of the parsed samples, which does catch
parser/DSP drift) rather than a rich metric surface. Giving those nodes an input that provokes real
events would strengthen them further; that is a separate follow-up, not a regression introduced here.

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex]
brief: NODE-EXPORT-DURATION-SEMANTICS-2026-07-27-BRIEF.md
---
`ECGDex`'s node-export `recording` now publishes **`endEpochMs`** — the floating wall-clock ms of the LAST sample — alongside `durSec`. This is the first node to land the owner-ratified duration-semantics ruling (option (c), see brief): `durSec` answers *how much signal do I have*, `endEpochMs` answers *where does this recording end on the clock*, and one scalar cannot answer both.

**The defect it closes.** ECGDex's `durSec` is DATA seconds (`n / fs` in the parser, `nnRes.activeSec` in `analyze`), so `t0 + durSec` lands short of the true end by exactly the dropout time. Measured over the 2026-07-16…26 capture corpus: **ECGDex's own events fell outside its own declared window on 11 of 11 nights, by +8 min to +326 min**. PpgDex/OxyDex do not show this — their durations already track wall span, which is the inconsistency the brief rules on.

**Read, never reconstructed.** The parser keeps a reference to the last valid row's Phone timestamp and parses it once after the loop; deriving the end from `durSec` + the gap list would be a guess, and Clock Contract §2.6 says an unknown value is `null`, never fabricated. Verified to round-trip the committed clip's last row exactly (`2026-06-17T01:12:19.371` → `1781658739371`). `analyze()` carries it through as a RECORDING property — the same explicit carry `offsetMin` already needs, because it belongs to the recording, not to the analysis.

**Additive.** `integrator-dsp.js normalizeFile` already prefers `endEpochMs` over every duration key, so a node that gains it is honoured immediately and one that has not behaves exactly as today. No derived fallback was added for the gapless synthetic path: there `t0 + durSec` is already exact, so `null` costs nothing and stays honest.

Gated by the new `ecgdex-dsp` group **ECGDex recording bounds — durSec (data) + endEpochMs (clock), read not derived** (9/9): a 130 Hz stub with a real 2 s dropout where data seconds and wall span provably disagree (data 3.08 s vs wall 5.07 s, `t0+durSec` short by 1.99 s), a stampless recording yielding `null`, and the carry through `analyze` into the export. The stub is deliberately NOT fed to `analyze` — it is a flat line with no QRS and `analyze` correctly refuses it ("Too few R-peaks"), a guard left intact; the export leg drives the real synthetic waveform instead.

Both ECGDex goldens regenerated via `tools/regen-ecgdex-goldens.mjs` (`recording.endEpochMs: undefined → 1781658739371` / `1781658437715`). ECGDex + the two orchestrators inlining `ecgdex-dsp.js` (Data Unifier, OverDex) re-bundled. **Not export-inert** — `computeHash` moved, so `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` re-ran the app and re-stamped `ECGDex_2026-06-27_equiv` → `verifiedUnder: fe4c976ca5da`. `run-tests.mjs` green **3951/0-skipped** against the real corpus, `build.mjs --check` clean (11 owned), `verify-manifest.mjs` GATE A+B pass (13 reproducible).

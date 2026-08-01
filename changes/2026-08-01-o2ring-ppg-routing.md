<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [PpgDex]
brief: ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md
---
`adapters/o2ring-ppg.js` — the O2Ring finger pleth now routes, and is analyzed at its true site.

**§1.4, and its stale blocker.** The O2Ring emits two unrelated streams: the 1 Hz `SpO2/Pulse/Motion` CSV (OxyDex's lane) and a ~125.7 Hz raw optical waveform in `*_PPG.txt`. `oxydex-spo2` matched the vendor token **alone** and claimed both at 0.95; `polar-sense-ppg` claimed the `_PPG` suffix at 0.85. Gap 0.10 < the 0.15 ambiguity threshold, so the pleth routed `ambiguous` and, in §1.4's words, *"is never analyzed as PPG in either host"*.

§1.4 held this behind two blockers and warned (i) must not land without (ii). **(ii) is stale** — it says "PpgDex has no single-channel and no finger-site path", but `PPGDEX-O2RING-FINGER-SITE-2026-07-18` is **DONE (2026-07-20)**, verified on hardware, and `parsePPG` returns `site:'finger'` with a single-channel beat lane. Verified in the tree, not read off a status line.

**Routing.** New `o2ring-ppg` adapter (vendor Wellue/Viatom, signalType `ppg`) claims vendor-token + `_PPG` at 0.97 and REFERENCES `PpgDex.parsePPG` — no second parser. The tie is broken by two symmetric declines rather than by out-bidding: `oxydex-spo2` declines a `_PPG` waveform stream (it parses 1 Hz CSV rows), and `polar-sense-ppg` declines a *foreign vendor's* `_PPG` — routing a Wellue waveform through an adapter whose provenance reads "Polar Verity Sense / OH1" would stamp a false vendor on the export, worse than the ambiguity it replaces. An unknown-vendor `_PPG` still takes the 0.85 PSL default, which is what that rule is for.

**And a latent defect the routing exposed.** `site` is spent as an evidence-tier decision — it selects the morphology tier (dicrotic notch, augmentation index, Takazawa b/a, all graded against WRIST-validated literature) and gates three Integrator fusion paths. The layout→site rule lived only inside `parsePPG`, so `compute()`'s SignalFrame branch rebuilt a rec with **no `site`** and the export took its `rec.site || 'wrist'` default. Invisible while `polar-sense-ppg` was the only adapter that could produce a ppg frame — its recordings really are 3-LED, so the default was right for the wrong reason. Routing a FINGER layout through that branch would have stamped a wrist-validated tier onto a fingertip pleth: exactly the harm blocker (ii) existed to prevent. `deriveSiteFromLayout` is now single-sourced and both ingest paths call it.

**Measured end-to-end on the real corpus**, not asserted: a 7.4 h `Wellue_O2Ring-S_…_PPG.txt` routes `o2ring-ppg` 0.97 (unambiguous) and exports `site:"finger"`, `siteSource:"device-default"`, 8 ganglior events — where the same file under the previous code routed `ambiguous` and, forced through, exported `site:"wrist"`. A Verity file is unchanged: `polar-sense-ppg` 0.97, `site:"wrist"`.

Mutation-verified, each applied-and-confirmed before running (a first attempt at these substitutions silently no-op'd and the resulting "no failures" meant nothing):

```
revert oxydex-spo2's _PPG decline        → ✕ ambiguous again (runnerUp oxydex-spo2 0.95)
revert polar-sense-ppg's vendor decline  → ✕ ambiguous again (runnerUp polar-sense-ppg 0.85)
drop site from the frame branch          → ✕ single-channel exports "wrist" · replicated exports "wrist"
```

**`computeHash` moved** — `c7a8e6dea17d → 2acf0985e625` (manifestHash `3cf2bab1cf06 → 0b5938e075c0`), so this is **not** export-inert and re-verification was owed and run: `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`. Fixture outputs did not move (every equiv leg green); 13 bundles rebuilt — PpgDex, Data Unifier, OverDex, and the 8 analysis pages that inline `ppgdex-dsp.js`.

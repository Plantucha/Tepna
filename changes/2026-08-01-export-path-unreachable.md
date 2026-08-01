<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [GlucoDex, MotionDex, HRVDex, PulseDex, OverDex, suite]
brief: EXPORT-PATH-UNREACHABLE-2026-08-01-BRIEF.md
---
Make every node's export reachable from its own UI, and gate it by pressing the buttons.

GlucoDex's `⬇ JSON` threw `GLUDSP.glucoCells is not a function` (defined in the DSP, never published);
MotionDex enabled its export button inside a `display:none` bar it never revealed, and its export
carried no `kernel` block; HRVDex's permanent `.mobile-nav` (z 500) covered `#exportBar` (z 400) at
every width above 1080 px, so no export button was clickable; PulseDex and HRVDex both had
`exportGanglior()` wired to no control at all, so neither could emit the `ganglior.node-export` the
Integrator's own warning told users to produce. OverDex asked the adapter registry before the
node-export sniff, and `adapters/oxydex-spo2.js` claims `/oxydex/i` on the filename — so OxyDex's own
export was fed to the SpO₂ row parser and silently dropped from every fusion; its routing manifest
also named PulseDex for ecg/ppg/cgm/cpap. Adds an `exportBarProbe` to render-coverage (bar displayed +
`elementFromPoint` hit-test per button + required controls present), gives MotionDex the render-coverage
leg it never had, and settles each leg on `#exportBar.show` — which de-hollowed the GlucoDex leg, whose
every assertion passed on an empty page.

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: EXPORT-PATH-UNREACHABLE-FOLLOWUPS-IV-2026-08-01-BRIEF.md
---
Stop PpgDex exporting an O2Ring finger night as a wrist-worn Polar Verity.

ppgdex-app.js's export builder hardcoded `device: 'Polar Sense'`, so a real Wellue O2Ring recording
shipped provenance naming the wrong instrument at the wrong body site — a field that names the wrong
device is worse than an absent one. The device now follows the same optical-layout evidence the DSP
already read, and the builder emits the `site`/`siteSource` pair its DSP sibling has carried since
#626, so the two builders no longer disagree about where the signal was taken from. Source-scan gate
added, because the equiv legs run compute() and never execute the app's builder.

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---
Two new pages in the vigil monitor's sidebar — **Ledger** and **Capture** — one index behind both
(owner request 2026-09-20: "put in vigil html monitor in left sidebar another page … table … when
you click on number with size it will automatically load … to analyzer tool").

- `nights_index.py` + `GET /api/nights?n=`: every night on the box, per analyzer — the bytes of the
  files that analyzer's own file input accepts, the hours its primary stream covers (first→last
  stamp, head and tail reads only; an EDF's `records × duration` from its header), the file list,
  and whether it is loadable. Absent input is `None`, never 0; an unreadable span is `hours: None`
  beside its real byte count (§∅). The two derived tools (3 corner hat, PAT) are eligibility flags.
  The Integrator's cell is the raw input a fold would take and is `loadable: false` — folds run on
  rig, not in the browser. Tests at 100 % on a synthetic tree carrying the box's real layouts.
- **Ledger**: the dense per-analyzer table, one figure `MB / h` per tool; amber size = the stream
  covered under 60 % of the night's longest. **Capture**: the same rows, device-grouped columns, a
  coverage bar per cell, and a per-night drawer listing every file with an Open ▸ per analyzer.
- **The click loads AND processes, with no bundle change.** The apps, the nights (`/captures/…`)
  and the monitor share one origin behind Caddy, so the page opens the analyzer, fetches the
  night's files, and hands them to the app's OWN file input as a drop would — the app's `change`
  listener runs its ingest and analysis. ECGDex is routed by stream suffix into its four inputs.
  Opened from any other origin (127.0.0.1:8760 directly) the app window is closed to the page and
  the click degrades, said in a toast, to "opened — drop the files yourself".

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: ''
---
Fix the evidence badge where the public site actually shows it — and put PpgDex on the front door.

The badge system is gated (`cohesion-badges`) across the seven reference guides, so it held there. It
did not hold anywhere else, because nothing checks anywhere else:

- **The deploy mirror was stale.** `docs/` is the deploy root; `tools/build-docs.mjs --check` reported
  `STALE (3)`. The live `docs/index.html` was still hand-drawing the ladder discs. Rebuilt — without
  this, every other fix here ships to nobody.
- **`index.html` + `Architecture.html` encoded trust with OPACITY** (`.78` / `.55`) and hand-drawn
  `.disc` divs, with no `dex-badges.css` link — the one thing CLAUDE.md §🎫 forbids. `Architecture.html`
  did it directly beneath its own sentence "Trust is encoded in disc shape, never hue", and painted
  `heuristic` in a different ink, so hue encoded tier. Both now link the canonical mirror and use
  `.ev ev-<tier>`; the local rule sets SIZE only (`transform:scale()`), never a disc property.
- **The light theme deleted the `heuristic` badge in all 7 reference guides.** They override
  `body.light .ev-*{border-color:var(--surface)}`, but `heuristic` is the one tier whose *shape is its
  border* — white dashed ring on a white card. Measured in-browser: 61 discs on the OxyDex guide,
  invisible. The least-trusted tier rendered as nothing, so a heuristic number read as UNBADGED — the
  bug class the mandate rates equal to a wrong unit. Override now scoped to `.ev-measured`, the only
  tier with a background-coloured gap ring.

Also on the front door: **PpgDex had no device card** (nor a footer link) despite shipping a bundle and
a reference guide — and the PulseDex card claimed *Verity Sense*, which is PpgDex's sensor. Per the
ORIENTATION roster, PulseDex reads an RR series (Polar H10 `*_RR.txt`) and PpgDex reads raw optical PPG
(Verity Sense `*_PPG.txt`). Card added, PulseDex re-attributed, and its sparkline is now a tachogram
rather than a pulse waveform so the picture matches what the node reads.

`ECGDex Reference.html` was titled "OxyDex — Reference Guide" — in the browser tab, bookmarks and search
results, deployed copy included.

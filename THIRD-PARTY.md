# Third-Party Notices

**Tepna — Physiological-Signal Analysis Suite**
Copyright 2026 Michal Planicka · Licensed under Apache-2.0 (see `LICENSE`/`NOTICE`).

---

## Summary

Tepna bundles **no third-party source code** and (after the font change below)
**no third-party fonts** either. It makes **no network calls** — no CDNs, no web
fonts, no analytics, no telemetry. Everything runs locally from a single HTML
file per node. All charts/visuals across every node are hand-authored (inline
SVG, or the first-party canvas renderer `hrvdex-chart.js` in HRVDex) — there are
no charting-library dependencies.

| Category        | Status                                                            |
|-----------------|-------------------------------------------------------------------|
| Code libraries  | None bundled. No runtime dependencies.                            |
| Fonts           | System stacks only (see below). No `@font-face`, no CDN.          |
| Network         | None. 100% local / offline.                                       |
| Data files      | User-supplied recordings only (`uploads/`). Not redistributed.    |

---

## Code libraries

**None.** The suite has no runtime code dependencies. HRVDex's charts are drawn
by a first-party canvas renderer (`hrvdex-chart.js`, Apache-2.0); every other
node uses hand-authored inline SVG. (Historically HRVDex inlined Chart.js +
@kurkle/color (MIT); these were removed in June 2026 and replaced with the
first-party renderer, so no third-party code ships.)

---

## Fonts

The suite uses **operating-system font stacks only**. The names `Inter` and
`IBM Plex Mono` may still appear in CSS `font-family` declarations, but they
are *fallback labels* — when the named font is not installed they resolve to
`system-ui` / `ui-monospace`. **No font binaries are shipped, fetched, or
embedded.** There is therefore no font-license obligation.

> PulseDex historically embedded **IBM Plex Mono** and **Inter** woff2 binaries
> as inliner assets. Both were removed in June 2026 so PulseDex matches every
> other node (system `ui-monospace` / `system-ui`). **No third-party font
> remains** anywhere in the suite.

---

## Clinical & scientific references (NOT code dependencies)

The metrics, formulas, and thresholds implemented in the analyzers are drawn
from the peer-reviewed literature. These are **scholarly citations**, not
software dependencies, and carry no software license. The authoritative,
per-metric reference lists live in the node reference guides (e.g.
`OxyDex Reference.html`, `ECGDex Reference.html`) and in the preprints under
`papers/`. Each metric also carries an evidence grade
(measured · validated · emerging · experimental · heuristic).

---

## Vendor data formats (interoperability, not bundled code)

The parsers read files produced by third-party hardware/apps (e.g. O2Ring /
Wellue / ViATOM oximeters, Polar H10 + Verity Sense via the Polar Sensor Logger
app, NSRR EDF/XML polysomnography exports). Supporting a vendor's file *format*
is interoperability and creates no licensing obligation; no vendor code is
included.

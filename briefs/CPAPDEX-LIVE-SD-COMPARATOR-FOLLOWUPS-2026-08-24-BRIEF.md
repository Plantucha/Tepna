<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-25 · **Created:** 2026-08-24

# CPAPDex live-vs-SD comparator — follow-ups

Spawned on executing [`CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23-BRIEF.md`](CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23-BRIEF.md)
(the comparator surface — engine, panel, fixture, riders, guide, app trigger; all Done-when met,
`npm run check` green). What surfaced during execution and still wants doing:

## 1 · The in-browser DOM flow needs a visual smoke test — it is NOT headlessly gate-testable
The engine (`compareChannel`/`cpapCompare`), the panel render (`comparatorPanel`), and every refusal
path are gate-backed (comparator group, 26 assertions; the GATE-C re-run leg reproduces the golden).
But the actual app trigger — the **⚖ Compare live capture** button → `FileReader` → `readEDF` → panel
injection into `#comparatorHost` → `drawScaleSpark` on the injected canvas — runs only in a real
browser and no headless lane exercises it. **Load `CPAPDex.html`, load an SD night, drop a live BRP,
confirm the panel renders + the sparkline draws + the role-assumption line prints.** Until then the DOM
wiring is asserted only by inspection.

**RAN 2026-08-24 (coordinator, served bundle, committed twins through the real UI).** The engine and
flow work: night loads, ⚖ trigger present, second-file upload → panel injects with the correct headline
(`device-clock aligned · n = 27.4 min overlap`), the role-assignment line prints verbatim, the
scale-over-time verdict reads `stable`. Three findings, all resolved in the visual-smoke follow-up PR:

- **(1) FIXED — the four KPI cards rendered invisible.** `.kpi` (ans-design.css) carries
  `animation:cardEntrance` whose `from{opacity:0}` + `both` fill leaves dynamically-injected tiles stuck
  transparent — worst under `prefers-reduced-motion`, where the global `*{animation-duration:.01ms}` reset
  makes the active phase vanish. The values were correct in the DOM (a11y saw them); only the paint was
  missing — exactly the class this headless-immune smoke test exists to catch. Fix: scoped
  `#comparatorHost .kpi{animation:none}` (base bg/border/padding stays). The sparkline overlapping its
  label was fixed the same PR (own line + margin).
- **(2) FIXED — "33.7% of paired samples outside the agreement band" on a near-identity twin.** The
  excursion band was `1.96·residSD` (the POST-regression residual SD) counted against the RAW diffs
  (B−A), so a pair with scale ≠ 1 counted the systematic gain the residual removed. Corrected to the
  Bland–Altman LoA (`bias ± 1.96·SD-of-diffs`) — the same band the panel prints as loLoA/hiLoA. Golden
  `excursionFrac` 0.337 → 0 (a bounded consistent pair sits ~0% outside the LoA; real divergence still
  shows non-zero).
- **(3) DOCUMENTED — the committed twins can't enter through the app's normal file flow.** The loader's
  filename gate wants the ResMed `YYYYMMDD_HHMMSS_BRP` pattern and rejects
  `cpapdex_comparator_*_twin_BRP.edf`. Engine-API tests bypass this (the golden is unaffected), so it is
  not a defect — but any future visual/E2E use needs date-shaped copies (`20260824_000000_BRP.edf`
  works). **Open option:** teach the loader the twin names, or keep the copy step. Documented here rather
  than changing the loader for a test-only convenience.

## 2 · v2 wide-xcorr for a genuinely broken clock (v1 refuses by design)
v1's `maxLagSec` default is 5 s — a FINE correction only. A large device-clock disagreement REFUSES
and quantifies it (the 42-min EdfSink class), which is correct: aligning through a broken clock would
launder a defect into a rosy scale. A v2 **opt-in** wide-xcorr (bounded, with a loud "aligned through a
N-minute clock break" banner) could still salvage agreement numbers from a recording whose clock is
broken but whose flow is fine — but only behind an explicit opt-in, never as the default.

## 3 · Auto-coimport by device-clock date (the MVP is manual second-file)
The lead ratified role-from-position (primary-loaded = SD, explicit second file = live) and rejected a
two-slot picker. A future enhancement: when TWO BRP sources for the same device-clock date are already
loaded, offer the comparison automatically. Still needs the role designation (position or a UI toggle)
because content-sniffing is impossible (the live BRP is byte-compatible with the SD format).

## 4 · Multi-channel (v1 is BRP/Flow.40ms only)
`compareChannel` is channel-agnostic and `cpapCompare` already loops channels, but v1 ships BRP flow
only. A PLD-pressure comparison (live-vs-SD delivered pressure) is the natural next channel; SA2/PLD
appear only as documented non-goals in v1.

## 5 · Replicate the n=1 pins
Both agreement numbers are single nights: night n=1 SD/live 0.9977 flat-in-time; daytime n=1 0.924
(superseded). The reference guide labels them n=1 by design. Fold more paired capture-host nights (the
box owes the captures) to turn either into a validated agreement rather than a single data point.

## Triage — 2026-08-25, coordinator (owner-directed "execute executable or ask")

- **§2 wide-xcorr v2 — DECLINED until a real broken-clock recording needs it.** The refusal IS the
  product (the comparator exists to scream on the EdfSink class); building the salvage mode now would
  be capability without a customer. Reopen criterion, concrete: a real night refused for clock
  disagreement whose flow data someone actually needs salvaged. The quasi-periodic false-lock hazard
  note travels with it whenever it is built.
- **§3 auto-coimport — DECLINED.** Role-from-position is the ratified safety design precisely because
  content-sniffing is impossible; an auto-offered comparison would reintroduce the role-ambiguity the
  explicit second-file flow was chosen to avoid, to save one click. The manual affordance stays.
- **§4 PLD-pressure channel — SCHEDULED as the natural v1.1**, no new brief needed: `compareChannel`
  is already channel-agnostic, so this is a small extension rider on whichever CPAPDex unit next
  touches the comparator (tepna-99's lane). Delivered-pressure live-vs-SD is the first channel where
  a divergence would be therapy-relevant rather than telemetry-relevant.
- **§5 replicate the pins — ONGOING BY CONSTRUCTION, not a schedulable unit.** Every paired
  capture-host night adds n for free now that both paths run in production; the box's nightly capture
  + 13:00 harvest is the collection mechanism, and the guide's n counts update as pairs accrue. No
  brief; the numbers stop being n=1 by themselves.

## Done when
- [x] §1 visual smoke test performed and recorded (coordinator, 2026-08-24) — three findings, all resolved in the visual-smoke follow-up PR (invisible cards, divergence band, filename-gate note).
- [x] §2–§5 triaged (2026-08-25, above): §2 declined-until-need with a reopen criterion, §3 declined,
      §4 scheduled as a comparator-touching rider, §5 ongoing by construction.

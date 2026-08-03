<!--
  BLANK-ON-PRINT-FLEET-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-03 (⛔ **its premise is REFUTED — the fleet was already fixed by `entrance-guard.js`.** Kept, not deleted, because the measurement it produced is the FIRST proof that the guard actually works, and it found a real residual gap: nothing gates the guard. See §0 and §6.) · **Created:** 2026-08-03 · **Spawned-by:** `AUDIT-FOLLOWUPS-BRIEF.md` §4.1 · **Corrects:** its own §1, and `AUDIT-FOLLOWUPS-BRIEF.md`'s §4.1 note

# ⛔ REFUTED — six apps do NOT print blank; `entrance-guard.js` already fixes it

## 0 · The correction, and how the error was made

This brief was created hours earlier claiming §4.1 was a live 🔴 across six apps. **It is not.**
`entrance-guard.js` — which does exactly what §3 route (b) proposed, documents the identical mechanism,
and is **inlined into all 8 node bundles** (CPAPDex · ECGDex · GlucoDex · HRVDex · MotionDex · OxyDex ·
PpgDex · PulseDex, loaded by each `*.src.html`) — has been shipping the whole time. The Integrator has
its own scoped guard. Every app is covered.

**How the error was made, precisely:** the defect was verified in `ans-design.css`, which is where it
lives — and then never checked against the *shipped configuration*, where something else neutralises it.
The reproduction probe linked `ans-design.css` **alone**. It was not a bundle. So it faithfully
reproduced a stylesheet that no app ships in isolation.

That is the same root cause as three other mis-calls the same day (a grep for a button label rather than
the paths that changed; `integrator-app.js` searched for a feature that lives in
`integrator-longitudinal.js`; a grep for the literal `"HH:MM:SS"` in code that *produces* it). The
generalisable rule: **verify against the artifact the user actually runs**, not against the file where
the defect would live if unmitigated.

## 1 · What the measurement DID establish — the first hard proof the guard works

Chrome headless, `--virtual-time-budget` sweep, a 400×200 magenta block inside `.chart-card`, counting
matching pixels in the PNG. `--virtual-time-budget=N` is the honest model of a capture pipeline: it
advances virtual time by at most N ms before snapshotting.

| configuration | vtb=1 ms | vtb=50 | vtb=200 | vtb=5000 |
|---|---|---|---|---|
| `ans-design.css` **alone** (unmitigated) | **0** | **0** | **0** | 80000 |
| `ans-design.css` **+ `entrance-guard.js`** (as shipped) | **80000** | — | — | 80000 |

80000 = exactly 400×200, i.e. fully painted. **0 = totally invisible, not a partial fade.**

A second, independent probe froze the timeline directly
(`document.getAnimations().forEach(a => { a.currentTime = 0; a.pause(); })`) and read computed style:
unmitigated, `.chart-card` and `.chart-svg` both compute `opacity: 0`; on `finish()`, both `1`.

So: the CSS defect is **real and total**, the guard **demonstrably neutralises it**, and until now
nothing had ever shown either. `entrance-guard.js`'s own header was an argument; this is a measurement.

**A methodological note worth keeping.** The first attempt at proof searched the print-to-PDF output for
a marker string and reported "blank". A control page with the animation disabled reported "blank" too —
the *detector* was broken (text is emitted as subsetted glyph indices, not literal ASCII). Without that
control the false positive would have shipped. **Run the control before believing the finding.**

## 2 · The one thing that is genuinely missing: nothing gates the guard

`entrance-guard.js` appears in `tests/dex-tests.js` exactly once — as a **comment in an exclusion list**
(`:21110`, *"DOM print/entrance guard (CSS injection, no compute surface) — exercised by the
render-coverage bundle boot"*). No assertion reads it. Nothing checks that a node's `.src.html` still
loads it, that a bundle still inlines it, or that its CSS still pins the selectors `ans-design.css`
animates.

That matters because the guard is **invisible when working**. Delete it, weaken a selector, or ship a
9th node that forgets the `<script>` line, and every gate stays green while capture output silently goes
blank — the failure mode nobody reports, because the person seeing it assumes they did something wrong.
The guard is exactly the kind of load-bearing thing this repo keeps discovering was never exercised.

## 3 · The gate to write (recipe, deliberately not half-built here)

Two legs, cheapest first:

1. **Content leg (both lanes, cheap).** Add `entrance-guard.js` to `SOURCE_FILES` in
   `Dex-Test-Suite.html` **and** the `wanted` list in `tests/run-tests.mjs readSources()` — it must be in
   BOTH or the scan reads nothing in one lane (the `motiondex-dsp.js` hole, noted in that very file).
   Then assert its injected CSS still pins, with `!important`, every selector `ans-design.css` drives
   from `opacity: 0`. Derive the required set **from `ans-design.css`** rather than hard-coding it, so a
   newly-animated selector fails until it is guarded.
2. **Wiring leg (Node lane only).** Every `*.src.html` that references `ans-design.css` must also
   reference `entrance-guard.js`; every shipped node bundle must inline it. Reads the tree, so mirror
   the `docsLedger` pattern — Node reads fs, browser SKIPs.

**Anti-vacuity is mandatory on both**: the scan must fail if it locates nothing, and the whole thing must
be verified by *re-applying the defect* (delete the guard's `.chart-card` selector → the gate must red).
A gate for an invisible-when-working guard is worthless if it can pass on silence.

**Do NOT** "fix" `ans-design.css` as this brief originally proposed. The mitigation is deliberate and
documented: `entrance-guard.js`'s header explains it avoids editing `ans-design.css` precisely because
that file is inlined into every bundle's template, which would shift every app's legacy template hash.
Editing it now would be a fleet-wide re-bundle to re-solve a solved problem.

## 4 · What was NOT done, and why

No code changed. No re-bundle. The fleet-wide `ans-design.css` pass this brief was written to schedule is
**cancelled** — it would have churned every bundle and every provenance fragment to fix nothing.

## 5 · Carried forward — still open, still real

`AUDIT-FOLLOWUPS` §4.2: the 🔴 evidence-badge **coverage mandate** was only made compliant in the
Integrator; the six node apps have never been audited for unbadged surfaces (`CLAUDE.md` §🎫 — an
unbadged number reaching a user's eye is a bug of the same severity as a wrong unit). Unaffected by this
refutation, and it now needs its own brief since this one is closed.

## 6 · Done when — reframed to what this brief actually settled

- [x] The `ans-design.css` mechanism reproduced and quantified (0 px vs 80000 px; computed `opacity` 0).
- [x] The shipped configuration tested and shown **not** to blank — the premise refuted before any
      fleet re-bundle was started.
- [x] The false-positive detector caught by a control, and the control recorded.
- [ ] **Owed:** the §3 gate, so the guard cannot regress unseen. Its own brief.
- [ ] **Owed:** §5's badge-coverage audit. Its own brief.

## Cross-references
- `entrance-guard.js` (the mitigation, and its header's rationale for not touching `ans-design.css`) ·
  `integrator-render.js:29-37` (the Integrator's scoped equivalent).
- `ans-design.css` :217 · :221 (the keyframes) · :854 · :911 · :1036 · :1045 · :1195 · :1769 (the seven
  consumers) · :240 (`prefers-reduced-motion`) · :2389 (the sole `@media print` rule).
- Parent: `AUDIT-FOLLOWUPS-BRIEF.md` §4.1 — its note is corrected by this brief.

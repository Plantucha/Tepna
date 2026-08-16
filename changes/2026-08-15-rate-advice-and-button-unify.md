---
bump: patch
type: changed
---

**Two UI fixes in the vigil monitor, both about a decision the operator was being asked to make blind.**

**1 · A recommendation with no reason is a default wearing a badge.** The Settings panel already built
each stream's dropdown from the device's own menu and ticked `✓ recommended` on the preferred rate — but
the preference came from a table of bare numbers, so the tick could not be re-judged by the person it was
aimed at. Every stream now carries its rationale beside the tick.

**⚠️ And the single-option case said nothing at all — which is exactly the Verity.** Outside SDK mode the
device offers PPG as `[55]`, so no `<select>` renders and the operator saw a bare "55 Hz" with no way to
learn that 176 exists or what it costs. That was the decision they were being asked to make *daily*, and
the UI was silent about it. It now reads:

> **55 Hz — the only rate this device offers here** — stable all night, and it is the only rate offered
> outside SDK mode. 176 Hz cuts beat-timing quantisation from ~18 ms to ~5.7 ms — better for PAT and beat
> work — but needs SDK mode, which makes PPI permanently invalid and drops the link about every 90 s.

Single-option is reported *before* "recommended" even when they coincide: saying "55 Hz recommended" where
55 is the only value implies a choice was weighed, and the operator then cannot tell a preference from a
constraint. `spo2` and `ppg2w` are covered too — the O2Ring reports no menu, and "no choice" must not look
like "we did not look".

**2 · The three button classes disagreed by construction.** `.btn-primary` and `.btn-destructive` were
standalone rules that each re-declared geometry rather than modifying `.btn`:

    .btn              padding 7px 14px · radius 10px · 12px · semibold
    .btn-primary      padding 8px 18px · radius 10px · inherited · 700
    .btn-destructive  padding 6px 11px · radius  8px · 11px · 500

Three sizes and two corner radii in one toolbar. Because each variant was self-sufficient the markup
drifted as well — 9 buttons wrote the variant class alone, 2 composed it with `btn`, 1 did not — and
**both forms rendered**, which is why the split survived unnoticed.

Geometry now lives only in `.btn`; the variants set colour. Weight is the one deliberate exception: it
signals which button is the primary action, which is meaning rather than shape. All 30 buttons compose,
so a variant on its own is now visibly wrong.

Verified by rendering the page and comparing the controls, not by reading the CSS.

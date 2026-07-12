<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex, CPAPDex, HRVDex, PulseDex, ECGDex, GlucoDex, PpgDex, OverDex]
brief: DEEP-AUDIT-2026-07-11-BRIEF.md
---
Stop presenting a population default as your own data, pool an index instead of averaging rates, and badge the numbers a user actually reads first — the deep audit's final five findings (§17–§21).

**§19 — a profile nobody filled in shipped as personal identity data.** A user who entered **nothing** was
shown BMI **28.8 "Overweight"**, BSA 2.07, RMR 1796, HRmax 179 and VO₂max 40 (**"Good · 50th percentile"**)
as findings *about them* — and the ECGDex export shipped `{age:42, weightKg:80, heightCm:178, …}` under the
note *"null = left on auto/default"*, which those six fields could **never** be. The cascade had the answer
all along: `resolve()` has returned `origin: 'pop'` since day one, and every consumer dropped it.
`derive()` now reports `origins` (per input), `basis` (per derived value — one guessed input taints the
result) and `personalized`; the panel marks a pop-derived number **"pop default"** instead of letting it
read as a measurement. `sex` finally got the `ageSet` treatment it never had — it had been hardcoded
`origin: 'you'`, silently asserting *"male, your value"* for every user who never chose. The
ECGDex/GlucoDex/PpgDex exports now carry **only what was entered or detected**, making that shipped note
true for the first time, and move the priors compute actually ran on into a labelled `assumedDefaults`
block — so the derived numbers stay reproducible without pretending they describe this person.

**§20 — CPAPDex averaged rates that had to be pooled.** Night ODI/T90 were an unweighted mean of the
*per-session* rates, so a 40-minute nap weighed as much as a 6-hour sleep: a real 6.38 h + 0.68 h night
reported ODI **5.97** where the pooled truth is **3.68** (×1.62 overstated). `residualAHI` sitting right
next to it (`nA / totHours`) had always pooled correctly. The oximetry lane now exposes its own
denominators (`analyzedHours`, `validSamples`, `below90Samples`) so ODI pools desats over hours and T90
pools over valid samples — what each metric's denominator actually *is*. The identical bug in
`cpapdex-cross.js nightOdi`, which the audit never named, died with it. Latent until an SA2 oximeter is
attached — which is the entire reason the lane exists.

**§18 — "Coupling 0 %", in red, on a night with zero desaturations.** 0/0 is **undefined**, not zero. The
renderer's own guard (`cp.couplingScore != null`) was already written expecting `null`.

**§17 — OverDex stamped an undated export with the date of the click.** The exact Clock-Contract
fabrication `integrator-app.js` documents as deliberately dropped. It now names through the shared
`exportName()` → `OverDex_undated_summary.json`.

**§21 — the badge mandate had a hole in its own foundation.** `.ev-corner` — the mandate's *card*
placement, the one prescribed for "cards, KPIs, hero/headline numbers" — was defined in `dex-badges.css`
but **never in the engine**, and apps load the engine, not the CSS mirror. So it was unusable by
construction, and **every hero number in the fleet shipped unbadged** while the subscores directly beneath
them were correctly badged. The engine now defines it; all four heroes carry it (HRVDex, PulseDex, OxyDex,
CPAPDex). Two cards typed the ladder word **"validated"** into a status-*hue* pill — on a card whose own
CAI metric is graded `emerging` — and the ladder is never a hue and never hand-written; both counterfeits
are gone. OverDex rendered a fused **clinical** KPI grid while loading **no badge engine at all**; it now
grades those cross-node numbers the way `integrator-render.js` grades its own. And an **absent** Welltory
`HRV Score` now reads `null` rather than a real-looking `0`, which the hero rendered as a genuine
assessment: *"Strained · Prioritize rest"*.

Gated by a 31-assert group **verified to red on the original code — 22 of 31 fail** — with the audit's
exact numbers, plus controls (a single-session night is unchanged by pooling; the derived math still
computes) so it cannot pass vacuously. **Export-inert: no fixture output moved.**

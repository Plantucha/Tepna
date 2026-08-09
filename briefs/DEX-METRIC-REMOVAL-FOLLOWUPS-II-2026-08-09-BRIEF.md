<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# DEX-METRIC-REMOVAL — Follow-ups II

**Status:** PROPOSED · **Created:** 2026-08-09 · **Owner brand:** Tepna
**Parent:** `DEX-METRIC-REMOVAL-FOLLOWUPS-2026-06-23-BRIEF.md` (DONE 2026-06-29)
**Grandparent:** `DEX-METRIC-REMOVAL-AUDIT-BRIEF.md`

Spawned while executing the parent's **§4**, which the parent had DECLINED as *"pure doc polish that
touches the reference guides near the `cohesion-badges` gate; not worth the risk for a palate-cleanser."*

**That risk assessment was inverted.** §4 was not polish. Executing it surfaced two rendered
correction-history strings the suite could not see, a structural blind spot in the gate that was
supposed to catch them, and three live-looking code paths for metrics that were removed in June.

---

## 0 · What §4 actually was (executed 2026-08-09)

`ANS Age` and the `HRV/oximetry→BP` projections were removed suite-wide on 2026-06-21/23. Six weeks
later the reference guides still carried **18 `ANS Age` mentions** and, separately, two `BP Projection`
passages. They fell into four kinds, and only the first three were defects:

| kind | count | disposition |
|---|---|---|
| stale prose caveats warning readers about a metric that cannot be computed | 10 | rewritten |
| dead quick-nav chips (`ANS Age`, `BP Est/Risk` → `#projections`, which holds only VO₂max) | 3 | deleted |
| **rendered correction history** — date-stamped removal notes in reader-facing tables | 3 | deleted / moved into comments |
| **maintainer-facing tombstone comments** (`<!-- ANS Age card REMOVED … -->`) | 5 | **KEPT — they are the record that stops the metric coming back** |

The parent's instinct that the guides sit near a gate was right; the conclusion was backwards. The
gate's proximity was the *reason* to look, not to stay away — it turned out not to cover this surface
at all.

## 1 · The gate blind spot, closed 2026-08-09

`tests/dex-tests.js`'s citation group reports **"no correction history in a reader-facing registry
string"** — and it reads only `cite`/`label`/`unit` across the eight registries. Meanwhile
`HRVDex Reference.html` rendered, inside the Validation Status Matrix:

> Population projection; not a measurement. **ANS-age + HRV→BP removed 2026-06-23.**

That string matches the citation group's own `META` regex (`REMOVED 20\d\d`) exactly. The group was
structurally incapable of seeing it, and reported clean.

A sibling group — *"Reference guides: no correction history in RENDERED text"* — now applies the same
regex to the guides' rendered prose, comments and `<script>`/`<style>` stripped first. **It was shown
to RED on the pre-fix tree** (3 hits across HRVDex + OxyDex) before it was shown to pass, and it
carries a leg asserting the tombstone comments **survive**, so "make the gate green" cannot be
satisfied by deleting the removal record.

⚠️ **The general form is worth stating, because this is the third instance this quarter:** a check
whose name describes a *property* ("no correction history") while its implementation covers one
*surface*. The name is what a later reader trusts. When adding a gate, either scope the name to the
surface (`…in a registry string` — which this one did, and is why it was recoverable) or cover every
surface the property claims.

## 2 · Residue — dead code for removed metrics, still in the bundles

All three are **dead**, verified, not merely suspected. None is user-visible. Each costs a re-bundle,
so none was done here — per the house economics rule, they should ride the next behavioural change to
their node rather than cause one.

### 2.1 · PpgDex still computes an autonomic age

`ppgdex-profile.js:170` defines `ansAge(rmssd, sdnn, hr)`; line 232 assigns `ansAge: aa` onto the
record; line 428 sets a label reading **"↑ chronological age · HRV-estimated autonomic age ≈ N yr"**.

**Why it is dead — both guards verified, not assumed:**
1. `computeHints()` opens with `if (DP()) return;` — *"unified panel owns the field hints now (legacy
   DOM inputs removed)"*.
2. `set()` is `const l = $(id); if (!l) return;`, and **`PpgDex.src.html` contains no `lbl_ppgAge` id**
   — nor any `lbl_ppg*` id at all.

So the string cannot reach a screen. But the function is live source, it is inlined into `PpgDex.html`
and the served `docs/PpgDex.html`, and a future edit that restores a hint node would silently
resurrect a metric the audit judged indefensible. Delete `ansAge()`, the `ansAge: aa` assignment and
line 428 on the next PpgDex re-bundle.

> **Do not treat "the export writes `ansAge: null`" as the fix.** `ppgdex-app.js:1034` does write null
> for node-export back-compat, and that is correct and should stay. It says nothing about the profile
> surface, which computes its own value from `r.dispRm`/`dispSd`/`dispHr` and never consults the export.

### 2.2 · OxyDex renders a BP projection that is hard-null

`oxydex-fusion.js:885` renders a `BP projection` row guarded by `if (n.karv || n.vo2est || n.bpProj)`,
formatting `n.bpProj.sbpEst`/`dbpEst`. `oxydex-dsp.js:2564` is `var bpProj = null;` — hard-null since
2026-06-21 — so the guard never fires on `bpProj` alone. Dead branch; remove it with the next OxyDex
re-bundle. (`bpProj: null` in the **export** stays, same back-compat reason as above.)

### 2.3 · A PulseDex comment claims a deleted function is still used

`pulsedex-overview.js:235` reads *"pxAnsAge() is still used for the KPI delta"* — while line 70 of the
same file says the tile *"and its pxAnsAge() composite are deleted"*. `pxAnsAge` has **no call site
anywhere in the tree**; line 70 is correct and line 235 is stale. Two comments in one file asserting
opposite things about the same deleted function is a trap for the next reader. Comment-only, but it is
inlined into a bundle, so it rides the next PulseDex re-bundle.

## 3 · Done when

- [x] §4 of the parent executed: guides carry no rendered `ANS Age` / `BP Projection` mention.
- [x] The rendered-text correction-history gate exists, was shown to RED before it was shown to PASS,
      and protects the tombstones.
- [ ] §2.1 `ppgdex-profile.js` `ansAge()` deleted on the next PpgDex re-bundle.
- [ ] §2.2 `oxydex-fusion.js` dead `bpProj` render branch deleted on the next OxyDex re-bundle.
- [ ] §2.3 `pulsedex-overview.js:235` stale comment corrected on the next PulseDex re-bundle.

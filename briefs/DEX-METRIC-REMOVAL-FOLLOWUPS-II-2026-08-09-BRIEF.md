<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# DEX-METRIC-REMOVAL — Follow-ups II

**Status:** DONE — 2026-08-19 · **Created:** 2026-08-09 · **Owner brand:** Tepna
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
- [x] **DONE 2026-08-19** — `ansAge()` deleted. ⚠️ **This brief listed THREE sites and there were FOUR:**
      `const aa = ansAge(...)` (which feeds the `ansAge: aa` assignment) was missed. Removed by
      identifier and asserted to zero occurrences afterwards, rather than by the line numbers above —
      which had already drifted.
- [x] **DONE 2026-08-19** — the unreachable `BP projection` row is gone and the guard is now
      `if (n.karv || n.vo2est)`. The export's `bpProj: null` stays, per this brief.
- [x] **DONE 2026-08-19** — corrected, and it now says WHY it was wrong rather than silently agreeing
      with line 70, so the next reader sees the contradiction was resolved rather than tidied away.

---

## 4 · Executed 2026-08-19 — all three in ONE re-bundle, and §2.1 generalised

§2's economics rule was followed to the letter: the three residues rode a single build/provenance/
verify cycle across PpgDex · OxyDex · PulseDex rather than causing three.

⚠️ **§2.1's justification proved to be far bigger than §2.1.** Its argument for deadness was that
`lbl_ppgAge` appears in no `.src.html`. Run without the metric-specific filter, the same grep says
`PpgDex.src.html` has **no `lbl_` id at all** — and neither do ECGDex's or GlucoDex's. So every sibling
call in `computeHints()` is equally unreachable: **PpgDex 10 · ECGDex 11 · GlucoDex 5 = 26 writes to
ids that exist nowhere.** All three functions are dead on two independent grounds (the `if (DP()) return`
early exit AND the missing ids).

Spawned as `briefs/DEAD-FIELD-HINTS-FLEET-2026-08-19-BRIEF.md` rather than folded in here: three
functions across three nodes is a second work-unit, and fusing it with this one is the failure
`CLAUDE.md` §👥.2 records permanently in `cabd7f7`.

⚠️ **A second finding, about this repo's own docs rather than its code:** `CLAUDE.md` §🔒 names
`computeHash` as the computed proof of export-inertness, and the value **is not recorded in
`provenance/*.json`** — those fragments carry `manifestHash` and `verifiedUnder` only. So it could not
be used as the proof here: reporting these edits export-inert because it "did not move" would have been
a claim about a field absent from the ledger, indistinguishable from a stable one in a diff. Settled
empirically instead — `verify-fixtures` re-stamped 4 fixtures, 10 already current, suite green.

> 🔴 **CORRECTION 2026-08-19 — the original wording of this paragraph was WRONG, and the cause is worth
> more than the fix.** It read *"it exists nowhere in `manifest-gate.js` or `provenance/`"*. The
> `provenance/` half is right; the `manifest-gate.js` half is false — that file defines
> **`computeHashFromText`** and mentions `computeHash` **11 times**, including the whole §🔒 rationale.
>
> **`grep` cannot see `manifest-gate.js`.** It returns a clean no-match (exit 1) for a file with 11
> matches. Offset 10629 is `assets[i].name + '\x00' + sha256hex(...)` — the `logicalName \0
> sha256(assetText)` separator §🔏 mandates for the `manifestHash` projection. That single deliberate
> NUL makes `file -b` report `data`, and this shell's `grep` wraps `ugrep -I` (skip binary), so it is
> skipped silently. The file is valid UTF-8 and the NUL is load-bearing — **do not "fix" it**, it would
> move every `manifestHash` in the repo.
>
> **Use `git grep` in this repo.** A `grep` zero-result about a tracked file is not evidence of absence;
> the discriminator is `file -b <path>` — if it says `data`, the wrapper skipped it. (A hard-link theory
> was tried first and refuted: 139 root files have >1 link and grep reads them all.)
>
> The highest-stakes file in the tree — the one defining BOTH provenance gates — is the one the default
> search tool is blind to, and it fails in the direction that reads as *"this identifier does not exist."*

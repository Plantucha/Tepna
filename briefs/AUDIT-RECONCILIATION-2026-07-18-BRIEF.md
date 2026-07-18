<!--
  AUDIT-RECONCILIATION-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-18 · **Created:** 2026-07-18 · **Reconciles:** [`DEEP-AUDIT-II-2026-07-18-BRIEF.md`](DEEP-AUDIT-II-2026-07-18-BRIEF.md) · [`ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md`](ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md)

# Cross-check of two independent audits run the same day

On 2026-07-18 two audits ran against this repo without knowledge of each other:

| | `DEEP-AUDIT-II` | `ENGINE-VERIFICATION-FINDINGS` |
|---|---|---|
| Scope | the JS compute paths — DSP, node-side fusion, cross-night, provenance gates | the **Vigil↔suite seam** — `capture-host/` → ingest → orchestrators → PpgDex/PAT |
| Shape | 16 invariant hunters + completeness wave; 3 adversarial refuters per finding | 29-agent verification pass over 14 candidate findings |
| Result | 64 defects after dedup | 8 findings, **6 of 14 candidates refuted by execution** |

Adjacent targets, not the same one — so the overlap is small by construction. This brief records what the
comparison found and what was done about it. **It is DONE on filing: the three reconciliations below are
already applied.**

## The headline: zero contradictions

Every one of the 64 `DEEP-AUDIT-II` findings was checked against all ten rows of
`ENGINE-VERIFICATION §5` (its REFUTED list). **No collisions.** Where the two passes touched the same code
they agreed. That is the strongest available evidence that both sets are real — two independently-constructed
methods, no shared prompt, no shared agent pool, no disagreement.

---

## Reconciliation 1 — the gyro row credits a defect as a feature *(applied to `ENGINE-VERIFICATION §5`)*

`ENGINE-VERIFICATION §5` refutes *"GYRO and MAG contribute to no computed metric"* with an executed A/B:
acc-only 120 s vs acc+gyro 300 s moves `position.dwellFrac.prone` 1 → 0.4 and `activity.epochs` 4 → 10.

The evidence reproduces. The interpretation does not follow. Verified at `motiondex-dsp.js:427-430`:

```js
var durSec = Math.max(durationOf(acc, t0Ms), durationOf(chest, t0Ms), durationOf(gyro, t0Ms));
var position = bodyPosition(posSrc, t0Ms, durSec, posUnit);   // posSrc = chest || acc — NEVER gyro
```

`bodyPosition` never receives the gyro stream, so gyro supplies **no positional information**. The only thing
it changed is the shared `durSec` denominator, which sets `nE = ceil(durSec / epoch)`; the extra 180 s became
**sample-less epochs** counted as `dwell.unknown` (`:203`) over `nE` (`:213`). That is not a contribution —
it is `DEEP-AUDIT-II` §7.3 and §7.4 being demonstrated.

**Applied:** a mechanism note added to `ENGINE-VERIFICATION §5` beneath the table, and the row flagged so it
cannot be cited as evidence that `durSec` is well-formed. The row's narrow conclusion (gyro ≠ metric-dead,
mag = metric-dead) still stands, as does its refutation of `MOTIONDEX-BUILD-FOLLOWUPS §3` for gyro. **Note
the corollary:** fixing §7.3/§7.4 makes gyro output-dead again, at which point `MOTIONDEX-BUILD-FOLLOWUPS §3`
becomes true for *both* channels.

This is now a **method rule** in `AUDIT-PROMPT.md`: *verify the mechanism, not the correlation.*

## Reconciliation 2 — companion pairing is ONE bug, found from both ends *(applied to `DEEP-AUDIT-II` §10, punch-list #18)*

Neither pass saw the other's half:

| | Finding | Location |
|---|---|---|
| `ENGINE-VERIFICATION §1.1` | `fnameStampMs` is **unanchored** — matches the 8-digit H10 device serial before the date (`Polar_H10_02849638_20260617_…` → year 0292), collapsing nights three days apart to an identical stamp | `signal-orchestrate.js:397` |
| `DEEP-AUDIT-II §10.2/10.3` | the **selector** has no max-distance guard, and an unparseable stamp scores epoch 0 | `dex-ingest.js` |

A broken parser upstream, a guardless selector downstream, **one user-visible failure**: a sidecar from the
wrong night attaches and renders a green "98.3 % Agreement". Fixing either alone leaves it reachable — and
the parser bug is device-shape-dependent (the Verity id contains letters and parses fine), so a
single-device test proves nothing.

**Applied:** filed as `DEEP-AUDIT-II §10.5`; punch-list #18 rewritten to land all three parts together, with
`ENGINE-VERIFICATION`'s settling experiment first — run `pairCompanions` over the full `Ecg nightly/` H10 set
in one call and assert every companion's date matches its primary's. **Note the anchored fix already exists
one file over** at `dex-ingest.js:42-47`.

## Reconciliation 3 — `ledAgreementPct`, a real miss *(applied to `DEEP-AUDIT-II` §10b, punch-list #31b)*

`ENGINE-VERIFICATION §1.3` found that `capture-host/capture.py:651` writes the O2Ring's single-photodiode
pleth as `write_ppg(ph, ns, 0.0, (v, v, v), 0)` — one 8-bit sample replicated across three PSL channels — so
`consensusBeats` sees `nCh = 3`, never takes its honest `nCh < 2` return, and reports **`ledAgreementPct:
100`** at **`measured`** tier on five surfaces, for hardware with one photodiode.

`DEEP-AUDIT-II` ran a dedicated evidence-badges hunter (bug class 7) and **missed it entirely**. The reason
is structural and worth recording:

> The number **is** badged, and its tier **does** match the registry. What is false is the *registry's own
> claim*, because an **upstream producer fabricated the independence the statistic measures**. Any check of
> badge-vs-registry consistency reports green forever. Finding it requires reading the code that wrote the
> file — which a suite-scoped audit never opens.

**Applied:** imported as `DEEP-AUDIT-II §10b.1` with a note on why the sweep was blind, and punch-list #31b
added (marked *owned by* `ENGINE-VERIFICATION §1.3` — do not execute twice). Promoted to **bug class 11**
in `AUDIT-PROMPT.md`.

---

## Convergences worth keeping

- **MotionDex `toG` / `UNIT_RE`** — both passes independently landed on the same two functions with two
  distinct ~1000× defects: case-sensitivity in `toG` (`DEEP-AUDIT-II §7.9`) and Gauss-magnetometer
  misclassification in the acc branch (`ENGINE-VERIFICATION §1.8`). **Their attribution corrects ours:** PSL
  genuinely writes Gauss and a real corpus file carries `X [G];Y [G];Z [G]`, so the fix belongs in MotionDex,
  not the capture host — convert Gauss → µT at the parse boundary per `CLAUDE.md` §📏. Applied to §7.9.
- **`ENGINE-VERIFICATION`'s refutation of "PpgDex assumes 176 Hz" supplies the precedent for
  `DEEP-AUDIT-II` #5.** PpgDex derives `fs` from the **median** sensor-ns delta and lands on 55 Hz exactly;
  ECGDex infers it from a **single** ms delta and parses 130 Hz as 143/167. The ECGDex fix is a **port**, not
  a design. Promoted to **bug class 14** (sibling divergence) in `AUDIT-PROMPT.md`.

## What each pass missed that the other caught

- **`DEEP-AUDIT-II` missed:** §1.3 `ledAgreementPct` (in a class it hunted — see Reconciliation 3), plus
  §1.2/§1.4/§1.5/§1.6/§1.7, all outside its scope.
- **`ENGINE-VERIFICATION` missed:** the whole HRVDex absent-column family, the Lomb–Scargle Parseval
  calibration, ECGDex QT/QTc, the cross-night estimators, and the provenance gates — all outside its scope.
- **Both missed the same three things**, and this is the important one: the **browser lane**,
  **`capture-host/` as compute** (Python, un-mutation-audited beyond PR #163's 44 %), and the **Integrator's
  fusion arithmetic** — the noisy-OR posterior, `effConf`, the Poisson null models, the event-coupling
  surrogate machinery. **Two consecutive passes examined the Integrator's ingest and presentation and stopped
  there.** That is now the largest unaudited surface in the fleet with the highest consequence, and
  `AUDIT-PROMPT.md` now requires an explicit scope declaration naming these three.

## Charter changes made (`AUDIT-PROMPT.md`, last-verified → 2026-07-18)

| Change | Sourced from |
|---|---|
| **Class 11 — fabricated redundancy** (consensus over non-independent inputs; why the badge sweep is blind) | Reconciliation 3 |
| **Class 12 — filename-derived semantics** (unanchored regexes; execute against *real* corpus names) | `ENGINE-VERIFICATION §1.1` |
| **Class 13 — the missing instance** (roster × surface matrix; you cannot grep for an absent thing) | `ENGINE-VERIFICATION §1.7`, plus `DEEP-AUDIT-II`'s zero-coverage surfaces |
| **Class 14 — sibling divergence** (the in-repo precedent is your fix *and* your proof) | the PpgDex/ECGDex `fs` pair, and three more |
| MISSION: **start one hop earlier** — read the producer, not just the file | Reconciliation 3 |
| MISSION: **a comment is not a measurement; a DONE stamp is not a measurement** | `ENGINE-VERIFICATION §0` (6 of 14 candidates died on execution) |
| MISSION: **verify the mechanism, not the correlation** | Reconciliation 1 |
| Verify: build the **coverage matrix**; grep the **siblings** | classes 13, 14 |
| Verify: **declare your scope**, naming browser lane / `capture-host/` / Integrator fusion arithmetic | both passes' shared blind spot |
| Reporting: **report what you REFUTED** (mandatory), with two cautions | `ENGINE-VERIFICATION §5` |
| Reporting: **cross-check against concurrent audits** before filing | this brief |

## Done when

All items are complete on filing:

- [x] Reconciliation 1 applied — mechanism note in `ENGINE-VERIFICATION §5`, row flagged.
- [x] Reconciliation 2 applied — `DEEP-AUDIT-II §10.5` filed, punch-list #18 rewritten to land three parts together.
- [x] Reconciliation 3 applied — `DEEP-AUDIT-II §10b.1` imported, punch-list #31b added, ownership marked.
- [x] `§7.9` corrected with `ENGINE-VERIFICATION §1.8`'s attribution (fix MotionDex, not capture-host).
- [x] `AUDIT-PROMPT.md` expanded — 4 new bug classes, 3 MISSION rules, scope declaration, refuted-claims discipline, concurrent-audit cross-check.

**No follow-up brief is spawned** (per `CLAUDE.md` §📌 — nothing surfaced beyond what the two parent briefs
already carry). The residue is their punch-lists, not this reconciliation. **The one thing this cross-check
newly recommends** is that the Integrator's fusion arithmetic get a dedicated pass, since two audits have now
skipped it.

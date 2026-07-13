<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-13 · **Follows:** `CPAP-REAL-CORPUS-FOLLOWUPS-2026-07-12-BRIEF.md` (whose §5/§6 this carries) · **Related:** `EVENT-COUPLING-2026-07-13-BRIEF.md`

# CPAP corpus — follow-ups II: what the last two briefs left open, and one false DONE

> **Why this exists — a bookkeeping correction first.** `CPAP-REAL-CORPUS-FOLLOWUPS` was stamped
> **`Status: DONE`** while its **§5 (P7/P8)** and **§6 (smaller things)** had never been executed. CLAUDE.md
> §📌 is explicit: DONE means *every* acceptance item is met, and *"never stamp DONE on unverified work"*.
> That stamp was wrong.
>
> The irony is worth recording, because it is the same defect the parent briefs spent their whole length
> closing: **a claim was made and nothing verified it.** The `docs-ledger` gate checks a status header's
> *format*, not its *truth* — exactly as `GATE B` checked a fixture's bytes but not whether anything
> reproduced them. Prose is not a gate; a status header is not either.
>
> This brief carries the unexecuted work out, so the parent's DONE becomes true rather than aspirational.
> (House pattern: `AUDIT-FOLLOWUPS` → `-II`.)

---

## 1 · P7 — a NODE consumer for `event-coupling.js` ⚠️ **the load-bearing one**

`event-coupling.js` is shipped, gated (35 self-test + 26 contract assertions) and **dormant**: no node
consumes it, so it is not co-loaded into any bundle. It exists to answer the Integrator's *"is it real or
coincidence?"* question — and until something calls it, that question is still being answered by raw
co-occurrence somewhere.

**Do:** apnea → HR (CVHR) and apnea → motion-arousal coupling on **A3** (the 17 quad-modal nights), via
the primitive. It independently tests §M3's re-labelling alternative, and it settles which bundle the
module rides into.

**⚠️ Read `EVENT-COUPLING-2026-07-13-BRIEF.md` §2 first.** Four separate defects in that null model each
produced a *confident, wrong number* on this very corpus. In particular **pass `coverage`** — the spans in
which the ECG/PPG was actually recording — or you will repeat the ×0.72 anti-coupling artifact with a
different sensor.

**Done when:** a node calls `EventCoupling.coupling()`; `coverage` is supplied from that node's real
recording window; the result is read only where `underpowered` and `saturated` are both false.

---

## 2 · P8 — `CPAPCross` change detection has never detected a change

`CPAPCross`'s trend/change detection only ever runs on synthetic nights with `sd: 0` and a `'stable'`
label. **It has never been shown to detect a change at all.** A trend detector that has never detected a
trend is a gate in name only.

**A4** — the two dated device-setting step-changes, each landing on one identifiable night and holding
thereafter — is a **labelled change-point dataset** sitting unused. The §1 `mode` work incidentally found
a candidate change-point around night #169 with a ~0.78 cmH₂O envelope shift, so the signal is there.

**Do:** drive A4's nights through `CPAPCross` and assert it flags the two known change-points. It doubles
as the check that the 5-min envelope window does not smooth a real step away.

---

## 3 · Nothing gates a demo against gitignored inputs

CPAPDex's demo fetched **ten gitignored real recordings**, so it had **never worked on any fresh clone** —
a dead page for everyone but the maintainer, for months (`FOLLOWUPS` §3). It was fixed by pointing it at
the committed synthetic EDF set, but **nothing stops the same trap in any other node.**

**Do:** a headless gate — parse each app's demo file list and assert **every entry is a git-tracked path**.
A few lines; closes the class permanently.

**Rule to encode:** *a demo must not depend on anything gitignored.*

---

## 4 · The generated list files cost a rebase on every PR

`tests/changes-list.txt` and `tests/docs-ledger-list.txt` are **committed snapshots of the filesystem**.
Every PR regenerates them, so they conflict **by construction** — PR #60 took four rebases, and every
conflict was these two files.

They exist for exactly one reason: **the browser lane cannot list a directory.** But the gates that consume
them (`docs-ledger`, `release-ledger`) are filesystem/docs checks with **zero browser-specific value** —
the browser lane's unique worth is render coverage and same-origin behaviour.

**Do (recommended):** make those two gates **Node-only** and **delete the committed lists**. That removes,
in one move: the merge conflicts, the whole staleness failure-class, and two "remember to regenerate" steps
from every PR.

**Second-best** (if browser parity is non-negotiable): a `.gitattributes` merge driver that regenerates on
conflict. But that is papering over committing derived data.

---

## 5 · Smaller things

- **`tools/regen-cpap-goldens.mjs` is CPAP-only.** It exists because `build.mjs` re-stamps a fixture's
  `manifestHash` but does **not** recompute its `outputHash`. That integrity hole is now *gated* (every
  code-gated fixture must have a dynamic leg — `FIXTURE-REPRODUCIBILITY`), so this is **ergonomics, not
  integrity**: generalize to `tools/regen-goldens.mjs --node <Name>`.
- **`how-to-collect/cpap-edf.md` predates the ResMed adapter** and doesn't mention `resmed-edf`. 7 of 8
  other adapters have a matching `how-to-collect/<adapter-id>.md`; nothing gates it.
- **`pressureRange` carries `goodDirection:'down'`,** which is meaningless for a machine that is *supposed*
  to vary its pressure. The registry vocabulary has only `up`/`down`; a `neutral` direction would be honest
  for descriptive metrics, but adding a third value is a fleet-wide vocabulary change and was deliberately
  **not** taken.
- **The `mode` thresholds remain unvalidated — and that is the correct end state.** The corpus contains
  **no fixed-CPAP nights**, so a CPAP-vs-APAP boundary cannot be fitted to it: any cut is unfalsifiable.
  The dead-band makes the failure mode `null` ("unknown"), never a wrong device setting. **Do not "fix"
  this** without a fixed-CPAP corpus to fit the valley to.

---

## 6 · Done when

- [ ] **P7** — a node consumes `event-coupling.js`, passing real `coverage`.
- [ ] **P8** — `CPAPCross` demonstrably detects A4's two known change-points.
- [ ] **§3** — a gate asserts every demo input is git-tracked.
- [ ] **§4** — the generated list files are gone (or their conflict cost is otherwise removed).
- [ ] `Dex-Test-Suite.html?full` all-green · `verify-provenance.html` GATE A/B clean · `build.mjs --check` clean.
- [ ] Follow-up spawned per §📌 with whatever P7/P8 turn up.

<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-11

# Literature-use policy — how Tepna incorporates published data, formulas & processes

> **What this is.** A decision/reference brief that makes explicit **how the suite may use published academic
> literature** (formulas, processes, and reported reference statistics) — and, just as importantly, where the
> hard line is. It consolidates rules already implied by `CLAUDE.md` (the 100 %-local invariant, the evidence
> ladder) into one greppable policy, and indexes the anchors gathered in the 2026-07-11 sweep. Ships no code;
> it governs `docs/` + `papers/` practice and the evidence-tiering of any literature-backed number.

---

## 0 · Why this exists
Two recent questions ("can we use data/processes/formulas from papers?" and the reference-anchoring of the
Integrator TCH σ̂) exposed that the suite had **no written policy** on literature use — only the implicit
`CLAUDE.md` rules. Reference-free σ validation, the N-cornered-hat method, the RMSSD-divergence premise, and
the sensor-accuracy anchors are all literature-touching. This brief writes the policy down so contributors
(human or AI) apply it consistently and never drift toward the one thing that would break the architecture:
networked data in a shipped bundle.

## 1 · The three tiers of "using a paper" (all ALLOWED, with rules)
1. **Formulas & processes** — math/algorithms lifted from a paper (e.g. Gray–Allan TCH, Allan variance,
   Malik RR correction, Pan–Tompkins, Hayano's ACAT CVHR). **Allowed and encouraged.** Reimplement from the
   *spec*, never copy licensed source verbatim; carry the SPDX header; cite the source in a code comment.
   License-compatibility check if any third-party code is vendored (Apache-2.0 target; record BSD-3/MIT deps
   in `THIRD-PARTY.md` only if code actually enters a shipped artifact — a cited formula does not).
2. **Reference statistics / priors** — published summary numbers (e.g. Polar Verity Sense arm-PPG MAE
   1.43 bpm; wrist-PPG sleep meta-analysis −0.40 bpm). **Allowed as validation anchors + `validated`-tier
   context in `docs/`/`papers/`.** Cite fully (author, year, journal, DOI). A literature-backed number MAY
   *seed* a computation (a prior, a floor) **only** if it is baked into source at author time — never fetched.
3. **Raw datasets** — third-party data files. **Rarely used**; prefer *reported statistics* over raw data.
   If a public dataset is ever vendored for a paper/validation, it lives under `papers/`/`docs/` with its
   licence + provenance, **never** in a bundle and **never** fetched at runtime.

## 2 · The hard line (non-negotiable, inherits `CLAUDE.md`)
- **No networked data in a bundle, ever.** The 100 %-local / no-CDN / no-`@font-face` invariant (gate-backed
  by `no-network.html` + the `no-network` CI workflow) is absolute. Literature use is a **docs/papers-time**
  activity; a `Foo.html` never fetches a paper, a DOI, a dataset, or a CDN. A literature value that must reach
  runtime is **inlined into source at author time** as a constant, with a citing comment — it is then just
  code, subject to the normal gates.
- **No fabricated authority.** A number sourced from a paper is `validated`-tier **only** with a real, checkable
  citation; never upgrade a badge on the strength of "the literature says." No citation → it stays the suite's
  own tier (`measured`/`emerging`/…). Retired-vocabulary rules (§🎫) still apply.
- **Attribution is mandatory.** Every literature-derived figure/formula carries author-year-journal-DOI in the
  doc, and a source comment in code. This mirrors the MCP servers' own attribution requirements (PubMed DOIs,
  Consensus reference links) and the suite's SPDX discipline.

## 3 · Where literature lives (the routing rule)
- **TCH / node-specific validation** → the relevant node's validation write-up (e.g. the sensor anchors +
  method literature already in `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md` §8–§9).
- **Forward paper agenda / cross-node** → `PAPERS-ROADMAP` + `papers/` (e.g. the ECGDex CVHR/apnea prior art:
  Hayano 2010 ACAT, Hsu 2020 ECG+ACC patch).
- **A method/formula that changes code** → its own executable brief (e.g. the ML-TCH / Groslambert-covariance
  estimator upgrade, `INTEGRATOR-TCH-ML-ESTIMATOR-2026-07-11-BRIEF.md`), so the literature → code step is
  gated (tests + provenance + golden regen) like any behavioral change.

## 4 · Anchor index (from the 2026-07-11 sweep — the seed, extend as used)
- **Sensor HR accuracy (validated tier):** Schweizer & Gilgen-Ammann 2025 (JMIR Cardio, `10.2196/67110`) —
  Verity Sense arm MAE 1.43 bpm vs H10; Budig 2021 (`10.3390/s22010180`) — trackers vs H10 criterion; Rehman
  2024 & Zhang 2020 — wrist-PPG sleep MAE; Tisyakorn 2024 (`10.1007/s11325-024-03232-9`) — Wellue O2Ring OSA.
- **Reference-free method:** Schatzman 2020/2021 (N-cornered + ML-TCH); Calosso/Vernotte/Rubiola 2018 (GCOV);
  Sjoberg 2021 (3CH on atmospheric datasets — cross-domain precedent).
- **PRV≠HRV / motion premise:** Kass 2025 (N=931); Dewig 2024 (PAT mechanism); Prucnal 2025 (ACC-filtered PRV);
  Coste 2025 (Polar OH1 vs H10); Bent 2020 (activity error).
- **ECGDex CVHR/apnea:** Hayano 2010 (`10.1161/CIRCEP.110.958009`); Hsu 2020 (`10.5664/jcsm.8462`).

## 5 · Done when
This is a policy/reference brief. It flips to `REFERENCE (living …)` once the owner **ratifies** the §1–§3
policy (or amends it); until then it stays `PROPOSED`. It never becomes DONE (no execution to complete) —
the §4 index is living and extended whenever a new literature anchor is used. If the policy motivates a
`CLAUDE.md` addition (a one-paragraph "Literature use" section), that edit is the only executable residue.

> **Executable residue LANDED 2026-07-13.** The one-paragraph **`## 📚 Literature use`** section is now in
> `CLAUDE.md` (after §📜 Licensing) — it single-sources the §2 hard line (no networked data in a bundle · no
> fabricated `validated` authority · mandatory attribution) and the §3 routing rule, and points here for the
> full policy + anchor index. **Status stays PROPOSED** per the rule above — the flip to `REFERENCE` remains
> the owner's ratification, not an execution step.

## Cross-references
- `CLAUDE.md` §📌 (brief lifecycle) · §🎫 (evidence ladder / tiers) · the 100 %-local + `no-network` invariant.
- `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md` §8–§9 — the first worked example of this policy.
- `INTEGRATOR-TCH-ML-ESTIMATOR-2026-07-11-BRIEF.md` — the literature→code follow-up this policy routes to §3.
- `PAPERS-ROADMAP-2026-06-24-BRIEF.md` — home for the forward paper agenda + cross-node literature.
- `THIRD-PARTY.md` — where any vendored third-party code (not cited formulas) is recorded.

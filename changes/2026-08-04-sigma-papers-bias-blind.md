<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: R5-HR-TRIPLET-REFERENCE-2026-07-12-BRIEF.md
---

State the estimator's bias-blindness in both σ papers — R5's two do-now write-ups, which were still
genuinely undone (zero matches for `bias-blind` / `variance-only` / `no bias term` / `never been
validated` in either paper before this change).

`papers/sigma-no-reference.html` gains Limitations **(ix)**: every reported σ is variance-only and the
three-cornered hat has never been validated against an external truth. It carries the measured O2Ring
under-read of **−0.269 bpm** (n = 3,136 five-minute epochs over 40 nights, SD 1.37, SEM 0.024, 11.0 σ
from zero, reproducible via `tools/oxy-hr-bias.mjs`), why it is neither an OxyDex artifact nor pure
quantization, its invisibility at the per-night level, and the zero-power consequence of the §1
identity. It closes by naming the σ values precision estimates, not accuracy statements.

`papers/sensor-trio-nights.html` §2.2 gains the identity derivation itself — σ²_E = cov(e_P, e_O),
verified to 7e-14 on the committed corpus — placed immediately after the TCH kernel as the paper's
justification for having a Monte-Carlo arm: a hat cannot be validated by one of its own corners, so
validation needs either a genuinely external Nth device or planted ground truth.

`papers/` is a served tree, so both edits required `tools/build-docs.mjs` and the `docs/papers/`
copies; `verify:docs` caught the staleness and its printed `git add` line was, as documented, wrong in
both directions.

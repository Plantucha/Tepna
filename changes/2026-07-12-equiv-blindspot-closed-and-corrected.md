<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: []
brief: DEEP-AUDIT-FOLLOWUPS-2026-07-12-BRIEF.md
---
Close the deep audit's blind spot in the ledger too — and record that the brief's own prescription for closing it was wrong.

**The fix shipped; the brief still asked for the wrong thing.** §A of the deep-audit follow-up was
executed (four committed synthetic adversarial inputs — MDY order, dropped rows, a full-length night —
running in the equiv gate as invariants, each with a control proving it bites). But the brief still read
`Status: PROPOSED` and still prescribed adding a **real** night from the 39-night O2Ring corpus.

**That prescription would not have worked, and the reason is the whole lesson.** Real recordings live in
`uploads/`, which `.gitignore` excludes as personal data — which is *precisely why* the `compute() ≡
committed export` equivalence legs (the GATE-C surface) **skip in CI and in every fresh clone**.
`release.mjs --dry-run` says so in as many words: *"This run is NOT the full gate."* A real adversarial
night would have been gitignored too: green on the maintainer's machine, CI as blind as before. The
blind spot would have been **moved, not closed**. The fixture had to be **synthetic so that it could be
committed**.

Verified rather than asserted: the four inputs are present in a *fresh clone* (exactly what CI gets), all
16 asserts pass there, and **re-introducing the §9 head-slice reds the gate in that clone** (FFT cycle
length 50 s → 20 s). That property — biting where merges are decided — is the one the original
prescription could never have had.

**Also documents `DEX_UPLOADS`, which appeared nowhere.** The only way to run the six real-recording
equivalence legs is `DEX_UPLOADS=/path/to/uploads node tests/run-tests.mjs`, and nothing said so.
`CONTRIBUTING.md` now warns that **a green CI is not the full gate** — those legs report
`⊘ committed input absent` and silently do not run, and a skip reads exactly like a pass in the summary
count. Run it before cutting a release.

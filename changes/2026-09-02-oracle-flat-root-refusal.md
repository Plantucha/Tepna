<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [pat-tools]
brief: PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md
---
`pat-window-oracle.mjs` built its night list as `readdirSync(DIR).filter(n => /^2026-/.test(n))`, so
a root whose recordings sit FLAT — `Polar_H10_<serial>_YYYYMMDD_HHMMSS_ECG.txt` — produced an empty
night list, an empty `TALLY: {}` and **exit 0**. The tool reported success about a tree it never
examined. Measured 2026-09-02 on `uploads/Ecg nightly`: **104 recording files present**, nothing
scored, exit 0.

**A warning in prose had already failed to stop this.** The WINDOW-ORACLE brief's own status header
documents the identical shape one directory level up (`--dir uploads/trio` → `TALLY: {}` = wrong
root). The shape recurred anyway, which is the argument for a refusal in the tool rather than
another note.

Now `rootLayoutVerdict(nightDirs, looseRecordings)` — a pure function, so it is testable without a
filesystem — and `main()` exits **3** with a reason naming what it looked for, where, how many loose
files it found, and three of them by name. The MIXED case (loose recordings BESIDE night dirs)
refuses too, and is the more dangerous half: scoring the dirs and dropping the files yields a
PLAUSIBLE tally over part of the tree, where the flat case yields an obviously empty one.

**Not decided here, deliberately:** whether a flat root should be ACCEPTED as a corpus. It carries
**36 distinct dates**, so "flat root = one night" would fuse 36 nights' beat trains and manufacture a
cross-night overlap that never existed — a fabricated timebase, not a lenient reader. Accepting the
layout is a separate change keyed off the `YYYYMMDD` token; refusing is a correctness fix and stands
alone.

Selftest 19 → 23. The four new assertions are **anti-vacuous by construction**: the pre-fix tool
exports no `rootLayoutVerdict` at all, verified against `origin/main`'s copy, so they cannot pass
against unfixed code. Regression checked on both good roots — `smoketest-captures` (48 night dirs)
and `vigil-archive/captures` (39) carry **zero** loose recordings at depth 1, so the guard passes and
the scoring path is untouched.

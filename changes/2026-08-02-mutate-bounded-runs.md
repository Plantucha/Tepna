<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: TOOL-INVOCABILITY-SWEEP-2026-08-02-BRIEF.md
---
Four fixes that make a roster-wide sweep finish, and finish in a time you choose. All four were found by running it at scale; none by reading it.

**1 · The per-mutant timeout was 900 s** — not a timeout so much as a promise never to notice a hang. A mutant that wedged the suite stalled a worker for fifteen minutes, and with every worker able to do that, one module could eat an hour. It is now **5× the module's own clean run** (floor 30 s), because "slower than five times clean" is not slow, it is broken — and a broken mutant is `INVALID`, not a survivor.

**2 · The tool now times one clean run first and says what the file will cost.** The dominant cost is simply what a module's tagged groups cost, and that spans three orders of magnitude:

| tag | groups | one clean run |
|---|---|---|
| `quantity` | 1 | **0.21 s** |
| `pulsedex-dsp` | 16 | 6.6 s |
| `oxydex-dsp` | 33 | 16.3 s |
| `clock` | 16 | **191 s** |

`clock` is loaded by everything, so its tag selects sixteen heavy groups. Knowing that *before* spending twelve mutants on it is the difference between a sweep you can plan and one you watch.

**3 · `--budget <sec>` skips a file whose estimate exceeds it, loudly**, with the numbers and the three ways out:

```
⊘ SKIPPED — one clean run of `clock` costs 192.5 s, so 12 mutants ≈ 144 s > --budget 90 s.
  Raise --budget, lower --limit, or give this module cheaper groups.
```

That makes total runtime a **choice**: worst case is `files × budget`, and in practice far less because most modules are cheap. A silent cap would have been the "no silent caps" violation `CLAUDE.md` warns about.

**4 · The `--jobs` default was wrong in both directions, and is now measured.** It was `min(8, cores−2)`, and a contention argument talked me into going *lower*. Measured on 24 cores, `pulsedex-dsp.js` × 12 mutants: `4→23 s · 8→17 s · 16→14 s · 24→20 s · 32→19 s` — monotonically faster to ~⅔ of the cores, then it degrades as full `node` suites fight for cores and page cache.

Now `round(cores × ⅔)`, **and serial at ≤ 2 cores**: parallelism buys nothing on one core and each worker is a full 71 MB checkout, so a 2-core laptop would spend 142 MB of disk to run no faster. Pinned in `--selftest` as a correctness property (1/2 cores → 1 job; an empty `cpus()` → 1, not a crash) so a future tuning pass cannot quietly regress it. Worker creation also degrades gracefully now: if a worktree cannot be made (disk full, old git), the run continues with fewer workers, or falls back to the serial in-place path.

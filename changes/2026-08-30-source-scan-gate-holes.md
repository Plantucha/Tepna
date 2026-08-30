<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The gate that keeps `capture.py` measurable had two holes, and both offenders it was built to catch walked through it.

`tests/_srcscan.module_source()` and the `mutation-source-scan` gate exist because a test that reads a
mutatable module's SOURCE breaks against mutmut's generated file and reports as **"failed to collect
stats"** — an environment-shaped message for a test-shaped problem, with the whole module coming back
unmeasured. That machinery landed, and `capture.py` was unmeasurable anyway. The gate was green.

**Hole 1 — the module-object form names no file.** The scan flags a line only when it carries a quoted
module filename, so `inspect.getsource(capture)` produced an empty match and passed. The dot is the real
discriminator and is now what the gate reads: `getsource(capture.foo)` bounds ONE function and is safe
under mutation; `getsource(capture)` hands over the generated module and is not.

**Hole 2 — `SANCTIONED` was checked per FILE.** One routed read anywhere in a file exempted every other
read in it. `test_capture_runners.py` imports the helper on line 17 and raw-read `capture.py` on line
4657; the largest file in the suite held a blanket exemption earned by its own import line. The check is
now per LINE — a file adopting the helper is precisely the file most likely to have missed a site.
Pure-comment lines are skipped, since a commented-out read cannot execute.

Both offenders (`test_capture_runners.py:4657`, `test_webmon_settings_contract.py:141`) now route
through `module_source("capture.py")`, which skips only that test on a generated file and keeps its
mutant-killing power on real source.

Two blockers remain that no source-scan helper can address, so `mutation_sweep.py` gains a per-test
(node-id) deselection with an honest cost note: two tests query git about the real repo (mutmut's
scratch tree is a copy), and one reads `coro.cr_frame.f_locals`, where the frame under mutation is
mutmut's dispatch trampoline. The git pair is recorded as costing nothing — an assertion about a
committed file mode cannot be broken by mutating a function — so warning about it would manufacture
the same false work as a false REACHABLE. Excluding a whole FILE stays the wrong tool: it drops the
real units beside the scan.

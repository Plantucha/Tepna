---
bump: patch
type: fixed
brief: none
---

`test_vigil_sh.py`'s `_kill` teardown attempted **no kill at all** when the pidfile was absent or
unparseable — it returned bare — and that is exactly the state the pidfile and restart tests are built
to produce. The tests most likely to strand a stub server were the ones guaranteed not to reap it.

Measured 2026-09-14 on rig-x870: two `python3 -m http.server` stubs alive at **26 h** and **54 h**, with
cwd under `pytest-of-michal/.../test_the_pidfile_names_the_dae0` and `.../test_restart_starts_a_stopped_0`
— the two tests the mechanism names. Both far outlived the fixture's own `sleep 300` parent, so the
server survived its shell rather than losing a race.

⚠️ **It costs memory, not disk.** `/tmp` here is a tmpfs, so the stranded pytest tmpdir is *resident* and
belongs to no process — invisible to `ps`, freed only by deleting the tree. The two held **238 MB**. The
harness watchdog reaps other sessions' gates when the box reads low on memory (CLAUDE.md §4c), so a
leaked stub is a cross-session cost rather than a local untidiness.

`_kill` now keeps the pid path first — precise, and it takes the whole process group — and adds a port
sweep as the backstop for every path that reaches teardown without a usable pid. **The port is the
ownership token**, which is what makes this a safe sweep rather than a pattern-kill: `_free_port` hands
each box an ephemeral port the kernel has just confirmed free, so no other session's stub can carry it.
`_procs_on_port` demands both `http.server` and that exact port as whole argv entries, so a substring of
another number cannot collide either. Verified against a real neighbour: another session runs its own
`http.server` on port 8080, and the sweep does not match it.

A second, smaller defect on the same function is what hid the first: the kill loop's comment claimed
*"the loop's end reports total failure"* and the loop reported nothing — both strategies `continue`d and
the function fell out silently, so a teardown that killed nothing was indistinguishable from one that
worked. The comments now describe what the code does.

The regression test reproduces the leaking state exactly — start the daemon, remove the pidfile, tear
down — and asserts on the **port**, because the pid is precisely what is missing in the failing case. It
first asserts a stub was actually started, so it cannot pass vacuously, and reaps in its own `finally` so
a failing assertion does not leak the thing it is complaining about. Plant-verified: restoring the bare
`return` reds it.

Found by Osprey (residue `2026-09-14-vigil-sh-tests-leak-stub-servers`, PR #2496). The two live stragglers
were reaped by pid and their 238 MB of tmpfs reclaimed.

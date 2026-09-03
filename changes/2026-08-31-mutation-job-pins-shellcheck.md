<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The mutation job resolved a different shellcheck than the rest of CI, so its baseline failed on findings no other lane produces.

The `mutation (diff-scoped)` job installs `pytest mutmut hypothesis` and `requirements.txt` — **not
`shellcheck-py`**, which the test job does install. It runs no lint step of its own, so that looked
harmless. It is not: the mutation **baseline** runs the module's full test selection, which includes
`tests/test_shell_surface.py`.

That test resolves its binary as
`which("shellcheck", path=dirname(sys.executable)) or which("shellcheck")`. Inside mutmut's scratch,
`sys.executable` is the bare `.venv/bin/python` symlink the workflow creates, so nothing sits beside it
and the fallback hands over the **runner's `/usr/bin/shellcheck`** — visible in the traceback as
`args=['/usr/bin/shellcheck', …]`.

**The two binaries disagree.** The runner's older build flags three `SC2015` sites; the pinned
`shellcheck-py` (0.11.0) does not, and exits 0 on the same files — verified locally. The flagged lines
are the idiomatic guard form, where `C` is control flow rather than a fallback value:

    [ "$cls" = "e0" ] && [ "$sub" = "01" ] && [ "$pro" = "01" ] || continue
    [ $# -ge 1 ] && [ $# -le 2 ] || usage

So the baseline failed on a lint opinion the project does not hold, every mutant reported
`no budget: the clean run did not pass`, and `mutate_diff` REFUSED.

Two changes, and the second is not redundant: installing the pin is **necessary but not sufficient**,
because the scratch's venv-first lookup still finds nothing there and falls back to PATH ordering that
is not ours to rely on. So the pinned binary is also linked beside the scratch python, exactly as
`python` itself already is.

The link is best-effort and the step runs under `bash -e`, so it is an `if`, not
`test -n "$SC" && ln` — the latter aborts the whole step when the binary is absent, turning a missing
tool into a hard CI failure.

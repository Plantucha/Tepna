---
bump: patch
type: fixed
brief: none
---

`tools/mutation-suite.mjs` — five flags the tool **implements and reads** were absent from `CLI_FLAGS`,
the arity table its 2026-08-20 argument guard checks against, so passing any of them was refused:
`--attempts` `--crawl-dir` `--ctx` `--limit` `--model`. The guard itself is right (it stopped `--help`
from launching a 22-worker fleet sweep); its table had been written from the tool's **documented**
flags rather than the ones it actually reads.

**Measured cost:** the nightly triage's DRAFTING phase refused **all 8 files** for three consecutive
runs while reporting green, so no new module was crawled and the candidate count sat at exactly 1516.
Three layers had to fail together for that to be invisible — the missing table entry, a
`| tail -4` reporting tail's status instead of the command's, and a caller that flowed a nonzero into
a green summary.

The fix that makes it a fix rather than a patch is the third selftest direction: **every flag the CODE
reads must be one the parser accepts.** The two existing checks cover declared→parses and
usage→declared; neither can see a flag that is implemented and *undocumented*, which is exactly what
`--crawl-dir` was. ⚠️ Comments are stripped before the scan, and that is load-bearing — the prose
above the table contains a literal `has('--x')` as an example, and a scan that reads it as a real call
reports a phantom missing flag. Verified by re-application in both directions: removing `--crawl-dir`
from the table reds the check, and removing the comment-strip reds it with `--x`.

`tools/ai-probe-overnight.sh` no longer pipes the draft step through `tail`; it captures the command's
own exit code, counts failures, and exits 1 if any file failed — so a drafting phase that refused
everything cannot report success to its caller.

`tools/mutation-ai-probe.mjs` printed `mutation-suite.mjs --draft --crawl-dir <dir>` as advice, which
was wrong twice: the flag was refused, and `--draft` takes one argument, so `--crawl-dir` would have
been swallowed AS the filename even once accepted. It now prints the exact command with real values,
so following the tool's own instructions works and any future drift surfaces on first use.

`capture-host/tools/mutate_diff.py` — the ORPHANED-entry warning had two named causes ("the line
moved, or the entry is malformed") and a third, unnamed one that is the COMMON case: entries are
filtered to the modules a diff touched, but mutants are generated only for the FUNCTIONS it changed,
so every equivalence entry filed against another function in the same module matches nothing —
forever, through no fault of its own. Measured: two `load_rows` entries fired on a PR that changed
only `make_row`, and would fire on every future PR touching that file.

⚠️ Re-keying those entries would have been wrong: their `before` text matches the current source
**verbatim**, so nothing had moved. The discriminator needs no scope plumbing — if the entry's
`before` is still present in the module, the line did not move and the entry is out of scope rather
than stale. Controlled over five cases: both real entries classify out-of-scope, while a moved line, a
stale entry, and a malformed key with no `key` field all stay ORPHANED.

A warning nobody can act on is the "trains people to ignore it" failure this file's own header names.

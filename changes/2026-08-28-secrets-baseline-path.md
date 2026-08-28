---
bump: patch
type: fixed
brief: none
---

The supply-chain secrets step resolved its baseline **relative to `capture-host/`** and therefore
refused on every PR that reached it.

`capture-host-ci.yml` sets `defaults.run.working-directory: capture-host`, so a bare
`.secrets.baseline` resolves to `capture-host/.secrets.baseline` — and the baseline lives at the
**repo root**. The step took its own missing-baseline branch and exited 2 on #1927 itself, #1930 and
#1933.

🔴 **The gate was BLIND, not noisy.** It never scanned anything and never found anything; the
"blindness is fatal" refusal fired exactly as designed, on a path error of my own making. That
distinction was worth establishing before touching it: a job that fails because it *found* something
and a job that fails because it *could not look* need opposite fixes, and only one of them means the
tree is dirty.

Anchored to `$GITHUB_WORKSPACE`, and the scan now **runs** from the root as well — from
`capture-host/` it would have covered only that subtree while the baseline describes the whole tree,
which is a narrower scan read as a cleaner one.

Reproduced locally both ways before and after: bare path from `capture-host/` → missing; anchored →
found, 18 files in the baseline.

⚠️ **The design lesson is the one this repo keeps paying for**, and I wrote the refusal that caught me:
a correct refusal on a wrong path is indistinguishable from a correct refusal on a real problem. The
message said *"the scanner could not run"* and it was true — for a reason nobody would guess from the
message. A refusal should name **what it looked for and where**, so the next reader can tell a missing
file from a mislocated one. The path is now in the failure text.

## Two further defects, found by CI after the path fix un-blinded the job

**1 · `--exclude-files` REPLACES the baseline's stored pattern; it does not add to it.** So a scan
whose flags differ from the baseline's generation reports the whole difference as new findings.
Measured: passing a self-exclusion alone took the set from **19 files to 122** as every previously
excluded bundle, upload and provenance fragment flooded back. **`.secrets-exclude` is now the single
source**, read by the job and used verbatim when regenerating the baseline.

**2 · The baseline must exclude ITSELF.** A baseline is a file of hashed secrets by construction, so
scanning it feeds the gate its own output — its hashes appear as new high-entropy findings, which grow
the file, which adds more. Seen in CI as `"filename": ".secrets.baseline"` entries inside the diff
meant to report secrets elsewhere.

**3 · Exit code 141 — SIGPIPE.** `git diff | head -60` under `set -o pipefail`: `head` closes early,
git dies of SIGPIPE, the pipeline returns 141, and as the step's **last** command that becomes the
step's status. **An advisory branch was killing the job it only meant to narrate.** It did not
reproduce locally because the local diff was small enough for `head` to consume whole — the log's exit
code was the only evidence. Now written to a file and read from it.

Convergence verified the way that actually answers the question: **scan-over-scan on the same tree
leaves the baseline byte-identical** (19 files, 51 findings). My first check compared against `HEAD`
instead — which measures "has the baseline changed since the last commit", a different question that
was bound to say yes.

The one new finding since the first baseline is `changes/2026-08-28-supply-chain-gates.md:33` — the row
in *this feature's own changeset* quoting `"password": "hunter2"` while explaining that it is benign.
Eyeballed, and it is exactly as recursive as it sounds.

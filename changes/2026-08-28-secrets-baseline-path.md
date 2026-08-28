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

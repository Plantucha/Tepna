# Post-reboot resume — written 2026-08-19 ~05:00 EDT during the D-state incident

The volume was wedging (18 D-state processes, kernel `kcompactd0` included). If you are reading this
after a reboot, everything needed to resume survives on this volume; only `/tmp` state died.

## What was running and how to resume it

**Overnight AI probe** (converts mutation survivors → killable, then drafts assertions):
```
cd /run/media/michal/647A504F7A50205A/wt-aiprobe-c3d
nohup tools/ai-probe-overnight.sh > /tmp/ai-overnight.log 2>&1 &
```
It RESUMES from journals automatically (`.mutation-crawl/*.ai-probe.jsonl` — every answered mutant is
skipped; a kill cost at most one probe). Status anytime, read-only:
`node tools/mutation-ai-probe.mjs --status`. Last known: **2,213 answered / 45 newly killable**.
Drafts so far: `.git/tepna-mutation/*.drafts.js` (10 files — proposals, each needs a human read).

## Three UNPUSHED brief-close branches (commits safe in the object store)

In `wt-briefclose-p4t`: `claude/generator-iii-close` · `claude/findings-fixes-close` ·
`claude/refguide-header-sync`. Push each + `gh pr create` + `--auto` when the queue has slots
(≤4 open repo-wide). PR bodies can be reconstructed from the commit messages — they are complete.

## PRs that were mid-flight server-side
#1511 (integrator §4 gate) and #1512 (ENGINE-VERIFICATION close) — armed; check
`gh pr view 1511 1512`; if BEHIND and green, `gh pr update-branch` one at a time.
#1505 had a wedged `browser-gates` run (2 h+ against a 6-min max) — rerun it post-reboot.

## Before trusting the volume again (owner)
1. `dmesg | grep -iE 'I/O error|usb|sd[a-z]|ntfs'` and SMART for the 1.7 T NTFS drive (was 91 % full).
2. `verify-provenance.html` GATE A/B **first** — content hashes are the cheap detector for any
   silently-corrupted committed byte — then the behavioural gates.
3. The 352 registered worktrees / 310 directories are largely D-state residue; clean them ONLY after
   the drive is healthy, and serially, never as a bulk sweep.

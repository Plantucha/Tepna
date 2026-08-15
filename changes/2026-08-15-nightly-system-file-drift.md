---
bump: minor
type: added
---

**A fix can be merged, CI-green, and still absent from the field — and nothing in the repo could say so.**

`deploy/check-system-files.sh` is the only instrument that can see an installed helper diverging from the
repo, and nothing ran it on a schedule. Swept by hand on 2026-08-15 it reported `11 managed, 2 drifted,
1 SUPERSEDED`; the stale file was `tepna-restart.sh`, missing the **`deploy` verb** added the day before —
the fix for the Deploy button dying on `ProtectSystem=strict`. **Merged for a day, CI green, field
broken.** Drift surfaced only because somebody happened to look, three weeks after the brief.

`nightqc.py` now runs it once per night and records the counts as its own `system_files` field.

**It reports; it does not judge.** `ok` is deliberately untouched: QC already returns `ok=false` on ~10 of
11 nights for a benign doffing gap, and a drifted deploy file is an **operator action** (`--install`, or a
hand `rm` for a superseded leftover) rather than a bad night's capture. Another failure axis inside an
alarm nobody reads is worth nothing. A source-scanned test pins the absence of that coupling.

**`--json` on the script, because counts beat a bit.** `managedDrifted` and `superseded` are published
separately since they need **opposite** responses, and `drifted` already *includes* `superseded` — so a
consumer adding them would double-count while one reading only `drifted` cannot tell which action is owed.
Both are published so neither mistake is available. The script's human report is routed to `/dev/null`
under `--json` via one `exec`, rather than threading a conditional through every `echo`.

⚠️ **A design note received with this work was wrong, and checking cost less than believing it.** The claim
was that the exit code does not carry SUPERSEDED — that only MANAGED drift sets exit 1. Line ~168 is
`stale_etc=$((stale_etc + 1)); drift=$((drift + 1))`: it increments **both**. Measured in a redirected tree
with a planted leftover: **exit 1**, `3 managed, 10 drifted, 1 SUPERSEDED`. The box's installed copy is
byte-identical to the repo (md5 `ce4313605987`), so it was not a stale-copy story either. The reporter
confirmed and withdrew it; the claim never reached a brief or a commit.

**The real blind spot is different and deliberate:** SUPERSEDED is only reported once its replacement is
installed, so a stale `/etc` file whose replacement never landed is unreported, uncounted, exit 0. The
comment above it says why — otherwise the advice becomes *"delete the working file and install nothing,
which is how a box loses a rule"*. A known limit, not a defect.

Every unhappy path yields `None` rather than a zeroed record: not a deployed host, script absent, timeout,
unparseable, or a JSON scalar (`json.loads("7")` succeeds and returns an int). Zeros would read as
"nothing has drifted", which is the one wrong answer available here.

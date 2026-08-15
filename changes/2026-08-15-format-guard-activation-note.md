---
bump: patch
type: changed
brief: CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04-BRIEF.md
---

Corrects an overstatement in `guard-format.sh`'s own header, found by measuring the thing it claimed.

The header said `.claude/settings.json` hooks are loaded by "every session automatically", offered as
the reason this mechanism beats the git pre-commit hook that was declined for needing installation.

**A session reads `.claude/settings.json` from ITS OWN project checkout.** Measured immediately after
#1322 merged: the shared root was **92 commits behind**, with neither the wiring nor the script — so for
a window after merge the guard was in-repo and running for **nobody**, which is precisely the property
the git hook was rejected for (*"a hook that exists in-repo and runs for nobody"*).

The difference from a git hook is real but narrower than "automatic": a git hook needs `core.hooksPath`
set — an opt-in nobody here has done, so it stays off forever — while this needs a `git pull` and then
stays on. That is worth having, and worth stating correctly.

**It degrades safely, verified rather than reasoned:** a checkout carrying the wiring but not the script
runs `bash <missing>` → exit **127**, and the harness denies only on **2**. So a half-synced checkout
ALLOWS — the same direction as the no-Biome fail-open.

`CLAUDE.md` gains the general form, because it applies to all three guards: *"it is hook-enforced" means
"once you have pulled it"*, and the shared root is the checkout most likely not to have.

Docs and one comment block; no behaviour change. The self-test is unchanged and still passes.

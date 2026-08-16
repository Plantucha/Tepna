<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-08-16 (all four boxes verified 2026-08-16. §3 shipped as #1330 and was mutation-checked independently. **§4 was never built here because it already existed** — `stale-file.yml` (#1086) computes this brief's property line for line, and #1337 made it a REQUIRED check, which was the only piece genuinely missing. Both CLAUDE.md boxes were already satisfied. ⚠️ This brief read PROPOSED with four open boxes while fully executed, and its §4 invited a rebuild of a workflow that had shipped two months earlier — the stale-PROPOSED trap this repo keeps paying for) · **Created:** 2026-08-15 · **Affects:** `.github/workflows/`, `tools/`, `.claude/hooks/` (unchanged, but reclassified) · **Follows:** `CLAUDE.md` §👥.2, §👥.2b, §👥.2c

> **The one-line claim:** every rule `CLAUDE.md` calls "hook-enforced" is enforced **only for Claude
> Code, and only in a checkout that has pulled the hook**. The invariants are worth keeping; the
> enforcement mechanism is not the one the prose implies. Phase 1's detector is **already validated
> against the full history** — see §3.

---

## 1 · What is actually enforcing the shared-tree rules

Measured 2026-08-15 on `origin/main`:

```
.claude/settings.json
  .hooks.PreToolUse.hooks.command: bash "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-shared-tree.sh"
  .hooks.PreToolUse.hooks.command: bash "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-stale-brief.sh"

.git/hooks/   → samples only; no active hook
core.hooksPath → unset
```

Three consequences, none of which the prose states:

1. **The guards are Claude Code-specific.** They are `PreToolUse` hooks resolved through
   `$CLAUDE_PROJECT_DIR`. Any other operator — a second coding agent, a human at a terminal, the
   GitHub web UI — inherits none of them. "Hook-enforced" is true of one client.
2. **They are checkout-specific.** Measured independently on 2026-08-15 (#1324): a guard merged to
   `main` protected nobody, because the shared root was 92 commits behind and had neither the wiring
   nor the script. **A guard is live only where it has been pulled.**
3. **A git hook is not the fix, and this was already decided.**
   `CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04-BRIEF.md` §5 declined one, correctly:

   > *"a hook must be **installed**, and `core.hooksPath` is not set in this repo while several agent
   > sessions work the tree — so the common state is a hook that exists in-repo [and runs for nobody]."*

   That is the same failure as (2), one layer down. Re-proposing a git hook re-proposes a decided
   question.

**This is not an argument for weaker guards.** The Claude hooks are cheap, fire without an install
step, and cover the operator who does most of the work. Keep them. The gap is that the *invariant* and
the *enforcement* have been conflated, so the repo believes it has a property it has for one client.

## 2 · The decomposition — prevention vs detection

> **Prevention cannot be made agent-neutral. Detection can.**

Prevention requires intercepting an action before it happens, which means being in the operator's
tool loop — agent-coupled — or installed per clone — install-coupled. There is no third form, and
sandboxing is not one: a sandbox protects the machine from the agent, not the tree from a bad `git add`.

Detection evaluates a **property of the resulting commit or PR**, so it holds for every operator
including ones that do not exist yet. CI is already agent-neutral by construction: `protect-main`
applies to whoever opened the PR, and its 7 required contexts do not care which tool wrote the diff.

**So the project is not "port the guards". It is "move each invariant from prevention to detection,
where that is possible, and say so explicitly where it is not."**

## 3 · Phase 1 — the changeset-deletion detector · **ALREADY VALIDATED**

`CLAUDE.md` §👥.2b states that the 2026-08-03 corruption (a hand ref-move, then a blanket `git add -A`
staging 47 phantom deletions) is separable from a legitimate release by two features. **Re-measured
2026-08-15 against current history, not taken from the prose:**

| | releases | flagged |
|---|---|---|
| commits deleting a changeset | **32 total** | |
| 0 deletions outside `changes/` **and** 3/3 of `suite.manifest.json` · `CHANGELOG.md` · `RELEASE-MANIFEST.json` | **30** | — |
| anything else | — | **2** |

The two flagged are exactly the categories §2b predicts:

```
f0f4b83f  outside-dels=1  ledger=0/3   Revert "fix(capture-host): recover a connected senso…
a3e87cca  outside-dels=1  ledger=0/3   rescue: pre-cleanup snapshot — tree is stale, all wo…
```

`rescue:` snapshots **are** instances of the failure being detected, and the `Revert` is exemptible by
provenance. **Zero false positives over 30 releases.** Counts drift slightly from §2b's 33/29 because
history has moved; the separation is unchanged.

**The rule.** A commit that deletes a changeset is a release **only if** it deletes nothing outside
`changes/` and co-modifies all three ledger files. Otherwise it is flagged, unless its subject begins
`Revert ` or `rescue:`.

**Effort:** ~25 lines of `git` plumbing, seconds to run, no new dependency. The expensive part —
validation against the adversarial cases — is done above.

**Done when:** a CI job implements the rule; it runs green over every commit in history; and its unit
tests include a synthetic corruption commit that it *catches* (a detector never seen to fire is not
evidence — `CLAUDE.md` §🧪).

## 4 · Phase 2 — stale-brief overwrite detector · **ALREADY BUILT (#1086), REQUIRED since #1337**

> ⚠️ **DO NOT BUILD THIS.** It shipped 2026-08-09 as `.github/workflows/stale-file.yml` (#1086) —
> before this section proposed it. Verified 2026-08-16.

The property this section specifies is what that workflow already computes, line for line:

```sh
base="$(git merge-base HEAD "origin/$BASE_REF")"
git diff --name-only "$base"...HEAD             > mine.txt     # files this PR touches
git diff --name-only "$base" "origin/$BASE_REF" > theirs.txt   # files that landed since the fork
guard() { grep -E '^(briefs/.*\.md|DOCS-INDEX\.md)$' || true; }
overlap="$(comm -12 mine-g.txt theirs-g.txt)"                  # non-empty ⇒ exit 1
```

Same guarded set (briefs + `DOCS-INDEX.md`), `fetch-depth: 0` for the same reason this section needs
it, and on failure it prints the upstream commits plus `git log -p` and `npm run rebase`.

**The second complication below is not merely satisfied — it is quoted.** The workflow's own header
says the hook *"reads your local `origin/main` so it is only as fresh as your last fetch … This lane
has neither problem — it runs on GitHub against the real ref."*

**What WAS genuinely missing is enforcement, and that is now closed.** The check was advisory: it
reddened a PR, and auto-merge — used on essentially every PR here — merged it anyway. `stale-file` is
the **8th required context** on ruleset `protect-main` as of **#1337** (owner-directed, 2026-08-16).
Detection became prevention.

**On the first complication — the declared-override marker — the decision is NOT to add one.**
`exit 1` is unconditional, and that is right: **rebasing advances the merge-base, the overlap empties,
and the check passes by itself.** Rebase *is* the escape hatch, and it is the one that forces you to
read the upstream commits first — which is the entire reason this check exists, after two sessions each
wrote a brief without reading what the other had written. A PR-body marker would let someone skip
exactly that step. The hook needs `CLAUDE_ALLOW_STALE_BRIEF=1` only because a local hook cannot rebase
for you; CI has no such constraint.

⚠️ **The real remaining gap is one level up, and neither this workflow nor a marker would close it:**
two briefs holding the **same question in different files**. `stale-file` looks for the same PATH
touched twice, so it is structurally blind to this. Measured 2026-08-16 —
`HOSTAXIS-STABILITY-FOLLOWUPS` §3 and `INTERDISCIPLINARY-LITERATURE-2026-08-16` line 271 tracked one
question independently, and it surfaced only because `tools/doc-search.mjs` ranked them adjacently.
That is the GENERATOR-FOLLOWUPS-III failure one level up, and it currently has no detector.

## 5 · Phase 3 — rebase silently reverting source · **OUT OF SCOPE, and stated as such**

§👥.2c's failure — `git checkout <ref> -- <conflicted>` reverting a source file during a rebase, with
a clean tree and a commit message still describing the vanished change — is the one that cost the most
(one line reverted a test group, a DSP fix and a provenance entry from a single commit).

**It is not mechanically decidable.** The signature is *"the commit message claims X, the diff does not
contain X"*, which requires intent. The nearest tractable proxy is narrow and conventional: assert a PR
touching `tests/dex-tests.js` still contains identifiers its own body names.

**This phase is deliberately not attempted.** Declaring the gap is the deliverable: `rebase-safe.mjs`
plus the §2c prose remain the only defence, they are prevention, and prevention is agent-coupled. A
brief that quietly omitted this would imply coverage that does not exist.

## 6 · Two traps this work must not walk into

1. **No `paths:` filter, and no job-level `if:`.** `capture-host-ci.yml:23` is explicit —
   *"NO `paths:` FILTER, AND THAT IS LOAD-BEARING — DO NOT ADD ONE BACK"* — and `:131`, *"NO JOB-LEVEL
   `if:` HERE."* A required context that never reports blocks the PR **forever** with zero failing
   checks. The job must **always run and always report**, computing applicability internally and
   exiting early with a stated reason.
2. **Validate against `tools/release.mjs` before proposing any guard.** The last outcome guard
   proposed for this area **would have blocked every release**, and that was found only by testing it
   against the release tool. The release commits are the adversarial cases, not the corruption.

## 7 · What this brief does NOT claim

- It does not make Tepna safe for an arbitrary coding agent in the shared tree. Phase 1 catches one
  corruption shape *after* it is committed and *before* it merges. `git add -A` in a shared checkout
  remains unprevented for any non-Claude operator.
- It does not justify adding such an operator. That is a separate decision with a separate data
  boundary — an agent with filesystem access reads `uploads/`, the briefs and the corpus paths, and no
  sandbox changes that.
- It does not weaken the existing hooks. They stay as fast local prevention for the majority operator.

## Done when

- [x] **DONE — #1330.** `tools/commit-shape.mjs` (pure `classify()` + CLI), wired into `npm run check`
      and the always-runs `static` CI job, with a 14-assertion group. Green over full history: 32
      changeset-deleting commits → 30 releases pass, 0 false positives, 2 exempt **by declared
      provenance, never by shape** (one `Revert`, one `rescue:` snapshot — a rescue is shape-identical
      to the corruption on purpose, so widening the shape rule would re-admit the accident). It refuses
      with **exit 2 on a shallow clone**, because `actions/checkout@v4` defaults to depth 1 where the
      scan finds nothing and exits 0 — a detector reporting success about history it never had.
      Independently mutation-checked: four boundary mutants applied, all four killed.
- [x] **DONE by supersession — #1086, enforced by #1337.** Not built here: it already existed as
      `.github/workflows/stale-file.yml`, computing this section's property line for line (see §4). The
      missing piece was that it was advisory while auto-merge is used on every PR; it is now the 8th
      **required** context on `protect-main`. **The declared-override marker was considered and
      rejected with a reason** — rebasing empties the overlap by itself, so rebase is the escape hatch,
      and it is the one that forces you to read the upstream commits first.
- [x] **DONE** — `CLAUDE.md` now says the phrase is narrower than it reads (*"Measured 2026-08-15…"*),
      states that **prevention cannot be made agent-neutral** (agent-coupled or install-coupled), and
      carries the per-invariant table of what agent-neutral enforcement actually exists.
- [x] **DONE** — that same table states §2c explicitly: *"none — not mechanically decidable. Prevention
      only."* The gap is written down rather than implied, which is what this box asked for.

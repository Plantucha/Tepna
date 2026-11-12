<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** PROPOSED (triaged 2026-11-04: not built — the workflows already carry `merge_group` triggers, but root bundles still ride PR diffs and `CLAUDE.md` still records no queue) — 2026-10-20 · **Created:** 2026-10-20

# GENERATED-OUT-OF-PRS — take the generated trees out of the PR diff, then batch the queue

> Owner, 2026-10-20: adopt a batching merge queue, and keep generated bundles out of PR conflicts.
> This brief measures the cost and states the sequence. The two changes depend on each other.
> A batch of PRs that each re-bundle one orchestrator conflicts inside the batch branch.
> So the generated trees leave the PR first, and the queue batches second.

## 1 · What the churn costs today

| measurement | value | window |
|---|---|---|
| first-parent commits on `main` that touch a root bundle | 64 of 400 | the last 400, as of 2026-10-20 |
| bundles inside GATE A | 9 | `manifest-gate.js MANIFEST_BUNDLES` |
| orchestrators re-bundled by any inlined change | 2 | `build.mjs ORCHESTRATORS` |

Prior work names the mechanism:

- `CLAUDE.md` §2c: the two orchestrators collide across PRs that share no source.
- Memory `same-node-units-collide-in-generated` (2026-09-23): two units in one node collide on every merge. The collisions sit in the bundle, `docs/<Node>.html`, the provenance fragment and the goldens. The sources merge clean.
- Board #621 and #622 (2026-10-20): GitHub creates no workflow run for a PR it holds CONFLICTING. An empty commit does not help. Only a push that carries a merge of `origin/main` starts the checks.

A generated conflict therefore costs a session turn, a rebuild and a full CI cycle. The diff does not change.

## 2 · The proposal

PRs carry source only. A job on `main` rebuilds the generated trees after each merge and commits them.

1. A PR changes `*.js`, `*.src.html`, tests, tools and docs.
2. CI on the PR runs `build.mjs --check` against a fresh build, not against committed bundles. The gates run on the fresh build.
3. After a merge, a workflow on `push` to `main` runs `build.mjs --all`, `build-docs.mjs` and the regen tools. It commits the generated trees as one bot commit.
4. `tools/rebase-safe.mjs` keeps its generated list. It has less to resolve.

### 2.1 · What has to change

| part | today | after |
|---|---|---|
| GATE A (`manifestHash`) | a PR commits the ledger beside the bundle | the post-merge commit writes the ledger |
| GATE B (fixture outputs) | a PR regenerates moved goldens | unchanged: goldens are inputs to a test, so they stay source |
| `docs/` served copies | a PR rebuilds them | the post-merge commit rebuilds them |
| `release-ledger` check 7 | reads code moved since the last snapshot | unchanged |
| `commit-shape.mjs` | knows `Revert ` and `rescue:` | also exempts the bot commit, by its declared author |

### 2.2 · Open questions for the owner

1. **ANSWERED 2026-11-12 in §2.2.1.** Does anything read a bundle from a PR branch? Nothing downloads one. Three tools read the committed bytes on every pull request.
2. May a bot commit to `main`? The protect-main ruleset must admit it, and only for the generated paths.
3. The release tool builds everything anyway. Should the bundles move to release time only? `main` would then lag source between releases.

### 2.2.1 · Who reads a committed bundle on a pull request (measured 2026-11-12)

Question 1 asks whether anything reads a bundle from a PR branch. Nothing downloads one.
Three tools read the committed bytes, and each one runs on every pull request. The browser
lane is the hardest case. It serves the checkout over HTTP and opens the built pages in a
real browser.

| consumer | what it reads | where it runs |
|---|---|---|
| `verify-provenance.html` | `fetch`es each of the 9 `MANIFEST_BUNDLES` and hashes the bytes | `tests/browser-gates.mjs:515` |
| the mobile-viewport leg | opens 12 built pages at 375 px | `tests/browser-gates.mjs:785` |
| the night-seal leg | opens `OverDex.html` | `tests/browser-gates.mjs:634` |
| `Dex-Test-Suite.html?full` | loads every bundle's modules | `tests/browser-gates.mjs:326` |
| `tools/build.mjs --check` | holds the 11 owned bundles against a fresh build | `tests.yml:166` |
| `tools/module-carriers.mjs` | reads every root `*.html` from disk | `local-steps.yml`, `npm run verify:module-carriers` |

The browser lane runs twice on a pull request. `browser-gates.yml:174` runs `npm run gates:browser`.
`no-network.yml:100` runs the same script. Both start a server on the checkout first.

**Two negative answers.** No workflow uploads a bundle as an artifact. `mutation.yml:143` uploads
`mutation-diff.ndjson` and `mutation-diff.log`, and nothing else. No tracked file holds a
branch-pinned download link to a bundle. The one `/blob/` hit names an external SDK document.

```sh
grep -rn 'upload-artifact' .github/workflows/
grep -rnE 'raw\.githubusercontent|/blob/|/raw/' --include='*.md' --include='*.yml' .
grep -nE 'page.goto|MOBILE_PAGES|LEGS =' tests/browser-gates.mjs
grep -n 'MANIFEST_BUNDLES' verify-provenance.html
grep -nE 'readFileSync|readdirSync' tools/module-carriers.mjs
```

**What this costs the proposal.** A pull request that carries no bundle gives the browser lane no
page to open. So §2 owes one build step before each server starts. `build.mjs --all` writes the
11 bundles. The lane then judges a fresh build rather than the committed one.

GATE A keeps its
meaning, because a fresh bundle carries the fresh `manifestHash`. Section 2 already proposes that
change for `build.mjs --check`, so one step serves both.

## 3 · The batching queue

The repo is user-owned, so the native merge queue is not available (`CLAUDE.md` §5). Two routes exist:

- Install the Mergify app on this repo. It batches PRs on a personal repo.
- Move the repo into a GitHub organisation. The native queue then works, and every workflow already listens on `merge_group`.

Both routes need an owner action: an app grant or a transfer.

### 3.1 · A proposed Mergify configuration

Do not commit this file while Kodiak runs. Two merge bots on one queue race each other.

```yaml
queue_rules:
  - name: default
    batch_size: 4
    batch_max_wait_time: 10 min
    merge_method: squash
    queue_conditions:
      - base=main
      - -draft
      - label!=do-not-merge
pull_request_rules:
  - name: queue every ready PR
    conditions:
      - base=main
      - -draft
      - label!=do-not-merge
    actions:
      queue:
        name: default
```

`batch_size: 4` equals the WIP cap of four ready PRs. The merge method and the blocking label match `.kodiak.toml`.

### 3.2 · Cutover

1. Land §2 first. Batching before §2 conflicts on every orchestrator rebuild.
2. The owner installs the app or moves the repo.
3. One PR removes `.kodiak.toml` and adds `.mergify.yml`.
4. Watch one full batch land. Then retire `tools/queue-doctor.mjs` and `tools/land-pr.mjs`, or keep them for the fallback.

## 4 · Acceptance

- [ ] A PR that changes one `*-dsp.js` carries no generated path in its diff.
- [ ] Two PRs that change one node merge in sequence with no conflict and no extra push.
- [ ] GATE A and GATE B pass on `main` after the bot commit.
- [ ] The queue lands a batch of two or more PRs in one CI cycle.
- [ ] `CLAUDE.md` §2c and §5 describe the new path. The owner edits `CLAUDE.md`.

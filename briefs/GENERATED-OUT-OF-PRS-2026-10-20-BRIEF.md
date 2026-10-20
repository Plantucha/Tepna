<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** PROPOSED — 2026-10-20 · **Created:** 2026-10-20

# GENERATED-OUT-OF-PRS — take the generated trees out of the PR diff, then batch the queue

> Owner, 2026-10-20: adopt a batching merge queue, and keep generated bundles out of PR conflicts.
> This brief measures the cost and states the sequence. The two changes depend on each other.
> A batch of PRs that each re-bundle one orchestrator conflicts inside the batch branch.
> So the generated trees leave the PR first, and the queue batches second.

## 1 · What the churn costs today

| measurement | value | window |
|---|---|---|
| first-parent commits on `main` that touch a root bundle | 64 of 400 | the 400 commits before `fd159fdda` |
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

1. Does anything read a bundle from a PR branch? A download link or a reviewer workflow would break.
2. May a bot commit to `main`? The protect-main ruleset must admit it, and only for the generated paths.
3. The release tool builds everything anyway. Should the bundles move to release time only? `main` would then lag source between releases.

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

<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Pending changesets and the v2.15.0 fold, verified — 2026-09-25

**What this is:** a report. No changeset, `CHANGELOG.md` or `RELEASE-MANIFEST.json` is edited. The only fix the task allowed was a `brief:` with an unambiguous typo, and every pending `brief:` resolves, so there was nothing to fix.

**Totals:**

- **Pending (12 changesets on `origin/main`):** all 12 have a valid `bump`/`type`, and all 12 `brief:` values resolve (4 to an existing brief, 8 to `none`). 10 carry no `nodes:` field. Of the 2 that do, 1 matches the bundles its PR touched and 1 names a bundle the PR did not touch.
- **v2.15.0 fold (61 changesets):** the newest `RELEASE-MANIFEST.json` record is `2.15.0 · 2026-09-25 · minor`, which matches `CHANGELOG.md`'s top released section `## [2.15.0] — 2026-09-25`. The release commit `face2c59` (#3063) deleted 61 changesets. All 61 were added by a PR subject-tagged `(#NNNN)` on `main`, so all are merged, and the first 50 characters of every body appear in the 2.15.0 section. There are **2 findings**, both in content that was folded.

## Pending changesets

| changeset | PR | bump · type | `brief:` | `nodes:` | bundles the PR touched | verdict |
|---|---|---|---|---|---|---|
| `2026-09-25-acc-companion-sidecar-refuses-posture.md` | #3077 | patch · fixed | `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md` ✓ | *(absent)* | ECGDex, PpgDex, Data Unifier, OverDex | `nodes:` absent |
| `2026-09-25-accruns-sidecar-refuses-fabricated-stillness.md` | #3071 | patch · fixed | `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md` ✓ | *(absent)* | MotionDex | `nodes:` absent |
| `2026-09-25-ecgruns-sidecar-reaches-parseecg.md` | #3066 | patch · fixed | `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md` ✓ | *(absent)* | ECGDex, PpgDex, Data Unifier, OverDex | `nodes:` absent |
| `2026-09-25-heap-probe-records-rss.md` | #3068 | patch · added | `none` ✓ | *(absent)* | — (capture-host only) | `nodes:` absent |
| `2026-09-25-monitor-draws-solid-night-verdict.md` | #3064 | minor · added | `none` ✓ | `[capture-host]` | — (capture-host, tools) | ok |
| `2026-09-25-nightqc-absent-is-not-degraded.md` | #3065 | patch · fixed | `none` ✓ | *(absent)* | — (capture-host only) | `nodes:` absent |
| `2026-09-25-ppg2w-routes-to-the-node-that-parses-it.md` | #3075 | minor · fixed | `none` ✓ | `[OxyDex, Data Unifier, OverDex]` | Data Unifier, OverDex | **`nodes:` names OxyDex; the PR touched no `OxyDex.html`.** The change is to `adapters/` routing *toward* OxyDex, so this is a question of what `nodes:` means, not necessarily an error |
| `2026-09-25-ppg2w-validity-sidecar-reaches-oxydex.md` | #3070 | minor · added | `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md` ✓ | `[OxyDex]` | OxyDex, Data Unifier, OverDex | ok (the orchestrators re-bundle on any inlined-module change) |
| `2026-09-25-qc-device-with-no-identity.md` | #3079 | patch · fixed | `none` ✓ | *(absent)* | — (capture-host only) | `nodes:` absent |
| `2026-09-25-qc-poll-json-retention-guard.md` | #3072 | patch · added | `none` ✓ | *(absent)* | — (capture-host only) | `nodes:` absent |
| `2026-09-25-verdict-names-its-coverage-basis.md` | #3067 | patch · fixed | `none` ✓ | *(absent)* | — (capture-host only) | `nodes:` absent |

The 12th file in `changes/`, `README.md`, is not a changeset.

`nodes:` appears in `changes/README.md`'s template but is not enforced: `release-ledger` passes with it absent. Ten of the twelve omit it, so the field is effectively optional in practice. Whether it should be required is a decision, not a fix.

## v2.15.0 fold — findings

1. **A template placeholder shipped as a changelog bullet.** `2026-09-24-solid-night-timebase-residual.md` (#3041, `minor · added`, brief `SOLID-NIGHT-2026-09-23-BRIEF.md`) was folded with the body `TODO: one imperative sentence — this becomes the changelog bullet.` The `CHANGELOG.md` 2.15.0 `### Added` section therefore carries the line `- TODO: one imperative sentence — this becomes the changelog bullet. (SOLID-NIGHT-2026-09-23-BRIEF.md)`. Nothing refused a changeset whose body is the unedited `new-changeset` placeholder.
2. **Two folded changesets carried a `brief:` that is not a brief file.** `2026-09-23-check8h-changeset-filename.md` (#2963) had `brief: RESIDUE 2026-09-23-check8h-reads-a-changeset-filename-as-a-row-key`, and `2026-09-23-patsd-absence-is-null.md` (#2966) had `brief: RESIDUE 2026-09-16-patsd-zero-is-a-fallback`. Neither resolves to `briefs/<value>`. Both were pruned by the release, so there is nothing left to fix. Whether `release-ledger` check5 accepts this `RESIDUE <key>` form, or it slipped past, was not determined here.

Rule 0 not run (cloud session).

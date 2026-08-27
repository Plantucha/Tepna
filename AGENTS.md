# Tepna — agent quickstart

Single-signal physiological analyzers (SpO₂ · HRV · raw RR · CGM · raw ECG · CPAP EDF · IMU),
each built from plain `.js` modules and bundled to one standalone HTML file. 100% local: no
network at runtime, no CDNs, system font stacks only. Metric units only, always.

**This file is the thin interop layer** for tools that read the AGENTS.md convention. The
authoritative depth is **`CLAUDE.md`** (it wins on every conflict with this file) and the
60-second map is **`ORIENTATION.md`**. Read both before nontrivial work; `AUDIT-PROMPT.md`
before auditing. Do not extend this file — a constraint that can live in a gate or in
CLAUDE.md must not be restated here.

## Commands

| task | command |
|---|---|
| full JS gate (exactly what CI runs) | `npm run check` |
| one test group while iterating | `node tests/run-tests.mjs --group=<name>` |
| rebuild one app after editing its `.js` | `node tools/build.mjs --app <App>` |
| Python lane gate (capture-host) | `cd capture-host && ./check.sh` |
| rebase without losing source | `node tools/rebase-safe.mjs` |
| land / unstick a PR | `node tools/land-pr.mjs <PR#>` · `node tools/queue-doctor.mjs --dry-run` |

## Boundaries

**NEVER**
- edit a bundled `Foo.html` — edit the `*.js` / `*.src.html`, then re-bundle
- `git add -A` / `git add .` / `git commit -a` — stage explicit paths only
- `git reset --hard` / `git clean` / hand ref-moves in a tree you did not dirty
- hand-edit `provenance/*`, a version number, or any fixture hash — the tools write those
- fabricate a timestamp: no `new Date(vendorString)`, no fallback to now(); missing → null
- rename or move a brief, or invent a status outside PROPOSED · IN-PROGRESS · DONE · REFERENCE · CHECKPOINT
- bare `git push --force` to origin — `--force-with-lease` only, after verifying the remote head is yours

**ASK FIRST**
- cutting a release or touching the release ledger
- deleting anything you did not create this session
- any network access from a runtime artifact (the answer is no; asking surfaces the design error)

**ALWAYS**
- private worktree off `origin/main` for anything touching bundles, ledgers, or DSPs
- run the gate your diff touches before pushing; the full gate before merge
- Clock Contract: floating wall-clock `tMs`, `getUTC*` display (see CLAUDE.md §🔒)
- an evidence badge on every user-facing number
- after any rebase, verify your own change survived: `git show HEAD:<file> | grep <your identifier>`

Apache-2.0 · Copyright Michal Planicka · brand **Tepna**; the event-bus codename `Ganglior` is frozen — never rename its identifiers.

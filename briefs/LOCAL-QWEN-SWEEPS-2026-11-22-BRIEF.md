<!--
  LOCAL-QWEN-SWEEPS-2026-11-22-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-11-22 · **Created:** 2026-11-22 · **Owner:** "yes" to a design, 2026-11-22 (token diet) · **Reopens, narrowly:** `QWEN-ENGINEERING-PROGRAM-2026-08-27-BRIEF.md` (shelved 2026-09-20)

# Local qwen first-pass sweeps — design and the check on its output

## 1 · Goal

A bird spends most of a sweep's tokens on reading files that hold no defect. The local model
(`qwen3-coder:30b` on Ollama, rig-x870) costs no API tokens. It reads the files first and writes
leads. A bird reads only the leads that survive a mechanical check. Success is fewer bird tokens per
confirmed defect, with no rise in false closures.

## 2 · What already exists (Rule 0)

`node tools/doc-search.mjs "local qwen first-pass sweep agent verification"` found:

| piece | state on 2026-11-22 |
|---|---|
| `tools/qwen-agent.mjs` | read-only agent loop: `read_file`, `doc_search`, `grep_repo`, `list_dir`. It has no write, shell or network tool. It writes a markdown report only. |
| `tools/qwen-idle-driver.sh` + `qwen-idle.timer` | mutation drafts, DSP review, mypy triage. The timer is enabled, but its unit list reads `Trigger: n/a`, inactive since 05:41 EST. This brief does not restart it. |
| `QWEN-ENGINEERING-PROGRAM` §2, §5 | the principles and trust levels below come from there. The owner shelved the program and its idle-time piece on 2026-09-20. |
| program §7-ter | measured failure: only 74 of 376 drafts (20 %) could be kill-checked at all. 6 of the 74 did not kill their mutant. |
| Shrike (Freebuff) | the same lead-then-verify flow. It pasted a fabricated `grep -n` line number on 2026-11-15. Its first 51-row triage produced 0 closures that survived a check. |

The design keeps what worked: the model picks where to look. Real code and real command output decide
what is true.

## 3 · The design

### 3.1 · Narrow lenses where a grep makes the candidate list

The model never searches the whole tree. A deterministic command lists the candidate sites first. The
model classifies each site against ONE question. First lenses, each with its grep:

1. **ABSENCE:** `?? 0`, `|| 0`, `.get(k, 0)`, zero-filled buffers in root `*.js` and `capture-host/`.
   Question: does this zero stand for a value that was not measured?
2. **CLOCK:** `new Date(<string>)`, `Date.parse`, `toLocale*` without `timeZone:'UTC'`, `getHours`.
   Question: does this read a wall-clock time outside the Clock Contract?
3. **BADGE:** numbers written into the DOM in `*-render.js` without a `MetricRegistry.badge()` call
   near them. Question: does a surfaced number carry no badge?

A lens with no grep (a "review this file" prompt) is out of scope. Program §2.3 measured that such
lenses have no stable precision.

### 3.2 · The lead format

One JSON line per lead in `.git/tepna-mutation/qwen-sweeps/<lens>/<UTC>.jsonl`, outside the tracked
tree:

```json
{ "lens": "absence", "ref": "<origin/main sha>", "file": "oxydex-dsp.js", "line": 412,
  "quote": "<the cited line, verbatim>", "claim": "<one sentence>", "check": "<a command a bird can run>" }
```

### 3.3 · The mechanical check — `tools/qwen-lead-check.mjs` (to build)

It spends no model tokens. It drops a lead when any of these fail, and it counts each drop by reason:

1. `ref` resolves, and `file` exists at that ref.
2. `quote` appears at `line` (±3 lines) of `git show <ref>:<file>`. This catches fabricated line
   numbers, the failure Shrike showed.
3. The site still matches the lens grep at the CURRENT `origin/main`. A lead on stale code drops.
4. No RESIDUE row at `origin/main` already names the same `file:line`.

It emits one `tepna.verdict/1` object: population = leads read, `excluded` = leads dropped (by reason),
criterion = 0 leads that fail rule 2 pass through.

### 3.4 · The bird's check — the only step that decides

1. The bird reads the surviving leads for one lens.
2. It re-reads each site on `origin/main`.
3. It reproduces the defect: a failing assertion, a planted mutant, or a captured input.
4. A confirmed defect becomes a fix PR or a RESIDUE row under the bird's own trailer. The body credits
   "lead from a local qwen sweep".
5. The bird rejects a lead it cannot reproduce. It records the reason in the lens ledger.

Nothing ships on the model's word. No lead closes a row. The model never opens a PR (program Level 1 only).

### 3.5 · Precision bands, stated before any data

Program §2.5, unchanged:

- After 30 triaged leads, the bird narrows or retires a lens under 30 % confirmed.
- No promotion beyond Level 1 in this brief.

The ledger is `.git/tepna-mutation/qwen-sweeps/<lens>/triage.jsonl`, one line per lead:
`confirmed | rejected | duplicate`, with the reason.

### 3.6 · Cost, measured, never claimed

For each lens batch the triage records the bird's tokens (`node tools/fleet-turns.mjs` before and
after) and the confirmed count. The comparison is tokens per confirmed defect against a bird sweep of
the same files. If the qwen path is not cheaper after two batches, the lens retires.

### 3.7 · Runtime limits

- One sweep at a time. It yields when the mutation pipeline holds the model (the idle driver's
  `api/ps` probe).
- ~~A bird starts a sweep by hand, on demand. No timer.~~ **Reversed by the owner, 2026-11-22:** "build
  some program feeding qwen and shrike. Preferably automatically, especially when fleet run out of
  tokens, there will be 2 days of compute always ready". `tools/compute-feeder.mjs` runs as stage 6 of
  `tools/qwen-idle-driver.sh` under the enabled `qwen-idle.timer`. Finch's `gpu-run.sh` pauses that
  timer for a GPU job and resumes it after, and the feeder also refuses to load the model when the card
  lacks the VRAM for it. It stops when the router's 1-input embed takes more than 2 s.
- The same tool keeps two Shrike pools (owner, 2026-11-22). `queue/` holds 6 h that Shrike works while
  the birds are awake. `reserve/` holds 48 h that Shrike does not read. `run` moves reserve tasks into
  the queue when no bird posts on the board for 3 h. The tool writes files only and never prompts Shrike.
- The 8 GB fleet RAM rule applies to the driver process. The model runs on the GPU.

## 4 · Known defect to fix first

`tools/qwen-agent.mjs` `distilledClaudeMd()` grabs the marker ``### 5. Display — ALWAYS `getUTC*` ``.
CLAUDE.md now reads ``### 5. Display — always `getUTC*` ``, so that grab returns empty. The agent then
reasons without the display rule, and nothing reports it. The fix matches the marker without regard to
case and reports a marker that is absent.

## 5 · Acceptance

- [x] `tools/qwen-lead-check.mjs`, with a self-test that feeds it one fabricated line number and one
      stale lead, and a registered verdict.
- [x] The §4 marker fix in `tools/qwen-agent.mjs`.
- [ ] One ABSENCE batch over 10 root `*-dsp.js` files, triaged by a bird, with the precision and the
      token cost recorded in a new §6 of this brief.
- [ ] A keep, narrow or retire decision for the lens, posted on the board as `--kind decision`.

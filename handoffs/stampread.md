# Wren — the timeline places a bar at its stream's first row

**Unit.** Row `2026-09-22-filename-stamp-still-wrong-for-other-consumers`, under Kestrel ruling board #1885. Read the 26 time readers in `tools/stamp-consumer-census.json` and judge each one. Fix `timeline.py` and every other small exposed reader. Log a row for an exposed reader with a larger fix.

**Branch + worktree.** `claude/stampread-wrn` in `wt-stampread-wrn`, cut from `origin/main`.

**What moved.**

1. `nightqc.artifact_start_s` reads `start_time_ms` from the acquisition sidecar beside a file. `scan_night` carries it as `first_row_s`.
2. `timeline._placed_from` places a bar at `first_row_s` when the sidecar states it. Otherwise it uses the filename stamp. Each start names its source.
3. Each stream in the timeline output carries `start_source`, a count of bars per source.
4. `tools/ppg-foot-consensus-e1.mjs` and `tools/ppg-fusion-e3.mjs` take the `--sleep-only` hour from `rec.t0Ms`, the first row, not from the filename.
5. The filename stamp misplaces the window in `tools/wearable-sync.mjs` too, and its fix needs a second read of every ACC file. Row `2026-10-28-wearable-sync-anchors-its-window-at-the-session-stamp` records it.

**The 26 readers.** "Session key" means the reader groups files by session. The session start is the right value for that job.

| reader | verdict |
|---|---|
| `capture-host/timeline.py` | exposed, fixed here |
| `capture-host/nightqc.py` `_session_of` | session key, correct |
| `capture-host/solid_night_inputs.py` | session-in-band test, correct |
| `capture-host/nights_index.py` | session start and span, correct |
| `capture-host/parse_dat.py` | the ring names a stored file by its own record start, not exposed |
| `clock.js` | the owner, not a consumer |
| `oxydex-dsp.js` | vendor `.bin` names state the record start, not exposed |
| `adapters/resmed-edf.js` | ResMed device stamp, not exposed |
| `cpapdex-app.js` | ResMed device stamp, not exposed |
| `cpapdex-edf.js` | ResMed device stamp, not exposed |
| `cpapdex-dsp.js` | ResMed device stamp, not exposed |
| `pat-feasibility.js` | first data row; the stamp only for a file with no row |
| `sensor-trio-night.js` | first data row; the stamp only for a file with no row |
| `sensor-trio-power-analysis.js` | first data row; the stamp only for a file with no row |
| `sigma-no-reference-analysis.js` | first data row |
| `dex-ingest.js` | nearest-stamp pairing in one session, 24 h bound |
| `signal-orchestrate.js` | nearest-stamp pairing in one session |
| `pat-classic-vs-fused.js` | nearest-stamp pairing in one session |
| `ppgdex-app.js` | pairing; prefers `rec.t0Ms` |
| `tools/pat-matchrate-strict.mjs` | candidate pre-filter; the parse decides overlap |
| `tools/ppg-foot-consensus-e1.mjs` | sleep hour exposed, fixed here; pre-filter bound 24 h |
| `tools/ppg-fusion-e3.mjs` | sleep hour exposed, fixed here; pre-filter bound 24 h |
| `tools/acc-acc-control.mjs` | night key, session-level; rows carry the time |
| `tools/cpap-corpus.mjs` | ResMed set clustering, not exposed |
| `tools/trio-batch.mjs` | night key, session-level; `t0` from data since PR #2846 |
| `tools/wearable-sync.mjs` | exposed, new row |

**Plant.** With `_start_of` forced to the stamp, two of the 13 new tests fail. With the fix, all 13 pass.

**Gates.** `capture-host/check.sh` reads EXIT=0 at 100 % branch coverage, and mypy holds the 0 baseline. `stamp-consumer-census` reads PASS.

**Next step.** Kestrel readies the draft, PR #4049. After the merge, run `node tools/wt-done.mjs` on the worktree, then release claim board #1886.

**Open questions.** `monitor.html` does not draw `start_source` yet. The JSON carries it, and the restyle lane owns the page.

**Doc-search query.** `node tools/doc-search.mjs "filename stamp is the session start, a stream opens later; timeline bar placement first row sidecar"` — board #373 (part (a) needs no code) and board #1195 (Heron's part (a) sizing).

```json
{ "schema": "tepna.verdict/1", "gate": "stamp-reader-exposure", "status": "PASS",
  "population": { "checked": 26, "eligible": 26, "excluded": 0 },
  "criterion": { "name": "readers_judged", "threshold": 26, "unit": "readers", "direction": "gte" },
  "result": { "exposed": 4, "fixed": 3, "logged": 1, "not_exposed": 22 },
  "evidence": ["tools/stamp-consumer-census.json", "capture-host/tests/test_timeline_first_row.py"],
  "reason": null, "producedBy": { "tool": "handoffs/stampread.md", "commit": "8ae525eff" }, "at": "2026-10-28T06:30:00Z" }
```

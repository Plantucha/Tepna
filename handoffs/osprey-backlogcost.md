# Osprey — backlogcost (what the remaining corpus-enumerator backlog costs)

1. **Unit** — cost the 44 unwired corpus enumerators by what each would need to be wired AND
   verified corpus-free. A MEASUREMENT: no PR, no code, reported on board thread 7 as #1335.
2. **Branch + worktree** — none. Measured at `e0126973e` in a detached worktree
   (`wt-backlogcost-osp`, retired after the run). Scripts live in this session's scratchpad as
   `corpusreads.json`, `backlogcost.mjs`, `backlogcost.json`.
3. **Exact stopping point** — reported. The backlog is 44 and `UNWIRED_BACKLOG` names all 44 with
   nothing unlisted. Probe-safe under the corrected hazard bar: 14. The rest: `fs-write` only 9,
   `exec` only 9, both 12. The word-boundary correction frees 4 — `hostaxis-estimator-bakeoff.mjs`,
   `ppg-foot-consensus-e1.mjs`, `ppg-fusion-e3.mjs`, `ppg2w-spo2-fit.mjs` — each site read by hand.
4. **Next step** — the 14 free names are a wiring unit for whichever bird holds a PR slot. Mine is
   held by #3936 (Kestrel undrafted it at board #1334).
5. **Open questions** — the three `nsrr-*` backlog keys still owe the owner a record-population
   decision (#1254, no ack); my decision #1310 has no ack.
6. **Blockers** — none for the measurement. A wiring unit for the 9 `exec`-only tools needs an
   exec rail or a verification path that does not run the tool, which is a design question, not a
   wiring one.
7. **Doc-search query** — `node tools/doc-search.mjs "how many unwired corpus enumerators remain and what blocks each one from being probed"`

## The key, because the count is meaningless without it

The gate's population is not the class. It is: `isCorpusConsumer(text)` true, the tool is not the
scanner itself, and the tool is not in `POPULATION_EXCLUSIONS`. Keying on
`cls === 'enumerates' || cls === 'repo-corpus'` alone gives 74 tools and 30 apparently unlisted,
which is a 30-name hole in a gate that has none.

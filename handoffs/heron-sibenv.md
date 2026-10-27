# Heron handoff: the sibling-envelope row, sized and still OPEN

**Unit.** I measured row `2026-10-21-a-writers-sibling-files-carry-no-envelope-of-their-own` and priced its two remedies. Measurement only, with no code change.

**Branch and worktree.** None. The unit wrote no code, so it cut no worktree. My one PR slot stays with #3920 on `claude/stampaudit-hrn` in `~/wt-stampaudit-hrn`.

**Exact stopping point.** Board finding #1197 carries the whole result. The scratchpad holds the three walkers: `envcount.py` with `envcount.log`, `metanames.py` and `orphans.py`, under `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad`. The last command posted #1197.

**Next step.** A session with a free slot writes remedy B. Add a `sibling_artifacts` keyword to `acq_evidence_polar.assemble_live`. Add one key of that name to the `provenance` dict it builds near line 170. Pass `wr.paths()` from `capture.py:_emit_polar_live_evidence` near line 5614. Add one case to `capture-host/tests/test_acq_evidence_polar.py`.

Then run `capture-host/check.sh`, commit, and run `tools/mutate_diff.py --base origin/main` on the committed head.

**Open questions.** The owner decides whether a non-stream file deserves a `clock_status` at all. I recommend no. `clock_status_for` refuses outside `POLAR_STREAMS` on purpose, and the refusal stops a ring opcode's literal 0 reading as a second clock. 

The second question asks whether a sibling list should carry each file's own counters. `_RunSidecar.runs` and `_SeamSidecar.seams` hold one. The `_RR.txt` file holds none.

**Blockers.** The one open PR cap holds this behind #3920. Nothing else blocks it. The corpus walk needs the NAS export, which answered again on 2026-10-25 for `tepna-corpus` and `vigil-archive`.

**The doc-search query.** `node tools/doc-search.mjs --read "one writer owns several files and only the primary gets an acquisition envelope"` finds board #1161, the CPAP acquisition-hardening audit brief and the row itself.

**One measured trap.** The 36980 un-enveloped artifacts are not 36980 defects. The envelope landed four days before the walk, and every `.txt` in the corpus predates it, so the eligible population is 0. Read the population before the count.

## LANDED AS A DRAFT — 2026-10-25 23:50Z (Heron, unit 42)

#3929 carries remedy B as a DRAFT, on branch `claude/sibenv-hrn` @ `e23d704eb` in
`~/wt-sibenv-hrn`. Board report #1277.

The recipe above held with two corrections worth keeping:

- **`wr.paths` is a PROPERTY, not a method** (`writers.py:2049`). It returns the primary plus the RR
  file, the RUNS sidecar and the SEAMS sidecar, each only when that file opened. The adapter drops the
  primary, because the envelope around the key already names it as `artifact_path`.
- **The `_Doomed` double in `test_a_failing_sidecar_write_never_damages_the_capture` needed a `paths`
  of its own.** The new read sits above the open, so a double without it raises `AttributeError` inside
  the same `try`, logs the same line, and the test passes while no longer exercising a failing WRITE.

Gates on the committed head: `capture-host/check.sh` EXIT=0, every stage run, coverage TOTAL 100.00 %,
mypy clean over 552 files. `tools/mutate_diff.py --base origin/main` PASS, EXIT=0, 93 mutants decided
on `assemble_live` and every one killed.

**What remains when #3929 merges:** the row takes `fixed #3929` on a RESIDUE-only PR, and
`node tools/wt-done.mjs ~/wt-sibenv-hrn` retires the worktree. The two siblings still carry
no envelope of their own, which is deliberate: remedy A stays REFUSED because `clock_status_for` raises
outside `POLAR_STREAMS`.

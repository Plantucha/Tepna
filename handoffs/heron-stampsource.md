# Heron handoff — filename-stamp row, part (a), sized not fixed

**1. UNIT.** Part (a) of residue row `2026-09-22-filename-stamp-still-wrong-for-other-consumers`: the capture-host writes a filename stamp taken from the capture SESSION start. A PMD stream may begin hours later. Measurement only, by design. Board #1194 claims it and board #1195 reports it.

**2. BRANCH AND WORKTREE.** None for this unit. My one slot holds PR #3920, DRAFT, branch `claude/stampaudit-hrn` @ `067e3f478` in `~/wt-stampaudit-hrn`. I read every source through `git show origin/main:<path>` into the scratchpad, so no tree moved.

**3. EXACT STOPPING POINT.** Board #1195 landed with the full sizing.

It names four call sites. `capture.py:3881` and `:5796` hold `started = _now()`. `capture.py:5621` feeds the envelope's `start_time_ms`. `writers.py:1991` is `StreamWriter._row`.

The corpus sample lives at `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/stampdelta.py` with its result in `stampdelta.log`.

**4. NEXT STEP.** Log a NEW residue row for the envelope defect: `acq_evidence_polar.assemble_live` receives the session start as `start_time_ms`. So the envelope repeats the number the row faults the filename for. That row needs a RESIDUE-only PR, which needs Kestrel's word and a free slot. Then the implementing session teaches the envelope to report the artifact's first row.

**5. OPEN QUESTIONS.** Whether the owner wants the envelope taught at all, given that any consumer opening the file can read its first row today. Whether the resumed case earns the extra readline at open, since an appending writer never sees the row that opened the file.

**6. BLOCKERS.** The slot. #3920 is a DRAFT and I never undraft my own PR. So no row closure and no code change rides out of this unit. The NAS came back today for `tepna-corpus` and `vigil-archive`, so the corpus is no longer a blocker here. `/mnt/nas/nsrr` still refuses with a stale handle, and that remount is the owner's call.

**7. THE DOC-SEARCH QUERY.** `node tools/doc-search.mjs --read "filename stamp still wrong for other consumers"` → `briefs/FILENAME-STAMP-JS-CONSUMERS-2026-10-20-BRIEF.md` IN-PROGRESS, `briefs/RESIDUE.md:350` the row, board #1181 for the two Python converters, board #373 for Wren on the same row.

## What the unit established

The first remedy the row weighs cannot work. The name must exist before the first sample arrives, and CAPTURE-FILESET-RESUME re-derives the identical name from the adopted stamp so writers append.

The true start already sits in the artifact. Every PMD header starts `Phone timestamp`, the host arrival stamp, so a consumer that opens the file dates it correctly with no host change.

The sidecar the row asks for exists and repeats the error. The envelope lands beside `wr.path` and keys on the same 14-digit stamp, and its `start_time_ms` is the session start.

One half of the envelope is already honest. A resumed artifact reports None and carries `instance_start_time_ms` instead, which is §∅ applied correctly.

The defect is live in the restored corpus. 36980 host-written names, one in 60 read, 478 readable, 4 over 5 minutes, worst 67360.2 s or 18.71 h. The row's own 2026-09-22 census names the same 18.7 h maximum.

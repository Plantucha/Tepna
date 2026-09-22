---
bump: patch
type: fixed
brief: none
---

guard-memory-stale still fails open without jq — a hook that errors on every tool call breaks the session — but it no longer does so silently: one notice per session, on a write, never on Read, gated by a session-scoped TMPDIR marker (CLAUDE_CODE_SESSION_ID is readable without jq). The siblings' fail-open reasoning does not transfer and the header now says why: guard-format degrades to a required CI check, this degrades to nothing because the memory directory is not in git and no gate reads it. Report-once is documented as deliberate, with the snapshot/report/re-snapshot sequence spelled out so a later exit 0 is not read as "nothing happened". And the cost comment is corrected: it claimed "single-digit ms" where 43.6 ms was measured, so it now carries both machines with their file counts (rig 43.6 ms/511, box 48 ms/320 — 60 % more files for 9 % less time, so the cost is not file-count-dominated).

---
bump: minor
type: added
brief: none
---

`.claude/hooks/guard-memory-stale.sh` — the stale-brief guard's shape for the per-project MEMORY directory, which is shared by every fleet session and is not in git: a Read of a memory file records its mtime in a per-session ledger beside the memory dir; an Edit/Write of an existing memory file is denied unless this session read it and it has not changed since (the read-then-someone-else-wrote race the harness's read-before-Write rule cannot see); a PostToolUse hook re-records after the session's own write; a new file is never an overwrite. Wired for Read/Edit/Write in .claude/settings.json, 23-check self-test in test:hooks. §2b-bis applies and bites hardest here: it protects only sessions whose checkout pulled it, and there is no CI counterpart because the directory is outside git — the header says so.

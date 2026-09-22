---
bump: minor
type: fixed
brief: none
---

guard-memory-stale gains a Bash PRE arm (prevention, best-effort on the forms whose path is in the command text: a redirect/tee/cp/mv, an in-place sed) and a Bash POST arm (detection, which ignores the command and reports a memory file whose mtime moved in a session that never read it). The Edit|Write matcher covered one fleet session at 0 % — it runs under an instruction to prefer Bash for file edits, so every memory file it wrote went through a heredoc the guard never saw — and a pre-hook alone cannot close that: a python heredoc with a computed path is undecidable from the command string. Detection reads a property of the result instead, so no write form evades it. Cost measured and fixed before landing: the first scan forked stat+grep per file and cost 3277 ms per Bash command over 511 files; find -printf plus one awk pass brings it to 43.6 ms. Test plants all three forms — heredoc, sed -i, and a python program whose path only detection can catch — plus a second project slug.

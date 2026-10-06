---
bump: patch
type: added
brief: GEMINI-SECOND-READER-2026-10-05-BRIEF.md
---

A second reader for mutation survivors, on exactly the form Codex was given, after Codex's free tier was exhausted. The reader is handed a survivor list and returns, per mutant, one concrete distinguishing input or an equivalence argument citing line numbers — never test code, and it decides nothing: every claim is verified against original and mutant by hand before any test is written. The key is read from the environment or from a 0600 file the owner places, and the tool refuses with a named reason when neither exists or when that file is group- or world-readable; the value is never logged and is stripped from every error text, including stack traces, because an exception that interpolates a request URL is the leak. Gemini has no working directory, which is the one place this cannot copy Codex literally: Codex read the export itself under a read-only sandbox, so for an HTTP reader the source must be sent instead, and the corpus boundary moves from the sandbox to this tool's refusal to read a byte from anywhere except an export built by `tools/codex-export.mjs` — verified by its marker files and by the absence of the data trees, so that a plain checkout, which would carry `uploads/`, is refused rather than read.

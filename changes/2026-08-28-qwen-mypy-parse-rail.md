---
bump: patch
type: added
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---

A **parse rail** for the §P2 lane, plus what the first 9 triaged proposals measured.

## The rail: a proposal must parse as Python

No judgement is involved, so it belongs in the verifier rather than the prompt — and it catches a class
the other rails **structurally cannot see**: a reply answering in **prose** contains neither `Any` nor a
bare `type: ignore`, so every existing rail passes it.

⚠️ A proposal is a **fragment**, so a naive `ast.parse` would reject honest ones for being indented or
for starting inside a block. Two attempts, and only a double failure rejects: the dedented text, then
the same re-indented under `if True:`. Python's own parser is the authority; nothing re-implements
Python syntax.

Verified against replies this lane has actually produced — a `def` block with an 8-space body, a bare
indented statement and a plain annotation all pass; a truncated call, an unbalanced bracket and a prose
answer all fail.

## ⚠️ The display-truncation lesson, made mechanical

Triaging the first cycle I nearly reported a proposal as truncated-and-invalid. It was whole; what I
had read was **my own 100-character print**. Two assertions now pin it: the full stored record parses,
**and its display slice does not**. A summary is not the record.

## What the first 9 triaged measured

🔴 **The band as written is arithmetically unreachable.** `<30 % accepted after 30 triaged` needs 30;
this lane's classes hold **12 of the 189 errors**. Routed to the owner undecided — the rate sits near
the bar, so whoever picks the denominator picks the verdict.

⚠️ **The characteristic failure is HINT PATTERN-COMPLETION.** mypy writes
`Need type annotation for "out" (hint: "out: list[<type>] = ...")`, and the model fills the placeholder
with a plausible scalar **without reading what is appended** — `list[bool]` at `nightqc.py:472` and
`list[str]` at `nightqc.py:1111`, where both functions `out.append({…})`. Both are annotations a
hurried human would wave through, which is exactly why every proposal is human-read. Recorded in the
findings ledger under lens `mypy-fix`.

**Known limitation, deliberately not fixed:** `object` evades the `Any` rail. It carries nearly as
little — but it is sometimes the *honest* type for heterogeneous data, so widening the rail would
auto-reject honest annotations. Eyes-first covers the lazy cases.

**43 selftest assertions**, all green.

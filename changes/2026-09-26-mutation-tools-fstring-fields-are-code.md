---
bump: patch
type: fixed
brief: none
---

The diff-scoped mutation gate no longer excludes a mutant that lands inside an f-string's `{...}` field. mutmut 3.8 mutates the code in a field as code (`f"{a(y)}-{y + 1}"` yields `a(None)`, `y - 1`, `y + 2`, and no text mutant at all), but `mutation_diff.string_only_verdict` classified every such diff `string-only` — the gate skipped it, fail-open, on every interpreter, because the hand-rolled `_string_spans` saw the whole literal as text. Fields now read as code (`_fstring_expr_spans`) and such a mutant is REQUIRED; the text between fields and an escaped `{{...}}` stay string-only. `mutation_triage._strip_strings` keeps field code for the same reason, so a field mutant is a "code change" on the work list rather than "string literal only". Closes the "not examined" item #3098 left open: neither tool shares `find_unwired`'s pre-3.12 tokenizer blind spot; they had this interpreter-independent one instead.

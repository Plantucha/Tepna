---
bump: patch
type: fixed
brief: MUTATION-PIPELINE-INTEGRITY-2026-08-24-BRIEF.md
---

`capture-host/tools/mutate_diff.py` — `is_string_only` asked whether the added line **contained** a
quote, which is a different question from whether the **change** was a string literal, and it gave the
wrong answer.

```python
all(("XX" in ln) or ('"' in ln) or ("'" in ln) for ln in added)
```

So any mutation on a line holding **any** string literal — a path segment, a dict key, an f-string —
was silently dropped from the survivor list. Measured on two identical mutations:

```
read_text(encoding="utf-8") → encoding=None
  line 53   data = json.loads(Path(meta_path).read_text(…))        no quote → REPORTED
  line 95   src  = (Path(work) / "mutants" / module).read_text(…)  quote    → SKIPPED
```

Same mutation, opposite handling, decided by the unrelated literal `"mutants"` elsewhere on the line.

🔴 **The consequence was worse than a hidden survivor.** `classify` reads *generated but absent from
survivors* as KILLED — so a ledgered equivalence on such a line came back **REFUTED**, whose
documented remedy is *"the classification is WRONG; fix the entry, never the test."* **The gate was
manufacturing false refutations and instructing the reader to delete a correct classification.** It
was caught one step before that happened on a real PR.

⚠️ **Keying on mutmut's `XX` sentinel alone is the tempting fix and is also wrong** — too narrow.
`"utf-8" → "UTF-8"` is a genuine string-literal mutation carrying no sentinel; XX-only would newly
require **12** mutants on one small module. The changed-token test requires **5**, and those five are
real non-string mutations that were being hidden.

The rule now compares the removed and added lines, takes the span that differs, and asks whether it
sits inside a string literal on both sides. The `XX` sentinel stays conclusive when present.

Nine assertions; four planted defects re-applied and killed — including both the original rule and the
XX-only over-correction, so neither can be reintroduced silently.

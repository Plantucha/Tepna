---
bump: patch
type: fixed
brief: none
---

**Six source-scanning tests bounded a property with a magic byte window; one of them was already
broken and failing OPEN.**

The idiom is `src[i:i + 4000]` — anchor on a marker, slice a fixed number of bytes, assert a
property inside. The window is a *guess* about how long the code is, so the test's verdict depends
on how much unrelated text happens to sit between the anchor and the marker. It fails in **both**
directions:

- a **positive** assert (`X in seg`) reds when the marker drifts past the edge — a false failure
  triggered by adding a comment near the wrong function, with nothing behavioural changed;
- a **negative** assert (`X not in seg`) **passes** when the forbidden text drifts past the edge —
  a false pass, and the guard silently stops guarding.

**One site was already over its edge, in the second direction.** `capture.py`'s `autopull_poller` is
**4907** chars against a **4000**-char window, so the slice had been cutting off its last 907
characters — and that slice carries `assert 'st.get("worn") is True' not in seg`. The guard was
covering 82 % of the code it names. Demonstrated rather than argued: a violation planted at **+4370**
makes the fixed test **FAIL** and the old windowed test **PASS**.

**"Bound it on the function" is the right fix for only half of them, and the other half needed the
opposite.** `run_polar` is **73 771** characters. Replacing a 400-char window there would widen the
assertion **184×** and let it pass on a `note_data(` call anywhere in a 900-line function — the test
would stop being a false failure and become one that *cannot* fail. Those assertions are about
**locality**, so they are bounded on the block or the enclosing suite instead. Three helpers in
`tests/_srcscan.py`, each with a stated meaning:

| helper | bounds | for |
|---|---|---|
| `function_source` | the whole `def`, via `ast` | a claim about the function |
| `block_source` | an anchor that OPENS a block | `if flowed:` → the lines beneath it |
| `suite_tail` | an anchor INSIDE a block → its siblings | a log line followed by the assignment it must accompany |

`function_source` also subsumes an anchor caveat it replaced: it resolves the definition through
`ast`, so it cannot land on an earlier docstring mention of the name.

The three non-Python sites are bounded structurally rather than by count: the shell `trap` is a
single **line**; the monitor's rate-reset run ends at its closing brace (**226** chars, window 400);
the PPI branch is **brace-matched** (**1281** chars, window 1400 — covered today, one edit from being
sliced in half).

**Every fix is negative-controlled.** Six plants, six failures — the property violated, the test red
each time. A test that cannot be seen to fail proves nothing, and that is precisely the defect being
removed here.

Assertions are unchanged throughout; only the bounds moved. `test_clock_resync_on_reconnect.py`'s two
are deliberately untouched — they are fixed in a PR still open, and colliding on them would cost a
rebase for no gain.

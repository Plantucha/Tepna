---
bump: patch
type: fixed
brief: none
---

The Nights page's **"PAT fused" pill now opens the page**, and a click that fails can no longer fail
silently. Owner-reported 2026-09-27: *"when i click on pat fused its not clickable. i thougt ther will
be also fused 3hat and normal 3hat."*

**The click threw, before any of its own error messages.** `nightFilesFor` had explicit branches for
`'3 corner hat'` and `'PAT'` and fell back to `n[node] ? n[node].files : []`. That fallback assumes a
NODE record. A DERIVED tool is `out[tool] = all(_expand(...))` in `nights_index.py` — a **boolean** — so
`n['PAT fused']` was `true`, which satisfied the `?` and yielded `true.files === undefined`. `openNight`'s
first use of it is `if(!rels.length)`, so it raised a TypeError *before* its first toast, inside an async
function the handler neither awaited nor caught: an unhandled rejection, console-only. No tab, no
message, nothing — exactly "not clickable".

It looked fully wired because it nearly was: `NIGHT_APP`, `NIGHT_INPUT` and `NIGHT_RUN` all carried the
id, and the two equalities over `DERIVED` already covered those three maps. The one place that did not
is not a map — it is a function with hard-coded branches, so searching for the id found it present
everywhere a reader would look.

**Three changes, and only the first is a behaviour fix.** (1) A `'PAT fused'` branch handing over the
`_ECG.txt` plus both optical `_PPG.txt` files — the set that page's own classifier requires (it takes one
`#fileInput` and splits by VENDOR, never by column count) — and deliberately not the ACCs or arrival
sidecars, which it never reads and which are the night's largest files. (2) A **label**: the column now
reads `Classic vs fused`, titled *"PAT + 3-corner hat, classic beside fused"*, because the key
`PAT fused` never said the entry also carries the hat, which is what the owner asked for by name while
looking at this table. (3) A **reorder**: both hat σ rows move ahead of the per-leg cards. They already
existed and sat last, so the thing that was asked for was the last thing on the page. No computation
moved in either (2) or (3).

**And the silent failure is fixed as its own defect**, separately from the branch: the handler now wraps
the call so any rejection lands in the toast with its reason. §∅ at the UI — a click that examined nothing
has to say so — and it does not replace `openNight`'s eight named arms, which still report their own cause.

Plants are **executed, not scanned** (the `test_monitor_escaping` idiom: extract the real function from
the shipped file, refuse if extraction found nothing, run it under node). The population is an EQUALITY
over `nights_index.DERIVED`: every derived tool must resolve to a non-empty file list on a night meeting
its own requirements, driven through the real `night_entry`, with each derived value asserted to be a
`bool` so the shape that makes the fallback unsafe is pinned rather than described. Anti-vacuity: delete
the ring's RAW pleth and `PAT fused` must go False while `PAT` and `3 corner hat` stay True — the exact
distinction `nights_index` states. Both plants FAIL on `origin/main`
(`('PAT fused', 'NOT-AN-ARRAY:undefined', …)` and *"a throwing click produced NO toast"*).

⚠️ The monitor is served from the capture box, so the pill fix is **inert until the box is updated**; a
deploy is owner-authorized and is not part of this change.

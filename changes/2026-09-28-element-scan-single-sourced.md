---
bump: patch
type: fixed
brief: none
---

One index scan answers *where does an HTML element end*. The parse census added in #3209 carried its
own regex; `tools/strip-markup.mjs` already existed for exactly this problem and its header already
said why a regex is the wrong instrument — *"three regex attempts shipped here, each missing a
DIFFERENT legal spelling of the end tag … that is the tell that the TOOL was wrong rather than the
pattern — a third variant would have been a third patch."* The census was the third variant. It now
calls `elementBlocks`, which is that module's scan extended to hand back the OPEN tag's attributes —
the part `stripElement` discards and the part the census needs to read `data-inline-src` and `type`.

**And the module was not applying its own rule at the closing end.** It already guarded `<scriptable>`
where an element opens, but the close search took the first `</script` it found regardless of what
followed, so a body containing the literal text `</scriptable>` ENDED the element. `stripElement`'s two
callers — `doc-search` and `guide-anchor-audit` — silently lost every bit of prose after such a body.
`nameEnds` is now shared by both ends, which is why this is one function and not two copies.

The gate drives the shared scan over six end-tag spellings (`</script>` · `</script >` ·
`</script\t\n bar>` · `</script/>` · `</script foo="bar">` · `</SCRIPT>`) and both directions of the
name rule, because a shared scan the consumer never exercises is a shared assumption.
`strip-markup --selftest` 12 → 27 legs; the census group 12 → 15; the census reading is unchanged at
481 blocks and 33.6 MB, which is the point — this replaces the instrument, not the measurement.

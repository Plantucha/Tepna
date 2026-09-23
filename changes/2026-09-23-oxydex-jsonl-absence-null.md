---
bump: patch
type: fixed
brief: none
---
OxyDex's JSONL re-load path synthesised absent analysis blocks instead of leaving them null, which DEFEATED consumer guards that were already correct. `odi4: obj.odi4 || { rate: 0, count: 0 }` made every `if (n.odi4)` true, so a night carrying no ODI-4 at all rendered **ODI-4 Rate 0/hr graded good** — in-band, flattering, and indistinguishable from a genuinely excellent night. The six HRV proxies had the same shape: `hrFloor || 0` reached `oxydex-fusion.js`, which guards `!= null` and then grades against 55/62, so an unmeasured floor rendered as a GOOD resting floor. All eight now use `!= null`, never `||` — a genuine 0 must survive, and 0 is precisely the value `||` cannot tell from absence.

This FINISHES a pass already begun in the same function: `stats` (twelve fields) and `hrv.hrSdnn` were fixed earlier with their own §∅ comments, and these blocks were the ones that pass did not reach.

One consumer needed guarding, and only one: `null < 0.2` is TRUE, so an absent pNN3 would have raised `HRV_LOW_pNN3(null%)`. Its two siblings are safe only by luck of direction (`null > 1.5` and `null > 65` are both false). The HRV CSV block now writes an EMPTY cell rather than the text `null` — `hrSdnn` could already be null there and would have written `null` into a spreadsheet.

⚠️ Two test assertions stated the violation AS THE SPEC and were corrected deliberately: `…odi4 falls back to a zero rate` sat one line below `…every optional block is null, not an empty object`, in a group named *"tells ABSENT from ZERO"*, under a comment describing each block as `obj.X ? {…} : null`.

No measurement VALUE moved — the four goldens show only `code.manifestHash`/`code.computeHash` changing — and all three corpus-backed fixtures were re-verified and re-stamped.

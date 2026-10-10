---
bump: patch
type: fixed
brief: none
---

Gap uncertainty and safeguard quality (2026-10-08):

1. OxyDex: Added `hasGap` boolean to desaturation events — explicit when
   an event spans unobserved samples. Backward-compatible (new field).
   `missingSec` was already published but never consumed; `hasGap` makes
   the uncertainty impossible to miss. All downstream consumers verified
   to use `durationSec` (measured), not span reconstruction.

2. OxyDex: Comprehensive gap semantics test matrix — complete observations,
   internal gaps, leading/trailing gaps, boundary gaps, and threshold-changing
   gaps (7s measured vs 10s minSec rejected; 10s measured accepted).

3. XSS gate: Improved from same-line regex to RHS analysis — strips
   escapeHTML()/esc() calls and string literals, flags remaining identifiers.
   `el.innerHTML = userInput + escapeHTML(otherValue)` now correctly FAILS.
   Documented as heuristic, not comprehensive.

4. Mutation testing: Verified each test catches its defect —
   - Raw-span eligibility restored → event incorrectly accepted (caught)
   - evMissing++ removed → duration inflated 16→21 (caught)
   - Old XSS regex restored → false pass on mixed assignment (caught)

5. Mutation gate (diff-scoped) on the capture-host change: the 7 surviving
   mutants in `storage_targets.dest_status` are now accounted for — 4 killed
   by new assertions (explicit kind wins over protocol default; unknown
   protocol falls back to the transfer kind; the local-branch not-exists
   reason names the actual path), 3 recorded as equivalent in
   `tools/mutate-equivalence.json` with empirical probes (two
   `target.get("protocol", …)` default variants indistinguishable because
   neither "" nor None is a PROTOCOLS key; the `'(unset)'` literal is
   unreachable by construction). Gate verdict: PASS (98 generated, 98
   decided, 0 unclassified survivors).

---
bump: patch
type: fixed
nodes: [OxyDex]
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

`OxyDex Reference.html` cited three published papers as sources for a metric the app does not compute.

BP Projection was removed on 2026-06-23 (oxydex-registry.js:195, external-review WP-A — cuffless BP
from oximetry/HRV is indefensible). The removal reached one table and not the other five places, so the
guide said the metric was gone in its validation matrix while its citations table still sourced it to
Nieto 2000, Kim/Azarbarzin 2020 and Palatini 2009, a live metric card described a paper as
"underpinning BP Projection", and the clinical-equivalence list still carried a caveat about it.

Worst of the six was the Nieto card, which published the projection's internal calibration coefficients
(ODI-4 → +0.37 mmHg SBP / +0.17 mmHg DBP per event·hr) — app-internal numbers for a computation that no
longer exists. Azarbarzin and Palatini are legitimately cited elsewhere in the guide (hypoxic burden;
Mean/Resting HR), so only their BP rows went; Nieto's only stated purpose here was BP Projection, so its
card was restated rather than deleted — the SDB→hypertension association is why an ODI matters
clinically, and the card now says plainly that no metric is derived from it. The validation matrix's
REMOVED row is kept: that one is the honest record. Seven mentions down to two, both honest.

No existing gate could have caught this: `cohesion-badges` checks grades for cards the node's own
resolver maps, and a citation row for a deleted metric is mapped by nothing. The class is documentation
outliving the code it documents, and it is silent by construction.

Also closes the audit's scroll-spy item. The nav-highlight IntersectionObserver is now proven on all
seven guides — 111/111 testable sections follow the scroll, no multi-highlight, no page errors — and the
probe was shown to fail first: neutering window.scrollTo puts every guide at followed=0, so the pass
measures scroll-dependent state rather than passing by construction.

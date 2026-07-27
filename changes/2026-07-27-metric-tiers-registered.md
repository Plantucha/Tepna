<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex, ECGDex]
brief: DEEP-AUDIT-III-2026-07-26-BRIEF.md
---
Ten surfaced OxyDex numbers had no registry entry at all, and `badgeForLabel(label, true)` minted an `experimental` disc for each — so they rendered fully badged while being ungraded, which is how the coverage mandate could read green over ungraded numbers. Each now has a real entry with a stated tier and cite: MOS, AAI and WtDSI heuristic; Δ-Index and PB Episodes emerging (both have literature behind the method, so an upgrade to validated is possible later but requires the exact citation checked against what the code computes); oscillation index, Episode range, Periodicity pattern, pNN3 and SFI experimental as internal composites or detector-derived descriptors. MOS is deliberately not validated: it implements the published McGill criteria but applies them outside their validated paediatric population, and the reference guide already required it be distinguished from the paediatric score. ECGDex's ectopy chart card had the opposite defect — it badged experimental while the registry grades the metric measured — and is fixed with an alias so the card inherits the graded tier by construction rather than minting its own. The `cohesion-badges` doc-parity leg then caught that the OxyDex Reference guide had already graded MOS, AAI and WtDSI heuristic; that call predates these entries and is the more conservative one, so the registry adopted it rather than upgrading three published grades on a new author's say-so.

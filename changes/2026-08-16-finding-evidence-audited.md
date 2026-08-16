---
bump: patch
type: changed
brief: AUDIT-FOLLOWUPS-BRIEF.md
---

Audits the ten `FINDING_EVIDENCE` grades §4.4 has been waiting on, so ratification is a one-word answer
rather than a research task. All ten are defensible as they stand.

The owner directed this fold into the OxyDex tier batch, and it differs from that batch in kind. Those 68
labels carried no grade and needed one assigned; these ten already carry grades with citations, so the
work was to audit rather than to write. Assigning fresh tiers over existing reasoned ones would have been
the more dangerous act — the same reason the 68 were not auto-filled in the first place.

Highlights of the audit. `device_ahi` at validated is the device's own firmware scoring used as the
clinical reference, independently corroborated by CPAPDex matching `STR.edf` to 0.05/h. `auto_glycemic`
at heuristic is if anything generous, since `dead-ends.html` records the glucose-HRV coupling collapsing
to +0.01 once a shared apnea driver is partialled out. The best-reasoned entry is `staging_disagreement`,
whose tier is explicitly inherited rather than assigned, on the argument that a disagreement between two
heuristic estimators cannot be stronger evidence than its own inputs — which is the correct shape and
worth keeping as precedent.

One citation is worth tightening and is deliberately not treated as blocking. `confirmed_apnea` cites
"AASM ODI framing; Azarbarzin 2019", while `oxydex-registry.js` explicitly distances its own hypoxic
burden from that paper as event/baseline-referenced. Azarbarzin 2019 concerns the hypoxic-burden metric
rather than desaturation-to-surge corroboration, so the reference is loose for the claim it is attached
to. It is not fabricated authority, because the grade is emerging rather than validated: the citation is
decorative here, not load-bearing, and the rule bites only when a citation carries an upgrade. Worth a
rewording on the next touch of that file, not worth a re-bundle on its own.

Docs only.

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: DEX-CITATION-FORMULA-AUDIT-BRIEF.md
---
`DEX-CITATION-FORMULA-AUDIT` had stopped on one blocker: *"§1/§2 citation verification needs NETWORK, which this suite forbids by construction."* **That reading was too broad.** What is forbidden — and gate-backed by `no-network.html` — is a **bundle** reaching the network. `LITERATURE-USE-POLICY` describes the opposite motion as the normal one: a literature value is *"inlined into source at author time as a cited constant"*, which presumes the author checked it. So all 86 DOIs in the repo were resolved against Crossref at author time and the result committed offline.

**86 of 86 resolve** — zero fabricated, zero dead. On its own that would have been a misleading reassurance, because **all three real errors resolve too.** A dead link announces itself; a *wrong* DOI renders as a working link and survives every offline check the repo can perform.

- `OxyDex Reference.html` cited Garg 2014 (*J Clin Sleep Med* 10(8):879–885) as `10.5664/jcsm.3966` — one digit off `…3960`, landing on **Katz et al., drug testing in children during MSLT**.
- `OxyDex Reference.html` fused two papers: Pépin's authors and title with **Folmer's** journal, volume, article number and DOI. Corrected to `10.1111/resp.13669`, *Respirology* 2020;25(5):486–494.
- `papers/effort-typing-null.html` cited Pillar 2020 as `10.1007/s11325-019-01922-3`, which is **Lu et al.** Corrected to `…01904-5`, *Sleep Breath* 24(1):387–398.

Replacement DOIs were resolved and their volume/pages taken from Crossref rather than retyped.

Also recorded is what is **not** a finding, so the next pass does not re-open it: `10.1161/01.CIR.93.5.1043` reads as an author mismatch in three guides only because Crossref stores the corporate *"Task Force of the ESC and NASPE"*; and **zero** year mismatches survive once online-first is accounted for (Crossref's `issued` runs up to a year before the issue year a citation quotes). A checker that flags those produces noise that buries results like the three above.

Three further defects are real but need a `*-dsp.js` edit — two wrong author lists in `integrator-dsp.js`, and a DOI cited with no attribution across 13 sites — so they carry a re-bundle **and** fixture re-verification and are routed to `CITATION-ATTRIBUTION-FOLLOWUPS-2026-08-05-BRIEF.md` rather than bolted onto a docs-only change.

Parent brief stamped **DONE**. Evidence + an 86-DOI ledger in `audits/CITATION-VERIFICATION-2026-08-05.{md,json}`. Authored guides only — no `manifestHash` movement (`build.mjs --check` clean, 11 owned), no fixture re-recorded.

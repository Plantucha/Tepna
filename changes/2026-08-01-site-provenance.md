<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [PpgDex]
brief: none
---
`recording.siteSource` now says whether the optical site was **observed or assumed**.

`site` is decided on the data — a one-channel replicated stream is an O2Ring, three LEDs is a Verity — and that identifies the **device** reliably. It was then spent as an **anatomical** fact: it selects the morphology evidence tier (dicrotic notch, augmentation index, reflection index, Takazawa b/a — every one site-sensitive and graded against *wrist-validated* literature) and gates three Integrator fusion paths.

A strap goes where the wearer puts it. On this deployment the **Verity is worn on the left ankle** and has been labelled `'wrist'` throughout — a site far further from the heart with an entirely different reflection profile. That is a metric holding a grade it never earned, which is exactly what the evidence ladder exists to prevent.

The limb cannot be recovered from a waveform, so it is **not guessed**. `site` keeps its derived value (consumers gate on it, and the O2Ring sentinel pass genuinely is a device property); `siteSource: 'device-default'` marks it as an inference, so a grader can decline to award a site-validated tier on the strength of a device default.

Moves four PpgDex fixtures — regenerated with `tools/regen-ppgdex-goldens.mjs`, never hand-edited.

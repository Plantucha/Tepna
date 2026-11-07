---
bump: patch
type: fixed
brief: none
---

Three suite groups now record a declared skip when their input is absent. Before, each recorded a literal-true pass, and the skip allow-list never saw it. The CI selftest step now counts a tool that examined 0 legs as a skip, with a ceiling of 2. The findings come from Muse's hunt, board #4269.

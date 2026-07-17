<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md
---
Add a known-answer gate for the cohort-regression OLS kernel — exposes window.CohortRegression.olsR2 (+ a DOM guard so the page loads headless) and pins R² against closed-form values; the analysis page's stats had zero coverage.

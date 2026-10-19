---
bump: patch
type: fixed
brief: none
---

The test suite page now escapes each group title, test name and detail before it writes them into the page. Before the fix, an unclosed `<script …>` tag inside one detail made the browser read every later row as script text. The page showed 4633 of 13198 rows, so the browser gate counted a failure and could not name it. The gate now also compares the rendered rows with the in-memory count and fails when they differ.

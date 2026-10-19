---
name: "Productive Code"
description: "Use when implementing features, fixes, or other requested changes in production code. May edit production files, must not edit tests, and uses fnm for any Node.js work."
---

Implement the user's requested changes in production code in this repository.

## Boundaries

- You may read and modify production source code and the configuration or documentation directly needed for the requested change.
- Do not create, modify, or delete test files, test fixtures, mocks, snapshots, or test-runner configuration. You may run existing tests to verify production changes.
- Keep changes focused on the request; preserve unrelated work in the worktree.
- If the request cannot be completed without changing a test-related file, explain the constraint and ask the user before proceeding.

## Node.js

- Whenever a task requires Node.js or a Node-based tool, use `fnm` to select and activate the project's required Node version before running it. Follow the repository's version file or package engine requirement when present.
- In PowerShell, initialize `fnm` with `fnm env --use-on-cd | Out-String | Invoke-Expression`, then run `fnm use` for the required version.
- Do not use Node.js or Node-based tools until `fnm` has successfully selected the version.
- If `fnm` is unavailable or cannot select the required version, stop before running Node-based commands and report the blocker; do not fall back to another Node version manager or a system Node installation.

## Workflow

1. Inspect the relevant production code and repository conventions before editing.
2. Make the smallest complete change that fulfills the request.
3. Run relevant non-test checks, and existing tests when useful, without editing test files.
4. Summarize the changes and report the checks run and any blockers.

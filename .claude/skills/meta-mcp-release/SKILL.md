---
name: meta-mcp-release
allowed-tools: Bash(git:*), Bash(gh:*), Bash(npm:*), Bash(npx:*), Read, Edit, Grep, Glob, TaskCreate, TaskUpdate, TaskGet, TaskList
description: Release a new version of meta-mcp — validates changelog, bumps version everywhere, builds, tests, commits, and pushes to main to trigger the CI release workflow that creates a GitHub Release and publishes to npm. Use this skill whenever the user wants to release, publish, ship, or tag a new version, or says things like "release 3.2.0", "cut a release", "bump to 3.3.0", "publish new version", "ship it", "let's release", "version bump", "prepare a release", "we have enough changes for a release". Also triggers when the user provides just a version number in a release context.
---

# Release meta-mcp

You are releasing version **$ARGUMENTS** of meta-mcp.

If no version is provided, ask the user for the target version number (semver: `X.Y.Z`).

This workflow works best with extended thinking enabled — version bump validation benefits from careful checking.

## Step 1: Validate Prerequisites

Create tasks to track progress. Run these checks first — if any fail, stop and explain what's wrong.

1. **Branch check** — must be on `main`:
   ```bash
   git branch --show-current
   ```

2. **Clean working tree** — no uncommitted changes:
   ```bash
   git status --porcelain
   ```

3. **Synced with remote** — fetch and check:
   ```bash
   git fetch origin main
   git rev-list --left-right --count origin/main...HEAD
   ```
   Left > 0 means behind remote, right > 0 means ahead. Both should be 0.

4. **Tag doesn't exist yet**:
   ```bash
   git tag -l "v$VERSION"
   gh release view "v$VERSION" 2>&1
   ```

## Step 2: Validate and Update CHANGELOG.md

1. Read `CHANGELOG.md` and find the `[Unreleased]` section.
2. It must have content under `### Fixed`, `### Changed`, or `### Added` — reject if empty.
3. Show the user the unreleased changes and ask for confirmation before proceeding.
4. Add a new empty `## [Unreleased]` section at the top.
5. Rename the old `[Unreleased]` content to `## [X.Y.Z] — YYYY-MM-DD` (today's date).

## Step 3: Bump Version Everywhere

First, determine the current version from `package.json`. Then search for ALL occurrences using the Grep tool:

```
pattern: "CURRENT_VERSION"  (the literal current version string)
glob: "*.{json,ts,md,txt}"
exclude: node_modules/, dist/, package-lock.json
```

Files that typically need version bumps:

| File | Location |
|------|----------|
| `package.json` | `"version": "X.Y.Z"` |
| `src/index.ts` | `SERVER_VERSION = "X.Y.Z"` |
| `server.json` | `"version": "X.Y.Z"` (appears twice) |

After finding all occurrences, update each one. **Do not touch version references inside `node_modules/`, `dist/`, or `package-lock.json`** — the lock file will be regenerated.

New files referencing the version may have been added since this skill was written — the Grep search catches those too.

## Step 4: Regenerate package-lock.json

```bash
npm install --package-lock-only
```

Verify the version updated in the lock file using the Grep tool:

```
pattern: "version": "X.Y.Z"
path: package-lock.json
output_mode: content
head_limit: 2
```

## Step 5: Build and Test

```bash
npm run build
npm test
```

Both must pass. If tests fail, fix them before proceeding.

## Step 6: Commit and Push

1. **Stage specific files** — list all changed files explicitly (never `git add .`).
2. **Commit**:
   ```
   chore: release vX.Y.Z
   ```
3. **Ask the user before pushing**: show the diff summary (`git log --oneline origin/main..HEAD`) and ask **"Ready to push to main and trigger the release? This will publish vX.Y.Z to npm."** Only push after explicit confirmation.
4. **Push to main**:
   ```bash
   git push
   ```

## Step 7: Verify Release Workflow

After pushing, check that the release workflow started:

```bash
gh run list --workflow=release.yml --limit 1 --json databaseId,status,conclusion
```

Print a summary:
- Version: `vX.Y.Z`
- Changelog highlights (first 5 lines of the version entry)
- Release workflow status
- Reminder: the workflow creates a GitHub Release and publishes to npm automatically.

## Troubleshooting: Failed Release

If the release workflow fails (e.g., npm publish error, CI regression):

1. **Check the failure**: `gh run view <run-id> --log-failed`
2. **If the fix is in the workflow itself** (not the code):
   - Fix the workflow file, commit, and push to main.
   - The GitHub Release and tag may already exist from the failed run. If so:
     ```bash
     gh release delete "vX.Y.Z" --yes --cleanup-tag
     ```
   - Push an empty commit to retrigger: `git commit --allow-empty -m "chore: retrigger release vX.Y.Z"` then `git push`.
3. **If the fix is in the code**: the version is already bumped, so just fix the code, commit, push. The workflow will pick up the existing version.

## Important Rules

- **Be interactive** — whenever a decision, confirmation, or user reaction is needed, ask a direct question and wait for a response. Don't silently proceed or assume the answer.
- **Never push without user confirmation** — always ask explicitly before pushing.
- **Never skip build + test** — both must pass before committing.
- **Always search for version references** — new files may have been added since this skill was written.
- **Never modify files you haven't read** in the current session.
- **If any validation fails, stop immediately** and explain what needs to be fixed.
- **The `package-lock.json` must be regenerated** — never manually edit it.

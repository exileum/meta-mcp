---
name: meta-mcp-fix-issue
allowed-tools: Bash(git:*), Bash(gh:*), Bash(npm:*), Bash(npx:*), Read, Write, Edit, Grep, Glob, WebFetch, WebSearch, Agent, EnterPlanMode, ExitPlanMode, AskUserQuestion, TaskCreate, TaskUpdate, TaskGet, TaskList
description: End-to-end workflow to fix one or more GitHub issues — fetches the issue(s), creates a feature branch, enters plan mode for interactive implementation planning, applies the fix with tests, updates all docs (README, CHANGELOG, llms.txt, server.json), creates a detailed PR, and addresses review bot feedback. Supports multiple issue numbers for batching small fixes into a single combined PR. Use this skill whenever the user mentions a GitHub issue number or URL, wants to fix a bug, implement a feature from an issue, investigate a reported problem, or says things like "fix issue 19", "work on #42", "let's tackle this issue", "look at issue 15", "fix 140 146 150", "implement what's described in github.com/.../issues/7", "investigate this bug report". Also triggers for partial references like "fix #19" or just a bare issue number when the context is clearly about fixing something.
---

# Fix GitHub Issue(s)

You are fixing GitHub issue(s) **$ARGUMENTS** in the meta-mcp project.

**Parse the arguments:** split `$ARGUMENTS` by spaces, commas, or other separators. Each token may be a bare number (`42`), a hash-prefixed number (`#42`), or a full GitHub issue URL. Extract all issue numbers into a list. If no argument is provided, ask the user for the issue number(s).

**Single vs. multi-issue mode:** if there is only one issue, follow the standard single-issue flow below. If there are multiple issues, follow the multi-issue adaptations noted in each step — all issues are fixed together in **one branch, one combined PR**.

This workflow works best with extended thinking enabled — complex issues benefit from deep reasoning about root causes and fix strategies.

## Step 1: Gather Context

Create tasks to track progress throughout this workflow.

1. **Switch to main and update** — always start from the latest main:
   ```bash
   git checkout main
   git pull
   ```
2. **Fetch the issue(s)** via `gh issue view <number> --json title,body,labels,state,milestone` — run for **each** issue number.
3. **Read all issues carefully** — understand each problem, affected files, severity, and any proposed solutions. In multi-issue mode, note overlaps and shared affected areas.
4. **Check if already fixed** — for **each** issue, before exploring code, read `CHANGELOG.md` (especially the `[Unreleased]` section and recent releases) and search for references to the issue number (`#<number>`) or related keywords. When working through a large backlog of issues, earlier fixes may have already resolved or partially addressed some issues. If an issue is already fixed, drop it from the list and inform the user. If ALL issues are already fixed, close the workflow early.
5. **Explore the codebase** — read the files mentioned across all issues. Use the Grep and Glob tools (not bash grep/find) to search efficiently.
6. **Verify with official documentation** — if any issue references or implies external APIs, specs, or platform behavior (e.g., anything about Instagram API, Threads API, Meta Graph API), proactively look up the official documentation using `WebSearch` / `WebFetch`. Don't wait for the issue to provide links — if the fix touches API endpoints, parameters, or platform-specific behavior, always verify against the source of truth.
7. **Check compatibility** (multi-issue only) — if two issues propose conflicting changes to the same code, flag this to the user via `AskUserQuestion` and suggest splitting them into separate PRs.
8. **Summarize findings** to the user: for each issue — what's broken, what the fix should look like, and what files need changes. In multi-issue mode, highlight shared files and any interactions between fixes.

## Step 2: Create Feature Branch

**Single issue:**
```bash
git checkout -b <prefix>/<short-description>-<issue-number>
```

**Multiple issues:** use a combined description and list all issue numbers:
```bash
git checkout -b <prefix>/<shared-description>-<N>-<M>-<K>
```
For example: `fix/threads-api-cleanup-140-146-150`. If there are more than 4 issues, use just the first and last number with a count: `fix/api-fixes-140-to-155` to keep the branch name readable.

Choose the branch prefix based on the dominant issue type:
- `fix/` — bug fixes (e.g., `fix/token-endpoints-19`)
- `feat/` — new features (e.g., `feat/threads-polls-25`)
- `refactor/` — refactoring (e.g., `refactor/client-cleanup-30`)
- `docs/` — documentation-only changes
- `chore/` — maintenance, dependencies, CI

## Step 3: Plan Implementation (Interactive)

**Enter plan mode** and actively engage the user:

- In multi-issue mode, present a **unified plan** covering all issues — group related changes, note shared files, and order the work logically.
- Present your proposed implementation plan with specific file changes.
- Use `AskUserQuestion` for anything ambiguous — don't assume.
- Propose alternatives where trade-offs exist (e.g., new tools vs. adding a parameter to existing tools).
- If refactoring would improve the fix area, use `AskUserQuestion` to ask whether to include it in scope or keep it separate.
- Call out breaking changes explicitly and use `AskUserQuestion` to get user confirmation before proceeding.
- Discuss test strategy — what to test, edge cases.
- Only exit plan mode once the user approves the plan.

## Step 4: Implement the Fix

Follow the approved plan. In multi-issue mode, implement fixes one issue at a time (in the order agreed during planning) so each change is logically grouped and easier to debug if something breaks.

For each change:

1. **Read the file first** before editing — never edit blind.
2. **Make the minimal change** that fixes the issue — no drive-by refactors.
3. **Run build after code changes** — `npm run build` must pass.
4. **Run tests** — `npm test` must pass. If the changed code has no test coverage, write tests for it — don't limit testing to just the new behavior. If a test framework isn't set up yet, add one (vitest).
5. **Update tasks** as you complete each piece of work.

## Step 5: Update Documentation

Search for ALL places that reference the changed functionality using the Grep tool — don't rely on memory:

```
# Use Grep tool to search across file types for references to changed APIs, tool names, endpoints
pattern: "old_api_name|old_endpoint|changed_thing"
glob: "*.{md,txt,json,ts}"
```

Update these files as needed:

- **CHANGELOG.md** — add entries under `[Unreleased]`. Only include user-facing changes (no CI-only changes). Use existing format: `### Fixed`, `### Changed`, `### Added`. In multi-issue mode, add a separate entry for each issue's changes.
- **README.md** — update tool descriptions, setup guides, examples if affected.
- **llms.txt** — update tool descriptions if tool signatures changed.
- **server.json** — update if version or tool metadata changed.
- **src/index.ts** — if `SERVER_VERSION` needs updating.

## Step 6: Final Verification

1. `npm run build` — must compile cleanly with no test artifacts in `dist/`.
2. `npm test` — all tests must pass.
3. Use Grep to search for any remaining references to the old/broken behavior.
4. Review your own diff: `git diff` — check for anything you missed.

## Step 6.5: Manual MCP Testing (when applicable)

If the fix touches MCP tool handlers (especially Threads or Instagram publishing tools), verify the fix works end-to-end with a real MCP connection:

1. Build the local server: `npm run build`.
2. Use `AskUserQuestion` to ask the user: **"The fix changes MCP tool behavior. Want to run a live test? I can publish a test post with the fixed parameter and then delete it. This requires a connected MCP server with valid tokens."**
3. If yes:
   - Start the local MCP server or use the already-connected one.
   - Use the affected MCP tool to create a test post exercising the fixed behavior (e.g., publish a text post with `topic_tag`).
   - Verify the fix worked (e.g., check the returned data, fetch the post).
   - Delete the test post to clean up.
4. If no or MCP not connected — skip, but note in the PR description that manual end-to-end testing was not performed.

## Step 7: Commit and Create PR

1. **Stage specific files** — never `git add .` or `git add -A`.
2. **Commit** with a descriptive message referencing the issue(s). Use the conventional commit prefix matching the branch type:

   **Single issue:**
   ```
   <type>: <concise description> (#<issue-number>)

   <explain what was broken and why>
   <explain what the fix does>
   ```

   **Multiple issues:**
   ```
   <type>: <concise combined description> (#<N>, #<M>, #<K>)

   Issue #<N>: <what was broken and what the fix does>
   Issue #<M>: <what was broken and what the fix does>
   Issue #<K>: <what was broken and what the fix does>
   ```

   Where `<type>` matches the branch prefix: `fix`, `feat`, `refactor`, `docs`, `chore`.
3. **Push** the feature branch.
4. **Create PR** with `gh pr create`:
   - Detailed body with Summary, What was broken, What this PR does, Breaking changes, Files changed, Test plan sections.
   - In multi-issue mode, the Summary should list each issue with a one-line description of the fix. Include a `Fixes #<N>` line for **each** issue, **each on its own line** — GitHub only auto-closes issues when `Fixes #N` appears as a separate line or sentence.
   - Copy labels and milestone from the original issue(s) using `gh pr edit`. In multi-issue mode, merge labels from all issues.
   - **Always assign the PR to the current user**: `gh pr edit <number> --add-assignee @me`.

## Step 8: Address Review Bot Feedback

After the PR is created, review bots (CodeRabbit, Greptile, etc.) typically need a minute or two to post their comments. Use `AskUserQuestion` to ask: **"PR created. Review bots usually take 1-2 minutes. Want me to check for bot comments now, wait a minute, or skip?"** — wait for the user's response before proceeding.

When checking:

1. **Fetch all review comments**: `gh api repos/{owner}/{repo}/pulls/{number}/comments --jq '.[].body'` and `gh pr view {number} --json reviews --jq '.reviews[].body'`.
2. **Evaluate each comment** — not all bot suggestions are valid. Present your assessment to the user:
   - **Valid and actionable** — fix it.
   - **Valid but cosmetic/nitpick** — fix it if low effort.
   - **Invalid or not applicable** — skip it, explain why.
3. Use `AskUserQuestion` to ask which fixes to apply — wait for the user's response before proceeding.
4. **Apply approved fixes**, run build + tests again, commit and push.
5. **If creating follow-up issues** (e.g., refactoring suggestions from bots that are out of scope), always add appropriate labels, milestone (matching the original issue's milestone when relevant), and assign to `@me` using `gh issue edit`.

## Important Rules

- **Be interactive** — whenever a decision, confirmation, or user reaction is needed, use `AskUserQuestion` to ask and wait for a response. Never output a question as plain text — always use the tool so the workflow pauses until the user replies.
- **Never skip plan mode** — always get user approval before implementing.
- **Never commit without running build + tests** first.
- **Never modify files you haven't read** in the current session.
- **Always search for ALL references** before updating docs — don't assume you know every place.
- **Breaking changes require explicit user confirmation** before proceeding.
- **Keep the user informed** — update tasks, report progress at milestones.

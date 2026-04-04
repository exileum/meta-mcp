---
name: meta-mcp-fix-issue
allowed-tools: Bash(git:*), Bash(gh:*), Bash(npm:*), Bash(npx:*), Read, Write, Edit, Grep, Glob, WebFetch, WebSearch, Agent, EnterPlanMode, ExitPlanMode, AskUserQuestion, TaskCreate, TaskUpdate, TaskGet, TaskList
description: End-to-end workflow to fix a GitHub issue — fetches the issue, creates a feature branch, enters plan mode for interactive implementation planning, applies the fix with tests, updates all docs (README, CHANGELOG, llms.txt, server.json), creates a detailed PR, and addresses review bot feedback. Use this skill whenever the user mentions a GitHub issue number or URL, wants to fix a bug, implement a feature from an issue, investigate a reported problem, or says things like "fix issue 19", "work on #42", "let's tackle this issue", "look at issue 15", "implement what's described in github.com/.../issues/7", "investigate this bug report". Also triggers for partial references like "fix #19" or just a bare issue number when the context is clearly about fixing something.
---

# Fix GitHub Issue

You are fixing GitHub issue **$ARGUMENTS** in the meta-mcp project.

If the argument is a URL, extract the issue number. If no argument is provided, ask the user for the issue number.

This workflow works best with extended thinking enabled — complex issues benefit from deep reasoning about root causes and fix strategies.

## Step 1: Gather Context

Create tasks to track progress throughout this workflow.

1. **Fetch the issue** via `gh issue view <number> --json title,body,labels,state,milestone`.
2. **Read the issue carefully** — understand the problem, affected files, severity, and any proposed solutions.
3. **Explore the codebase** — read the files mentioned in the issue. Use the Grep and Glob tools (not bash grep/find) to search efficiently.
4. **Verify with official documentation** — if the issue references or implies external APIs, specs, or platform behavior (e.g., anything about Instagram API, Threads API, Meta Graph API), proactively look up the official documentation using `WebSearch` / `WebFetch`. Don't wait for the issue to provide links — if the fix touches API endpoints, parameters, or platform-specific behavior, always verify against the source of truth.
5. **Summarize findings** to the user: what's broken, what the fix should look like, and what files need changes.

## Step 2: Create Feature Branch

```bash
git checkout main
git pull
git checkout -b <prefix>/<short-description>-<issue-number>
```

Choose the branch prefix based on the issue type:
- `fix/` — bug fixes (e.g., `fix/token-endpoints-19`)
- `feat/` — new features (e.g., `feat/threads-polls-25`)
- `refactor/` — refactoring (e.g., `refactor/client-cleanup-30`)
- `docs/` — documentation-only changes
- `chore/` — maintenance, dependencies, CI

## Step 3: Plan Implementation (Interactive)

**Enter plan mode** and actively engage the user:

- Present your proposed implementation plan with specific file changes.
- Use `AskUserQuestion` for anything ambiguous — don't assume.
- Propose alternatives where trade-offs exist (e.g., new tools vs. adding a parameter to existing tools).
- If refactoring would improve the fix area, use `AskUserQuestion` to ask whether to include it in scope or keep it separate.
- Call out breaking changes explicitly and use `AskUserQuestion` to get user confirmation before proceeding.
- Discuss test strategy — what to test, edge cases.
- Only exit plan mode once the user approves the plan.

## Step 4: Implement the Fix

Follow the approved plan. For each change:

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

- **CHANGELOG.md** — add entries under `[Unreleased]`. Only include user-facing changes (no CI-only changes). Use existing format: `### Fixed`, `### Changed`, `### Added`.
- **README.md** — update tool descriptions, setup guides, examples if affected.
- **llms.txt** — update tool descriptions if tool signatures changed.
- **server.json** — update if version or tool metadata changed.
- **src/index.ts** — if `SERVER_VERSION` needs updating.

## Step 6: Final Verification

1. `npm run build` — must compile cleanly with no test artifacts in `dist/`.
2. `npm test` — all tests must pass.
3. Use Grep to search for any remaining references to the old/broken behavior.
4. Review your own diff: `git diff` — check for anything you missed.

## Step 7: Commit and Create PR

1. **Stage specific files** — never `git add .` or `git add -A`.
2. **Commit** with a descriptive message referencing the issue. Use the conventional commit prefix matching the branch type:
   ```
   <type>: <concise description> (#<issue-number>)

   <explain what was broken and why>
   <explain what the fix does>
   ```
   Where `<type>` matches the branch prefix: `fix`, `feat`, `refactor`, `docs`, `chore`.
3. **Push** the feature branch.
4. **Create PR** with `gh pr create`:
   - Detailed body with Summary, What was broken, What this PR does, Breaking changes, Files changed, Test plan sections.
   - Copy labels, milestone, and assignee from the original issue using `gh pr edit`.
   - Reference the issue with `Fixes #<number>`.

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

## Important Rules

- **Be interactive** — whenever a decision, confirmation, or user reaction is needed, use `AskUserQuestion` to ask and wait for a response. Never output a question as plain text — always use the tool so the workflow pauses until the user replies.
- **Never skip plan mode** — always get user approval before implementing.
- **Never commit without running build + tests** first.
- **Never modify files you haven't read** in the current session.
- **Always search for ALL references** before updating docs — don't assume you know every place.
- **Breaking changes require explicit user confirmation** before proceeding.
- **Keep the user informed** — update tasks, report progress at milestones.

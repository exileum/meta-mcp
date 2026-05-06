# Contributing to meta-mcp

Thanks for your interest in improving meta-mcp. This project wraps the [Meta Graph API](https://developers.facebook.com/docs/graph-api/) (Instagram + Threads + token / webhook tooling) as a [Model Context Protocol](https://modelcontextprotocol.io) server, so contributions usually fall into one of:

- a bug fix in an existing tool, resource, or prompt;
- a new tool that exposes an additional Meta API endpoint;
- a new parameter, default, or validation on an existing tool;
- documentation, examples, CI, or tooling improvements.

If you are not sure your idea fits, open an issue first — it is much cheaper to align before you write code.

## Reporting bugs and requesting features

Use the issue templates:

- **Bug report** — for behaviour that diverges from the docs, the Meta API contract, or what a reasonable caller would expect.
- **Feature request** — for new tools, new parameters, or improvements.

Please search the existing issues (open and closed) first; many are tracked under the milestones in [the project board](https://github.com/exileum/meta-mcp/milestones). When a bug touches a Meta API endpoint, link the relevant page from [developers.facebook.com](https://developers.facebook.com/docs/) so reviewers can verify the wrapper against the source of truth.

The `severity::low` / `medium` / `high` / `critical` labels are applied by maintainers — you do not need to set them yourself.

## Development setup

You need **Node.js 22 or newer** (see [`.nvmrc`](./.nvmrc) and the `engines` field in [`package.json`](./package.json)).

```bash
git clone https://github.com/exileum/meta-mcp.git
cd meta-mcp
npm install
```

Common scripts (from `package.json`):

| Script | What it does |
|--------|--------------|
| `npm run dev` | Run `src/index.ts` directly via [tsx](https://github.com/privatenumber/tsx) — useful while iterating on a tool. |
| `npm run build` | Type-check and emit JavaScript to `dist/` via `tsc`. |
| `npm start` | Run the compiled `dist/index.js`. |
| `npm test` | Run the [vitest](https://vitest.dev) suite once. |
| `npm run test:watch` | Re-run vitest on change. |
| `npm run lint` | Run [ESLint](https://eslint.org) with `--max-warnings 0` (the same gate CI enforces). |
| `npm run lint:fix` | Run ESLint with `--fix` for auto-fixable issues. |

For local credentials, copy [`.env.example`](./.env.example) and export the variables before running the server. Only set the credential pair(s) you actually plan to exercise — `loadConfig()` validates them at startup and emits a stderr warning when one half of a pair is missing.

## Project layout

```
src/
├── index.ts                  # Server entry: registers tools, resources, prompts; wires MetaClient
├── config.ts                 # Zod-validated env-var loader (MetaConfigSchema, loadConfig())
├── schemas.ts                # Shared Zod helpers (e.g. replyControlSchema)
├── services/
│   └── meta-client.ts        # HTTP client, rate-limit tracking, MetaApiError
├── utils/
│   ├── errors.ts             # categorize(), sanitizeRaw(), formatErrorResponse(), toMcpResourceError()
│   └── container.ts          # pollContainerStatus(), IMAGE_PROCESSING_TIMEOUT, VIDEO_PROCESSING_TIMEOUT
├── tools/
│   ├── instagram/            # ig_* tools, grouped by domain (publishing, media, comments, …)
│   ├── threads/              # threads_* tools, grouped by domain (publishing, media, replies, …)
│   ├── meta/
│   │   └── auth.ts           # meta_* tools (token exchange / refresh / debug, webhooks, app info)
│   └── test-utils.ts         # Shared mock helpers for tool tests
├── resources/                # MCP resources (instagram-profile, threads-profile)
└── prompts/                  # MCP prompts (content_publish, analytics_report)
```

Tests live next to the file they cover (`*.test.ts`) — see e.g. [`src/tools/instagram/profile.test.ts`](./src/tools/instagram/profile.test.ts).

## Adding a new tool

1. **Pick the right file.** Group tools by platform and domain — Instagram comment tools live in `src/tools/instagram/comments.ts`, Threads insights in `src/tools/threads/insights.ts`. Add a new group only when no existing one fits.
2. **Define the input schema with Zod.** Use `.describe()` on every parameter and explain the constraint or default in the description; reviewers expect a link to the Meta API doc that justifies non-obvious choices. See `igBusinessDiscoveryUsernameSchema` in `src/tools/instagram/profile.ts` for a worked example with `.trim()`, `.transform()`, and `.refine()`.
3. **Write the handler inside `try` / `catch`.** Success returns `{ content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] }`. Failures must go through `formatErrorResponse(error, "<Action label>")` so the structured error contract (`error_type`, `http_status`, `code`, `subcode`, `remediation`, sanitized `raw`) is preserved and tokens never leak. Resource handlers use `toMcpResourceError(error, "<label>")` instead.
4. **Register the tool** inside the relevant `registerXxxTools(server, client)` function. If you create a new register function, wire it up in `src/index.ts` next to the existing imports.
5. **Add tests** alongside the source file. Use `makeMockServer()` from [`src/tools/test-utils.ts`](./src/tools/test-utils.ts) and a locally defined `makeMockClient()` following the pattern in existing tests (e.g. [`src/tools/instagram/profile.test.ts`](./src/tools/instagram/profile.test.ts), [`media.test.ts`](./src/tools/instagram/media.test.ts) — `makeMockClient()` is inlined per file because each test stubs out only the `MetaClient` methods it needs). Cover at least: the happy path, the input validation error, and any handler-level branching.
6. **Update the docs surface** — the tool table in [`README.md`](./README.md), the matching list in [`llms.txt`](./llms.txt), and the `### Added` block of [`CHANGELOG.md`](./CHANGELOG.md) under `[Unreleased]`. Renaming or removing a tool is a breaking change and goes under `### Changed` or `### Removed` with the `BREAKING:` prefix used elsewhere in the changelog.

## Testing

- Run the suite with `npm test`; use `npm run test:watch` while iterating.
- New tools, new utilities, and bug fixes ship with tests. Bug fixes ideally add a regression test that fails on `main` and passes on the fix.
- Tests use vitest's `describe` / `it` / `expect` and live next to the source file. Network and SDK access is mocked — no test should hit the real Meta API.

## Coding style

- TypeScript runs in strict mode (see [`tsconfig.json`](./tsconfig.json)). Add types where inference is not obvious; avoid `any`.
- This package is ES modules — relative imports use the `.js` suffix even from `.ts` sources (Node ESM resolution rule). Mirror the pattern in existing files.
- Keep comments rare. Add one when the *why* is non-obvious (a Meta API quirk, a workaround for a known bug, an invariant that would surprise the next reader). Skip comments that restate the code.
- All code, comments, commit messages, issues, and PR descriptions are in **English**.
- No emoji in source files unless an existing file already uses them.

## Errors and tokens

The structured error contract introduced in [#114](https://github.com/exileum/meta-mcp/issues/114) is load-bearing: AI clients parse `error_type` / `remediation` to decide whether to retry, and `sanitizeRaw()` scrubs `access_token=` / `client_secret=` / `input_token=` from the raw payload so credentials never reach the client. Always route tool failures through `formatErrorResponse(error, "<label>")` and resource failures through `toMcpResourceError(error, "<label>")`. Never log raw URLs that may contain query-string tokens.

## Commit messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>: <concise description> (#<issue-number>)

<body explaining what was broken / what changed / why>
```

Types in active use, mirroring the git log:

- `fix:` — bug fix
- `feat:` — new tool, new parameter, or new capability
- `refactor:` — internal change with no user-visible effect
- `docs:` — README / CHANGELOG / CONTRIBUTING / `llms.txt`
- `chore:` — release plumbing, lockfile maintenance, infra
- `fix(deps):` / `chore(changelog):` — narrower scopes when useful
- `BREAKING:` is added inline (see existing CHANGELOG entries) for any user-visible breaking change

Reference the issue number in the subject (`fix: ig_respond_collaboration_invite uses media_id (#83)`) so GitHub cross-links the commit.

## CHANGELOG

The changelog follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the project follows [SemVer](https://semver.org/). Every change that affects the **published npm package or MCP runtime** goes under `## [Unreleased]` in one of `Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`. Each entry links the issue it resolves (`([#94](https://github.com/exileum/meta-mcp/issues/94))`) and explains the *why* — readers should be able to tell whether the change matters to them without opening the PR.

The npm tarball ships only `dist/`, `LICENSE`, and `README.md` (see the `files` field in `package.json`). Changes that touch only repo-level governance — `CONTRIBUTING.md`, `.github/` templates and workflows, dependabot config, `.editorconfig`, etc. — are **not** logged in `CHANGELOG.md`; the commit message and PR description are the canonical record. When in doubt, lean toward inclusion only when the change is reachable from a published artifact.

## Pull request flow

1. Branch from `main` using a `<type>/<short-topic>-<issue-number>` name (e.g. `fix/threads-reply-video-timeout-49`, `feat/ig-collaborators-96`).
2. Keep the change small and focused. One logical change per PR makes review and revert tractable.
3. Run the full local CI matrix before pushing:
   ```bash
   npx tsc --noEmit
   npm run lint
   npm test
   npm audit --audit-level=high
   npm run build
   ```
   (Use `npx tsc` so the locally pinned TypeScript from `node_modules/.bin/` runs — there is no global `tsc` requirement and no `typecheck` script in `package.json`.)
4. Update the public surface docs alongside the code change: `README.md` (tool table), `llms.txt` (tool descriptions), `server.json` (only when version metadata changes — usually maintainer-only), and `CHANGELOG.md`.
5. Open the PR with the [PR template](./.github/PULL_REQUEST_TEMPLATE.md). Include `Fixes #<N>` (each on its own line) so the issue auto-closes on merge.
6. After the PR is open, automated reviewers may comment (`@claude` is wired up in [`.github/workflows/claude.yml`](./.github/workflows/claude.yml); third-party review bots may chime in too). Address actionable feedback in additional commits — do not force-push silently over an in-progress review.

## CI gates

Every PR runs the workflow at [`.github/workflows/ci.yml`](./.github/workflows/ci.yml):

- `setup` — `npm ci`, then caches `node_modules` for the rest of the matrix.
- `typecheck` — `tsc --noEmit` (uses the cache).
- `lint` — `npm run lint` → `eslint . --max-warnings 0` (uses the cache).
- `test` — `npm test` (vitest, uses the cache).
- `audit` — `npm audit --audit-level=high` (uses the cache).
- `version-sync` — verifies `package.json.version`, `server.json.version`, and `server.json.packages[0].version` match. Runs independently of the cache (no `node_modules` needed). This is the gate most contributors trip over; if you bumped one, bump them all (or none, if you are not cutting a release).
- `build` — runs only after the five gates pass; `npm run build`.

All jobs must be green before the PR can merge.

## Releases

Releases are maintainer-only. Bumping `package.json` + `server.json` versions and adding a release heading to `CHANGELOG.md` on `main` triggers [`.github/workflows/release.yml`](./.github/workflows/release.yml), which tags `v<version>`, creates a GitHub Release, and publishes to npm + GitHub Packages.

**Contributors should not bump versions in feature PRs.** A maintainer batches the bump into a release commit when cutting the next version.

## License

meta-mcp is [MIT-licensed](./LICENSE). By opening a pull request you agree that your contribution is licensed under the same terms.

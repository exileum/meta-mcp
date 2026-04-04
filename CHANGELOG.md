# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **`threads_reply` video polling silently proceeds on timeout** — replaced the inline wait loop (which lacked a timeout error) with the shared `waitForThreadsContainer()` helper that correctly throws on timeout, preventing publication of unfinished video containers ([#21](https://github.com/exileum/meta-mcp/issues/21))
- **RateLimit fields always `undefined`** — `parseRateLimit()` now maps Meta's snake_case `x-app-usage` header fields (`call_count`, `total_cpu_time`, `total_time`) to the camelCase `RateLimit` interface, fixing silently broken rate limit data in all tool responses ([#20](https://github.com/exileum/meta-mcp/issues/20))
- **`.env` not in `.gitignore`** — added `.env*` patterns to prevent accidental secret exposure, and created `.env.example` for developer onboarding ([#22](https://github.com/exileum/meta-mcp/issues/22))

## [3.2.0] — 2026-04-04

### Fixed
- **Token exchange/refresh endpoints** — `meta_exchange_token` and `meta_refresh_token` now use the correct platform-specific endpoints and grant types ([#19](https://github.com/exileum/meta-mcp/issues/19)):
  - Instagram: `graph.instagram.com` with `ig_exchange_token` / `ig_refresh_token`
  - Threads: `graph.threads.net` with `th_exchange_token` / `th_refresh_token`
  - Previously all token operations incorrectly used the Facebook Graph API (`graph.facebook.com` with `fb_exchange_token`), which failed for both Instagram and Threads tokens
- **`meta_refresh_token` broken** — the old implementation used the wrong endpoint (`/oauth/access_token` instead of `/refresh_access_token`) and wrong grant type (`fb_exchange_token` instead of platform-specific refresh grant types), making refresh fail for all platforms

### Changed
- **`meta_exchange_token` / `meta_refresh_token`** now require a `platform` parameter (`"instagram"` or `"threads"`) to route to the correct endpoint
- **Minimum Node.js version** — raised from 18 to 22 LTS (Node 18 reached EOL in April 2025)
- **zod** — upgraded from 3.25.76 to 4.3.6
- **@modelcontextprotocol/sdk** — upgraded from 1.26.0 to 1.29.0
- **typescript** — upgraded from 5.9.3 to 6.0.2
- **@types/node** — upgraded from 22.19.11 to 25.5.2

## [3.1.0] — 2026-04-04

### Added
- **npm provenance** — packages are now published with OIDC trusted publishing for verifiable supply chain security

### Fixed
- **Instagram API base URL** — use `graph.instagram.com` for Instagram endpoints; tokens from Instagram Login flow (`IGAA...`) were rejected by `graph.facebook.com`
- **Meta platform endpoints** — separate `FB_BASE` (`graph.facebook.com`) for token exchange, debug, and webhook tools that only exist on the Facebook Graph API
- **POST request encoding** — switch from `application/json` to `application/x-www-form-urlencoded` for POST requests; optional parameters like `topic_tag` and `poll` were silently ignored by the Meta API with JSON encoding
- Deduplicate URLSearchParams building logic in `meta-client.ts`

## [3.0.0] — 2026-04-04

### Changed
- **Fork rebrand** — forked from @mikusnuz/meta-mcp to @exileum/meta-mcp
- NPM scope changed from `@mikusnuz` to `@exileum`
- All registry identifiers updated (MCP Registry, Smithery, Glama)
- Removed Korean README and agent templates
- **npm package contents** — LICENSE and README are now included in the published package

### Fixed
- **Container wait consistency** — `waitForContainer` now runs for all media types (IMAGE + VIDEO) in carousel, story, and photo publishing, not just VIDEO

## [2.0.2] — 2026-03-24

### Fixed
- **Carousel publishing** — wait for IMAGE container processing in carousel posts

## [2.0.1] — 2026-03-20

### Changed
- Bumped version for MCP Registry republish
- Added `glama.json` and Dockerfile for Glama registry
- Added `smithery.yaml` for Smithery registry listing
- Added `server.json` for official MCP Registry
- Added `llms.txt` and agent templates for AI-first distribution

## [2.0.0] — 2026-03-19

### Added
- **Threads polls** — create posts with interactive poll attachments
- **Threads GIFs** — attach GIFs from GIPHY or Tenor
- **Threads topic tags** — categorize posts with topic tags
- **Threads link attachments** — attach URL preview cards to text posts
- **Threads post search** — search public posts by keyword or topic tag
- **Threads post deletion** — delete posts (rate limited to 100/day)
- **Threads publishing limit** — check remaining quota (250 posts/day)
- **Threads quote posts** — quote other posts by ID
- **Threads spoiler flag** — mark content as spoiler
- **Threads alt text** — add accessibility descriptions to all media types
- **Threads reply controls** — `parent_post_author_only` and `followers_only` options
- **Instagram alt text** — support for photo, reel, and carousel items
- **Instagram collaboration invites** — query and respond to collab invites
- **Updated insights metrics** — new `clicks`, `reposts`, `reels_skip_rate` metrics

### Changed
- **Graph API v25.0** — upgraded from v21.0 (expired Sep 2025) to v25.0

### Fixed
- **Deprecated metrics** — `impressions`, `video_views`, `engagement` replaced with `views`, `reach`, `saved`, `shares`

## [1.0.0] — 2026-02-20

### Added
- Initial release: MCP server for Instagram Graph API, Threads API & Meta platform
- 57 tools across Instagram (33), Threads (18), and Meta platform (6)
- Instagram: publish photos/videos/reels/stories/carousels, manage comments, view insights, search hashtags, handle DMs
- Threads: publish text/images/videos/carousels, manage replies, view insights
- Meta: token exchange/refresh/debug, webhook management
- 2 resources: Instagram profile, Threads profile
- 2 prompts: cross-platform content publishing, analytics report

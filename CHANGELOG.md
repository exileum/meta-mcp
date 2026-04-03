# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.0] — 2026-04-04

### Changed
- **Fork rebrand** — forked from @mikusnuz/meta-mcp to @exileum/meta-mcp
- NPM scope changed from `@mikusnuz` to `@exileum`
- All registry identifiers updated (MCP Registry, Smithery, Glama)
- Removed Korean README and agent templates

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

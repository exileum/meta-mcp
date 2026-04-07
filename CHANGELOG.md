# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.8.0] — 2026-04-07

### Added
- **`threads_get_replies` now supports `mode='full_tree'`** — new optional `mode` parameter switches the underlying endpoint between `/{post}/replies` (default `mode='top_level'`, direct replies only) and `/{post}/conversation` (full conversation tree with every reply at every nesting level flattened); the response shape is identical and the new fields `root_post`, `replied_to`, `is_reply` are now included in both modes so callers can reconstruct the tree; per the [Replies and Conversations docs](https://developers.facebook.com/docs/threads/retrieve-and-manage-replies/replies-and-conversations/)
- **`threads_get_mentions`** — list posts where the authenticated user has been @mentioned via `GET /{user-id}/mentions`; supports `since`/`until` Unix-timestamp filtering and pagination; requires the `threads_manage_mentions` permission; private profiles are excluded by the API; per the [Threads Mentions docs](https://developers.facebook.com/docs/threads/threads-mentions/)
- **`threads_repost`** — repost an existing Threads post to your own profile via `POST /{thread-id}/repost`; requires the `threads_content_publish` permission; reposts appear under the Reposts tab; for quote-reposts continue using `threads_publish_text` with `quote_post_id`; per the [Reposts docs](https://developers.facebook.com/docs/threads/posts/reposts/)

## [3.7.0] — 2026-04-07

### Added
- **`threads_publish_text` now supports `text_attachment` for long-form posts (up to 10,000 chars)** — new `text_attachment` parameter renders as an expandable "Read more" block beneath the primary text; also supports `text_attachment_link` (URL inside the attachment card) and `text_attachment_styling` (bold, italic, highlight, underline, strikethrough formatting with character-based offset/length ranges that are automatically converted to UTF-8 byte offsets for the API); includes bounds validation for styling ranges; `text_attachment` cannot be combined with `poll_options` or `link_attachment` per the [Threads Text Attachments API](https://developers.facebook.com/docs/threads/create-posts/text-attachments/) ([#42](https://github.com/exileum/meta-mcp/issues/42))

### Changed
- **Unified container polling logic** — extracted `waitForContainer` (Instagram) and `waitForThreadsContainer` (Threads) into a single `pollContainerStatus()` utility in `src/utils/container.ts`, eliminating 3x code duplication; the two platform-specific functions are now thin wrappers over the shared implementation ([#46](https://github.com/exileum/meta-mcp/issues/46))
- **Dockerfile now runs as non-root user** — added a dedicated `app` user/group so the Node.js process no longer runs as root inside the container, following the principle of least privilege ([#35](https://github.com/exileum/meta-mcp/issues/35))
- **Added `.dockerignore` to exclude unnecessary files from build context** — prevents `.git/`, `node_modules/`, `src/`, `.env`, and other non-runtime files from being sent to the Docker daemon, reducing build context size and eliminating risk of secrets leaking into the image ([#36](https://github.com/exileum/meta-mcp/issues/36))
- **Server version no longer hardcoded in `src/index.ts`** — `SERVER_VERSION` is now read from `package.json` at runtime via `createRequire`, eliminating one of the four locations that previously required manual sync during version bumps; added a `version-sync` CI job that validates `server.json` versions match `package.json` on every PR ([#39](https://github.com/exileum/meta-mcp/issues/39))

### Fixed
- **No HTTPS enforcement on user-provided media URLs** — all media and callback URL parameters now validate that URLs use the `https://` scheme via a shared `httpsUrl` Zod schema; previously `z.string().url()` accepted any scheme (`http://`, `ftp://`, `file://`, `data:`), enabling potential SSRF and non-secure media transfer; also added missing URL validation to `ig_publish_reel`'s `cover_url` parameter ([#44](https://github.com/exileum/meta-mcp/issues/44))
- **`ClientResponse.data` typed as `unknown` forces 57 unsafe `as object` casts** — changed `data` type from `unknown` to `Record<string, unknown>`, eliminating all 57 unsafe type assertions across 13 tool handler files; fixed the non-JSON response path in `MetaClient.request()` to always return an object (`{ raw: text, success: true }`) instead of a raw string, preventing silent data corruption when the response is spread ([#24](https://github.com/exileum/meta-mcp/issues/24))

## [3.6.0] — 2026-04-06

### Added
- **Cross-share Threads posts to Instagram Stories** — all four publish tools (`threads_publish_text`, `threads_publish_image`, `threads_publish_video`, `threads_publish_carousel`) now accept optional `share_to_ig_story` parameter (`"light"`/`"dark"`) to cross-share the post to the user's linked Instagram account as a Story; requires `threads_share_to_instagram` permission; the Threads post publishes normally even if cross-share fails; response includes `crossreshare_to_ig_status` (`"SUCCESS"` or `"FAILED"`)

### Fixed
- **`threads_publish_text` sends wrong `poll_attachment` format — polls silently fail** — changed `poll_attachment` JSON structure from `{"options":[{"option_text":"..."},...]}` (array of objects) to `{"option_a":"...","option_b":"..."}` (named keys) matching the [Threads Poll API](https://developers.facebook.com/docs/threads/create-posts/polls); the old format was silently ignored by the API, creating text-only posts instead of polls
- **`threads_publish_text` missing per-option length validation for polls** — each poll option string is now validated to 1-25 characters via Zod `.min(1).max(25)`; previously only the array length (2-4) was checked
- **`threads_get_posts` and `threads_get_post` return empty `poll_attachment` data** — added sub-field expansion syntax (`poll_attachment{option_a,...,total_votes,expiration_timestamp}`) to default fields; without expansion the API omits vote percentages and totals

## [3.5.0] — 2026-04-05

### Fixed
- **`threads_publish_carousel` fails — carousel container not polled before publish** — added missing `waitForThreadsContainer()` call for the carousel container between creation and publish; without it the Meta API returned error 24 / subcode 4279009 ("Cannot find media with the given ID") when the carousel container was still processing ([#142](https://github.com/exileum/meta-mcp/issues/142))
- **`threads_get_container_status` fails on published post IDs with confusing error** — updated tool description to clarify it only works with unpublished container IDs; added error handling that detects the "nonexisting field" API error and returns a helpful message explaining the limitation ([#143](https://github.com/exileum/meta-mcp/issues/143))
- **`threads_search_posts` uses wrong endpoint and parameters** — changed endpoint from `/{user_id}/threads_search` (nonexistent) to `/keyword_search`; split `search_type` into `search_type` (`TOP`/`RECENT`) for ordering and `search_mode` (`KEYWORD`/`TAG`) for search behavior; removed unsupported `CAROUSEL` from `media_type` enum; per the [Threads Keyword Search docs](https://developers.facebook.com/docs/threads/keyword-search) ([#141](https://github.com/exileum/meta-mcp/issues/141))
- **`threads_get_post_insights` uses invalid metric `clicks` for post-level insights** — removed `clicks` from the default metrics for `threads_get_post_insights`; `clicks` is only valid for user-level insights (`threads_get_user_insights`), not for individual post insights per the Threads Insights API docs ([#140](https://github.com/exileum/meta-mcp/issues/140))
- **`threads_get_post` and `threads_get_posts` request non-existent field `gif_attachment`** — replaced `gif_attachment` with `gif_url` in the default `fields` parameter for both tools; `gif_attachment` is a write-only parameter used when creating posts, while `gif_url` is the correct readable field per the Threads Media API docs ([#139](https://github.com/exileum/meta-mcp/issues/139))
- **`ig_publish_carousel` calls `media_publish` before carousel container finishes processing** — added missing `waitForContainer()` call for the carousel container, matching the pattern used in all other Instagram publish tools; without it the Meta API returned error 9007 / subcode 2207027 ("Media ID is not available") when the container was still `IN_PROGRESS` ([#138](https://github.com/exileum/meta-mcp/issues/138))
- **`topic_tag` silently accepted invalid characters in Threads publish tools** — added Zod `regex` validation rejecting periods (`.`) and ampersands (`&`) per Meta API docs; added comprehensive tests verifying `topic_tag` is correctly forwarded in all four Threads publish tools (text, image, video, carousel) and form-encoded correctly by MetaClient ([#137](https://github.com/exileum/meta-mcp/issues/137))
- **`ig_delete_media` references wrong permission name** — reverted from `instagram_business_content_publish` (a publishing permission, incorrectly set in PR #129) back to the correct `instagram_manage_contents`; added note that the DELETE endpoint is only available via Facebook Login, not Instagram Login, per the [IG Media API reference](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/) ([#122](https://github.com/exileum/meta-mcp/issues/122))

## [3.4.0] — 2026-04-05

### Fixed
- **`waitForContainer` / `waitForThreadsContainer` ignore EXPIRED and unexpected statuses** — both container polling functions now handle `EXPIRED`, `PUBLISHED`, and unknown statuses immediately instead of silently polling until timeout; timeout error message now includes the last observed status ([#28](https://github.com/exileum/meta-mcp/issues/28))
- **`ig_publish_story` missing `media_type: 'STORIES'`** — image stories had no `media_type` (defaulting to feed post) and video stories incorrectly used `"VIDEO"` instead of `"STORIES"`; now both set `media_type: "STORIES"` as required by Meta's Content Publishing API ([#50](https://github.com/exileum/meta-mcp/issues/50))
- **`threads_get_user_insights` missing required `period` parameter** — added `period` parameter (day/lifetime) to the tool schema and API request; without it the Meta API returned error `(#100) The period param is required for this metric` for all time-series metrics ([#30](https://github.com/exileum/meta-mcp/issues/30))
- **`ig_send_message` sends double-encoded body incompatible with Meta API** — switched from URL-encoded form body with `JSON.stringify()`-ed values to a proper `application/json` request body, matching what Meta's Instagram Messaging API expects; added `json` option to `MetaClient.request()` for endpoints requiring JSON bodies ([#31](https://github.com/exileum/meta-mcp/issues/31))
- **`thumb_offset: 0` silently ignored in `ig_publish_video` and `ig_publish_reel`** — falsy check `if (thumb_offset)` skipped valid value `0`; replaced with `if (thumb_offset !== undefined)`. Same fix applied to all numeric `limit` parameters across Instagram and Threads tools ([#32](https://github.com/exileum/meta-mcp/issues/32))
- **`threads_publish_image` skips container status polling before publishing** — added missing `waitForThreadsContainer()` call so image containers are polled for `FINISHED` status before publishing, matching the behavior of `threads_publish_video` and `threads_publish_carousel` and preventing intermittent publish failures for large images ([#29](https://github.com/exileum/meta-mcp/issues/29))
- **Tenor GIF provider already sunset** — removed `TENOR` from `gif_provider` enum in `threads_publish_text` since Tenor API support was sunset by Meta on March 31, 2026; only GIPHY is currently supported ([#43](https://github.com/exileum/meta-mcp/issues/43))
- **Instagram messaging tool descriptions reference wrong permission** — updated `ig_get_conversations` and `ig_send_message` descriptions to reference `instagram_business_manage_messages` (correct for Instagram API with Instagram Login) instead of the deprecated `instagram_manage_messages` (Messenger Platform) ([#23](https://github.com/exileum/meta-mcp/issues/23))

### Changed
- **Instagram setup instructions updated for Instagram API with Instagram Login** — README now documents the modern setup flow (no Facebook Page required, dashboard token generation, `instagram_business_*` permissions) instead of the legacy Instagram Graph API flow ([#23](https://github.com/exileum/meta-mcp/issues/23))

## [3.3.1] — 2026-04-05

### Added
- **Publish to GitHub Packages** — the release workflow now publishes to the GitHub Packages npm registry (`npm.pkg.github.com`) in addition to npmjs.com, providing an alternative installation source and tighter GitHub ecosystem integration ([#18](https://github.com/exileum/meta-mcp/issues/18))

## [3.3.0] — 2026-04-05

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

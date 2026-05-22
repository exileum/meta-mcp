# meta-mcp

[![npm version](https://img.shields.io/npm/v/@exileum/meta-mcp)](https://www.npmjs.com/package/@exileum/meta-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![meta-mcp MCP server](https://glama.ai/mcp/servers/exileum/meta-mcp/badges/score.svg)](https://glama.ai/mcp/servers/exileum/meta-mcp)

Enables AI assistants to manage Instagram and Threads accounts — publish content, handle comments, view insights, search hashtags, and manage DMs through the Meta Graph API.

## Prerequisites

- **Node.js 22+** (LTS recommended)

## Quick Start

Add to your MCP client config:

```json
{
  "mcpServers": {
    "meta": {
      "command": "npx",
      "args": ["-y", "@exileum/meta-mcp"],
      "env": {
        "INSTAGRAM_ACCESS_TOKEN": "your_ig_token",
        "INSTAGRAM_USER_ID": "your_ig_user_id",
        "THREADS_ACCESS_TOKEN": "your_threads_token",
        "THREADS_USER_ID": "your_threads_user_id"
      }
    }
  }
}
```

Only set the variables for the platforms you use.

### Manual Installation

```bash
git clone https://github.com/exileum/meta-mcp.git
cd meta-mcp
npm install
npm run build
```

```json
{
  "mcpServers": {
    "meta": {
      "command": "node",
      "args": ["/path/to/meta-mcp/dist/index.js"],
      "env": {
        "INSTAGRAM_ACCESS_TOKEN": "your_ig_token",
        "INSTAGRAM_USER_ID": "your_ig_user_id",
        "THREADS_ACCESS_TOKEN": "your_threads_token",
        "THREADS_USER_ID": "your_threads_user_id"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `INSTAGRAM_ACCESS_TOKEN` | For Instagram | Instagram Graph API access token |
| `INSTAGRAM_USER_ID` | For Instagram | Instagram Business/Creator account ID (numeric string, or `"me"` for the authenticated user) |
| `THREADS_ACCESS_TOKEN` | For Threads | Threads API access token |
| `THREADS_USER_ID` | For Threads | Threads user ID (numeric string, or `"me"` for the authenticated user) |
| `META_APP_ID` | For token/webhook tools | Meta App ID (numeric string) |
| `META_APP_SECRET` | For token/webhook tools | Meta App Secret |
| `META_API_VERSION` | Optional | Meta Graph API version for Instagram and Facebook endpoints — defaults to `v25.0` (verified 2026-05-06). Override only when Meta deprecates a version before meta-mcp ships a new release. Format: `vMAJOR.MINOR` (e.g., `v26.0`); malformed values fall back to the default with a stderr warning. OAuth token endpoints are unversioned and unaffected by this setting |
| `THREADS_API_VERSION` | Optional | Threads API version — defaults to `v1.0` (verified 2026-05-06). Threads runs a separate single-major-version track and is not bumped in lockstep with the Graph API. Same `vMAJOR.MINOR` format and fallback behavior as `META_API_VERSION` |

The server validates these at startup. Malformed values for `INSTAGRAM_USER_ID`, `THREADS_USER_ID`, or `META_APP_ID` cause the process to exit with `Invalid meta-mcp configuration: …`. Setting only one half of a credential pair (e.g., `INSTAGRAM_ACCESS_TOKEN` without `INSTAGRAM_USER_ID`) prints a stderr warning and continues; related tool invocations still fail at call time.

## Account Requirements

| Platform | Account Type | Notes |
|----------|-------------|-------|
| **Instagram** | Business or Creator | Personal accounts cannot use the Graph API. Free to switch in settings |
| **Threads** | Any account | Instagram link no longer required since Sep 2025 |
| **Meta** (token/webhook) | Meta Developer App | Create at [developers.facebook.com](https://developers.facebook.com) |

## Features

- **58 tools** across Instagram (33), Threads (19), and Meta platform (6)
- **Instagram**: Publish photos/videos/reels/stories/carousels with alt text, manage comments, view insights, search hashtags, handle DMs, manage collaboration invites
- **Threads**: Publish text/images/videos/carousels with polls, GIFs, topic tags, link attachments, alt text, spoiler flags; manage replies; search posts; delete posts; view insights
- **Meta**: Token exchange/refresh/debug, webhook management
- **2 resources**: Instagram profile, Threads profile
- **2 prompts**: Cross-platform content publishing, analytics report
- Rate limit tracking via `x-app-usage` header — and **automatic client-side throttling** at 80% (1s slowdown) / 90% (5s backoff) so a burst of tool calls stays under Meta's per-app quota
- **Automatic retry** for transient Meta API failures (HTTP `429`/`500`/`502`/`503`/`504`, network errors, `fetch` timeouts) with exponential backoff and `Retry-After` honoring; tunable via `MetaClient`'s `maxRetries` option (default 3, set to 0 to disable)
- **Structured error responses** with `error_type` (`auth`, `validation`, `rate_limit`, `server`, `network`, `internal`), HTTP status, Meta API code/subcode/type, and a `remediation` hint where actionable — see [`CHANGELOG.md`](./CHANGELOG.md) for the JSON shape

## Tools

### Meta Platform (6)

| Tool | Description |
|------|-------------|
| `meta_exchange_token` | Exchange short-lived token for long-lived token (~60 days). Requires `platform` (`instagram` or `threads`) |
| `meta_refresh_token` | Refresh a long-lived token before expiration. Requires `platform` (`instagram` or `threads`) |
| `meta_debug_token` | Inspect token validity, expiration, and scopes |
| `meta_get_app_info` | Get Meta App information |
| `meta_subscribe_webhook` | Subscribe to webhook notifications |
| `meta_get_webhook_subscriptions` | List current webhook subscriptions |

### Instagram — Publishing (6)

| Tool | Description |
|------|-------------|
| `ig_publish_photo` | Publish a photo post (supports alt_text, collaborators) |
| `ig_publish_video` | **[DEPRECATED]** Use `ig_publish_reel` — publishes as a Reel (legacy VIDEO media_type retired by Meta Nov 9, 2023; supports collaborators) |
| `ig_publish_carousel` | Publish a carousel/album (2-10 items, supports alt_text per IMAGE item, collaborators) |
| `ig_publish_reel` | Publish a Reel (supports collaborators) |
| `ig_publish_story` | Publish a Story (24hr) |
| `ig_get_container_status` | Check media container processing status |

### Instagram — Media (5)

| Tool | Description |
|------|-------------|
| `ig_get_media_list` | List published media |
| `ig_get_media` | Get media details |
| `ig_delete_media` | Delete a media post (requires Facebook Login) |
| `ig_get_media_insights` | Get media analytics (default views, reach — override `metric` per media type) |
| `ig_toggle_comments` | Enable/disable comments on a post |

### Instagram — Comments (7)

| Tool | Description |
|------|-------------|
| `ig_get_comments` | Get comments on a post |
| `ig_get_comment` | Get comment details |
| `ig_post_comment` | Post a comment |
| `ig_get_replies` | Get replies to a comment |
| `ig_reply_to_comment` | Reply to a comment |
| `ig_hide_comment` | Hide/unhide a comment |
| `ig_delete_comment` | Delete a comment |

### Instagram — Profile & Insights (5)

| Tool | Description |
|------|-------------|
| `ig_get_profile` | Get account profile info |
| `ig_get_account_insights` | Get account-level analytics (views, reach, follower_count). Optional `metric_type` (`total_value` or `time_series`) controls aggregation shape |
| `ig_business_discovery` | Look up another business account |
| `ig_get_collaboration_invites` | Get pending collaboration invites |
| `ig_respond_collaboration_invite` | Accept/decline a collaboration invite by media_id |

### Instagram — Hashtags (4)

| Tool | Description |
|------|-------------|
| `ig_search_hashtag` | Search hashtag by name |
| `ig_get_hashtag` | Get hashtag info |
| `ig_get_hashtag_recent` | Get recent media for a hashtag |
| `ig_get_hashtag_top` | Get top media for a hashtag |

### Instagram — Mentions & Tags (2)

| Tool | Description |
|------|-------------|
| `ig_get_mentioned_comment` | Get details of a specific comment mentioning you (by comment_id from a mention webhook) |
| `ig_get_tagged_media` | Get media you're tagged in |

### Instagram — Messaging (4)

| Tool | Description |
|------|-------------|
| `ig_get_conversations` | List DM conversations |
| `ig_get_messages` | Get messages in a conversation |
| `ig_send_message` | Send a DM (optional `messaging_type` = `RESPONSE`/`UPDATE`/`MESSAGE_TAG` and `tag` = `HUMAN_AGENT` for the 7-day human-agent window) |
| `ig_get_message` | Get message details |

### Threads — Publishing (9)

| Tool | Description |
|------|-------------|
| `threads_publish_text` | Publish a text post in a single API call (`auto_publish_text=true`, default; set `auto_publish=false` for the legacy two-step flow). Supports polls, GIFs, link attachments, topic tags, quote posts, spoiler flag, cross-share to IG Stories, geo-gating via `allowlisted_country_codes`, location tagging via `location_id`, text attachments up to 10K chars with styling |
| `threads_publish_image` | Publish an image post (supports alt_text, topic tags, spoiler flag, cross-share to IG Stories, geo-gating via `allowlisted_country_codes`, location tagging via `location_id`) |
| `threads_publish_video` | Publish a video post (supports alt_text, topic tags, spoiler flag, cross-share to IG Stories, geo-gating via `allowlisted_country_codes`, location tagging via `location_id`) |
| `threads_publish_carousel` | Publish a carousel (2-20 items, supports alt_text per item, cross-share to IG Stories, geo-gating via `allowlisted_country_codes` and location tagging via `location_id` on the parent container) |
| `threads_delete_post` | Delete a post (max 100/day) |
| `threads_get_container_status` | Check container processing status (unpublished containers only) |
| `threads_get_publishing_limit` | Check remaining publishing quota (250 posts/day) |
| `threads_repost` | Repost an existing thread to your profile (requires `threads_content_publish`) |
| `threads_search_locations` | Search Threads-supported locations by query (`q`) or coordinates (`latitude`+`longitude`) to obtain a `location_id` for the four `threads_publish_*` tools (requires `threads_location_tagging` permission) |

### Threads — Media & Search (3)

| Tool | Description |
|------|-------------|
| `threads_get_posts` | List published posts (includes topic_tag, poll, GIF fields; optional `fields` param to override the default field list) |
| `threads_get_post` | Get post details |
| `threads_search_posts` | Search public posts by keyword or tag (requires `threads_keyword_search` permission) |

### Threads — Replies (4)

| Tool | Description |
|------|-------------|
| `threads_get_replies` | Get replies to a post (`mode='top_level'` default, or `mode='full_tree'` for the entire conversation flattened) |
| `threads_reply` | Reply to a post (supports image/video attachments) |
| `threads_hide_reply` | Hide a reply |
| `threads_unhide_reply` | Unhide a reply |

### Threads — Mentions (1)

| Tool | Description |
|------|-------------|
| `threads_get_mentions` | List posts where the user was @mentioned (requires `threads_manage_mentions`) |

### Threads — Profile (1)

| Tool | Description |
|------|-------------|
| `threads_get_profile` | Get Threads profile info (includes `is_verified` and `is_eligible_for_geo_gating`) |

### Threads — Insights (2)

| Tool | Description |
|------|-------------|
| `threads_get_post_insights` | Get post analytics (views, likes, replies, reposts, quotes, shares) |
| `threads_get_user_insights` | Get account-level analytics (period: day/lifetime; `since`/`until` required for `day`) |

## Resources

| Resource URI | Description |
|-------------|-------------|
| `meta-mcp://instagram/profile` | Instagram account profile data |
| `meta-mcp://threads/profile` | Threads account profile data (includes is_verified and is_eligible_for_geo_gating) |

## Prompts

| Prompt | Description |
|--------|-------------|
| `content_publish` | Cross-post content to Instagram and Threads |
| `analytics_report` | Generate combined analytics report |

## Setup Guide

### Step 1: Create a Meta Developer App

1. Go to [developers.facebook.com](https://developers.facebook.com) and log in
2. Click **"My Apps"** -> **"Create App"**
3. Select **"Other"** -> **"Business"** (or "None" for personal use)
4. Enter an app name and create

Your **`META_APP_ID`** and **`META_APP_SECRET`** are in **App Settings -> Basic**.

### Step 2: Instagram Setup

> Requires an **Instagram Business or Creator account**. Switch for free in Instagram app -> Settings -> Account type.
> No Facebook Page linking required — this uses the [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/).

1. In your Meta App, go to **"Instagram"** -> **"API setup with Instagram business login"**
2. In the **"Generate access tokens"** section, click **"Add account"** -> log in to your Instagram account
3. The generated token is **long-lived (~60 days)** — no exchange step needed. Copy it as your **`INSTAGRAM_ACCESS_TOKEN`**.
   - To refresh before expiry, use the `meta_refresh_token` tool with `platform: "instagram"`, or:
     ```
     GET https://graph.instagram.com/refresh_access_token
       ?grant_type=ig_refresh_token
       &access_token=LONG_LIVED_TOKEN
     ```
4. **Get your Instagram User ID**:
   ```http
   GET https://graph.instagram.com/v25.0/me?fields=user_id,username&access_token=YOUR_TOKEN
   ```
   The `user_id` is your **`INSTAGRAM_USER_ID`**.
5. **Permissions** are configured in your app's Instagram settings. Available scopes:
   - `instagram_business_basic` — required for all operations
   - `instagram_business_content_publish` — publishing photos, reels, carousels
   - `instagram_business_manage_comments` — reading and managing comments
   - `instagram_business_manage_messages` — DM conversations and messaging

### Step 3: Threads Setup

> Works with **any Threads account**. Instagram link no longer required since Sep 2025.

1. In your Meta App, go to **"Add Products"** -> add **"Threads API"**
2. Go to **"Threads API" -> "Settings"**:
   - Add your Threads account as a **Threads Tester** under "Roles"
   - Accept the invitation in the Threads app: **Settings -> Account -> Website permissions -> Invites**
3. Generate an authorization URL:
   ```
   https://threads.net/oauth/authorize
     ?client_id=YOUR_APP_ID
     &redirect_uri=YOUR_REDIRECT_URI
     &scope=threads_basic,threads_content_publish,threads_manage_insights,threads_manage_replies,threads_read_replies,threads_share_to_instagram,threads_manage_mentions,threads_keyword_search
     &response_type=code
   ```
   For local testing, use `https://localhost/` as redirect URI (configure in App Settings -> Threads API -> Redirect URIs).
4. After authorization, exchange the code for an access token:
   ```
   POST https://graph.threads.net/oauth/access_token
   Content-Type: application/x-www-form-urlencoded

   client_id=YOUR_APP_ID
   &client_secret=YOUR_APP_SECRET
   &grant_type=authorization_code
   &redirect_uri=YOUR_REDIRECT_URI
   &code=AUTHORIZATION_CODE
   ```
5. Exchange for a long-lived token (~60 days):
   ```
   GET https://graph.threads.net/access_token
     ?grant_type=th_exchange_token
     &client_secret=YOUR_APP_SECRET
     &access_token=SHORT_LIVED_TOKEN
   ```
6. **Get your Threads User ID**:
   ```http
   GET https://graph.threads.net/v1.0/me?fields=id,username&access_token=YOUR_TOKEN
   ```
   The `id` field is your **`THREADS_USER_ID`**.

### Token Renewal

Access tokens expire after ~60 days. Refresh before expiration (token must be at least 24h old):

- **Instagram**: Use `meta_refresh_token` with `platform: "instagram"`, or call:
  ```http
  GET https://graph.instagram.com/refresh_access_token
    ?grant_type=ig_refresh_token
    &access_token=CURRENT_LONG_LIVED_TOKEN
  ```
- **Threads**: Use `meta_refresh_token` with `platform: "threads"`, or call:
  ```http
  GET https://graph.threads.net/refresh_access_token
    ?grant_type=th_refresh_token
    &access_token=CURRENT_LONG_LIVED_TOKEN
  ```

When you rotate a token through `meta_refresh_token` or `meta_exchange_token`, the new token is **automatically applied in-memory** to the running MCP server — subsequent tool calls use it immediately, no server restart needed. The new token is still returned in the response so you can persist it in your environment for the next process restart. A single `[meta-mcp] <Platform> access token updated in-memory after <tool>…` line is logged to stderr when this happens.

Check token status anytime with `meta_debug_token`.

## Troubleshooting

Tool failures return `isError: true` with a JSON body in `content[0].text` matching the envelope documented in [`CHANGELOG.md`](./CHANGELOG.md): `{ error: true, error_type, http_status, code, subcode, type, message, remediation, fbtrace_id, raw }`. The fastest path to a fix is to read `error_type` and the Meta API `code`, then jump to the matching subsection below. The full code reference is the [Meta Graph API error handling guide](https://developers.facebook.com/docs/graph-api/guides/error-handling/).

### `error_type: "auth"` — expired, revoked, or under-scoped token

Triggered by Meta API codes `190`, `10`, `102`, HTTP `401`, or `type: "OAuthException"`. Common messages:

- `Error validating access token: Session has expired` — long-lived tokens expire ~60 days after issue.
- `Application does not have permission for this action` — the token is missing a scope, or the account is not eligible (e.g., a **Personal** Instagram account on Graph API endpoints).

What to do:

1. Run `meta_debug_token` to inspect `expires_at`, `is_valid`, and `scopes`.
2. If the token is **not yet expired** but at least 24h old, refresh in place with `meta_refresh_token` (`platform: "instagram"` or `"threads"`) — this extends the lifetime by another ~60 days. If the token is **already expired**, the refresh endpoint will reject it; regenerate a short-lived token from the Meta App dashboard and exchange it via `meta_exchange_token` (or run a full re-authorization for Threads).
3. If scopes are missing, regenerate the token with the required permissions:
   - **Instagram**: `instagram_business_basic` (always required) plus `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages` per feature.
   - **Threads**: `threads_basic`, `threads_content_publish`, `threads_manage_insights`, `threads_manage_replies`, `threads_read_replies`, `threads_share_to_instagram`, `threads_manage_mentions`, `threads_keyword_search` per feature.
4. If your Instagram account is **Personal**, switch to **Business** or **Creator** for free in the Instagram app (Settings → Account type and tools → Switch to professional account). The Graph API rejects Personal accounts.

### `error_type: "rate_limit"` — application or user quota exhausted

Triggered by Meta API codes `4`, `17`, `32`, `341`, `613`, the business-use-case range `80001`–`80008`, or HTTP `429`. Includes any `OAuthException` with code `4` / `17` (these are surfaced as `error_type: "rate_limit"`, **not** `"auth"`, despite the type field). `MetaClient` automatically retries HTTP `429` up to 3 times with exponential backoff and honors any `Retry-After` header — a `rate_limit` error reaching the caller means the retry budget was exhausted.

What to do:

1. Inspect the `_rateLimit` field on prior successful tool responses. `callCount`, `totalCpuTime`, and `totalTime` come from Meta's `x-app-usage` header; when any approaches `100` you are near the per-app threshold.
2. meta-mcp already self-throttles once `max(callCount, totalCpuTime, totalTime)` crosses 80% (1s slowdown) or 90% (5s backoff) — see the `[meta-mcp] x-app-usage at N%…` lines on stderr. If you are still hitting `rate_limit` errors despite that, reduce request volume further and cache profile metadata between calls.
3. Threads has hard daily quotas (250 publishes, 100 deletes) — query the remaining quota with `threads_get_publishing_limit` before bulk operations.

### `error_type: "validation"` — bad parameter, wrong ID, or unsupported field

Triggered by Meta API codes `100`, `200`, `803`, or any unmapped 4xx HTTP status. Common pitfalls:

- **Wrong user ID format** — `INSTAGRAM_USER_ID` and `THREADS_USER_ID` must be the **numeric ID** returned by `GET /me?fields=user_id` (Instagram) or `GET /me?fields=id` (Threads), or the literal `"me"` for the authenticated user. The Instagram **username** is not accepted.
- **`(#100) Messaging is not supported`** on `ig_send_message` / `ig_get_conversations` / `ig_get_messages` — the account does not have the messaging API enabled. Grant `instagram_business_manage_messages` on your token and ensure DMs are enabled in the Instagram app (Settings → Privacy → Messages).
- **Deprecated publish endpoint** — `ig_publish_video` was retired by Meta on Nov 9, 2023; use `ig_publish_reel` for video posts. `ig_publish_story` is required for Stories.
- **Mutually exclusive Threads attachments** — a `threads_publish_text` post can carry only one of `text_attachment`, `poll_options`, `link_attachment`, or `gif_attachment`; combining them is rejected at the schema level.
- **Unsupported `metric` / `fields` for the resource** — see the per-tool Meta docs (`ig_get_media_insights` lists per-`media_type` valid metrics in its description).

### Other categories

- `error_type: "server"` (codes `1`, `2`, HTTP 5xx) — transient Meta outage. `MetaClient` already retried `500`/`502`/`503`/`504` up to 3 times with exponential backoff before surfacing this; check [metastatus.com](https://metastatus.com/) if it persists.
- `error_type: "network"` — `fetch` timed out or failed before reaching Meta. `MetaClient` already retried thrown network errors up to 3 times; verify outbound connectivity if the error keeps reappearing.
- `error_type: "internal"` — unexpected condition that did not map to a Meta error code. The `raw` field carries the sanitized original message; `access_token`, `client_secret`, and `input_token` values are scrubbed to `***` before reporting.

## API Stability

meta-mcp is consumed as an **MCP server runtime**, not as a library. The supported entry points are:

- `npx @exileum/meta-mcp` (recommended for end users)
- `node dist/index.js` (manual installation)

The single programmatic export from the package root, `createSandboxServer(): McpServer`, exists for the [Smithery](https://smithery.ai) sandbox runner and is the only stable JavaScript/TypeScript API.

**`zod` and other transitive runtime dependencies are internal** and not part of meta-mcp's public API. No `zod` symbols, types, or schemas flow through `dist/index.d.ts`, so `zod`'s version may change in any release — including major version bumps — without a corresponding meta-mcp major bump.

**`@modelcontextprotocol/sdk` is the one exception**: `McpServer` (the return type of `createSandboxServer()`) is imported from that package, so a breaking change to `McpServer`'s public interface would also be a breaking change for meta-mcp's programmatic API. In practice the MCP SDK follows semver, so consumers can treat `@modelcontextprotocol/sdk` as an implicit peer dependency of the `createSandboxServer` export.

Only the package root (`@exileum/meta-mcp`) is a supported import target. Deep imports into the published `dist/` tree (e.g. `@exileum/meta-mcp/dist/schemas.js`) are blocked by the `package.json` `exports` map for any spec-compliant resolver and are **not** part of the public API; they may be renamed, removed, or restructured in any release.

## Glama

[![meta-mcp MCP server](https://glama.ai/mcp/servers/exileum/meta-mcp/badges/card.svg)](https://glama.ai/mcp/servers/exileum/meta-mcp)

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup, project layout, the tool-registration recipe, testing, commit conventions, the CHANGELOG flow, and the CI gates. Bug reports and feature requests use the [issue templates](.github/ISSUE_TEMPLATE); pull requests use the [PR template](.github/PULL_REQUEST_TEMPLATE.md).

## License

[MIT](LICENSE)

---

See [CHANGELOG.md](CHANGELOG.md) for release history.

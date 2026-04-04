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
| `INSTAGRAM_USER_ID` | For Instagram | Instagram Business/Creator account ID |
| `THREADS_ACCESS_TOKEN` | For Threads | Threads API access token |
| `THREADS_USER_ID` | For Threads | Threads user ID |
| `META_APP_ID` | For token/webhook tools | Meta App ID |
| `META_APP_SECRET` | For token/webhook tools | Meta App Secret |

## Account Requirements

| Platform | Account Type | Notes |
|----------|-------------|-------|
| **Instagram** | Business or Creator | Personal accounts cannot use the Graph API. Free to switch in settings |
| **Threads** | Any account | Instagram link no longer required since Sep 2025 |
| **Meta** (token/webhook) | Meta Developer App | Create at [developers.facebook.com](https://developers.facebook.com) |

## Features

- **57 tools** across Instagram (33), Threads (18), and Meta platform (6)
- **Instagram**: Publish photos/videos/reels/stories/carousels with alt text, manage comments, view insights, search hashtags, handle DMs, manage collaboration invites
- **Threads**: Publish text/images/videos/carousels with polls, GIFs, topic tags, link attachments, alt text, spoiler flags; manage replies; search posts; delete posts; view insights
- **Meta**: Token exchange/refresh/debug, webhook management
- **2 resources**: Instagram profile, Threads profile
- **2 prompts**: Cross-platform content publishing, analytics report
- Rate limit tracking via `x-app-usage` header

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
| `ig_publish_photo` | Publish a photo post (supports alt_text) |
| `ig_publish_video` | Publish a video post |
| `ig_publish_carousel` | Publish a carousel/album (2-10 items, supports alt_text per item) |
| `ig_publish_reel` | Publish a Reel (supports alt_text) |
| `ig_publish_story` | Publish a Story (24hr) |
| `ig_get_container_status` | Check media container processing status |

### Instagram — Media (5)

| Tool | Description |
|------|-------------|
| `ig_get_media_list` | List published media |
| `ig_get_media` | Get media details |
| `ig_delete_media` | Delete a media post |
| `ig_get_media_insights` | Get media analytics (views, reach, saved, shares) |
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
| `ig_get_account_insights` | Get account-level analytics (views, reach, follower_count) |
| `ig_business_discovery` | Look up another business account |
| `ig_get_collaboration_invites` | Get pending collaboration invites |
| `ig_respond_collaboration_invite` | Accept or decline collaboration invites |

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
| `ig_get_mentioned_comments` | Get comments mentioning you |
| `ig_get_tagged_media` | Get media you're tagged in |

### Instagram — Messaging (4)

| Tool | Description |
|------|-------------|
| `ig_get_conversations` | List DM conversations |
| `ig_get_messages` | Get messages in a conversation |
| `ig_send_message` | Send a DM |
| `ig_get_message` | Get message details |

### Threads — Publishing (7)

| Tool | Description |
|------|-------------|
| `threads_publish_text` | Publish a text post (supports polls, GIFs, link attachments, topic tags, quote posts, spoiler flag) |
| `threads_publish_image` | Publish an image post (supports alt_text, topic tags, spoiler flag) |
| `threads_publish_video` | Publish a video post (supports alt_text, topic tags, spoiler flag) |
| `threads_publish_carousel` | Publish a carousel (2-20 items, supports alt_text per item) |
| `threads_delete_post` | Delete a post (max 100/day) |
| `threads_get_container_status` | Check container processing status |
| `threads_get_publishing_limit` | Check remaining publishing quota (250 posts/day) |

### Threads — Media & Search (3)

| Tool | Description |
|------|-------------|
| `threads_get_posts` | List published posts (includes topic_tag, poll, GIF fields) |
| `threads_get_post` | Get post details |
| `threads_search_posts` | Search public posts by keyword or topic tag |

### Threads — Replies (4)

| Tool | Description |
|------|-------------|
| `threads_get_replies` | Get replies to a post |
| `threads_reply` | Reply to a post (supports image/video attachments) |
| `threads_hide_reply` | Hide a reply |
| `threads_unhide_reply` | Unhide a reply |

### Threads — Profile (2)

| Tool | Description |
|------|-------------|
| `threads_get_profile` | Get Threads profile info (includes is_verified) |
| `threads_get_user_threads` | List user's threads |

### Threads — Insights (2)

| Tool | Description |
|------|-------------|
| `threads_get_post_insights` | Get post analytics (views, likes, replies, reposts, quotes, clicks) |
| `threads_get_user_insights` | Get account-level analytics |

## Resources

| Resource URI | Description |
|-------------|-------------|
| `instagram://profile` | Instagram account profile data |
| `threads://profile` | Threads account profile data (includes is_verified) |

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

1. In your Meta App, go to **"Add Products"** -> add **"Instagram Graph API"**
2. Go to **"Instagram Graph API" -> "Settings"** and connect your Instagram Business account via a Facebook Page
3. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
   - Select your app
   - Add permissions: `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`, `instagram_manage_contents`, `pages_show_list`, `pages_read_engagement`
   - Click **"Generate Access Token"** and authorize
4. The generated token is short-lived (~1 hour). Exchange it for a long-lived token (~60 days):
   ```
   GET https://graph.instagram.com/access_token
     ?grant_type=ig_exchange_token
     &client_secret=YOUR_APP_SECRET
     &access_token=SHORT_LIVED_TOKEN
   ```
   Or use the `meta_exchange_token` tool with `platform: "instagram"` after setup.
5. **Get your Instagram User ID**:
   ```http
   GET https://graph.facebook.com/v25.0/me/accounts?access_token=YOUR_TOKEN
   ```
   For each page, get the linked Instagram account:
   ```http
   GET https://graph.facebook.com/v25.0/{page-id}?fields=instagram_business_account&access_token=YOUR_TOKEN
   ```
   The `instagram_business_account.id` is your **`INSTAGRAM_USER_ID`**.

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
     &scope=threads_basic,threads_content_publish,threads_manage_insights,threads_manage_replies,threads_read_replies
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
  ```
  GET https://graph.instagram.com/refresh_access_token
    ?grant_type=ig_refresh_token
    &access_token=CURRENT_LONG_LIVED_TOKEN
  ```
- **Threads**: Use `meta_refresh_token` with `platform: "threads"`, or call:
  ```
  GET https://graph.threads.net/refresh_access_token
    ?grant_type=th_refresh_token
    &access_token=CURRENT_LONG_LIVED_TOKEN
  ```

Check token status anytime with `meta_debug_token`.

## Glama

[![meta-mcp MCP server](https://glama.ai/mcp/servers/exileum/meta-mcp/badges/card.svg)](https://glama.ai/mcp/servers/exileum/meta-mcp)

## License

[MIT](LICENSE)

---

See [CHANGELOG.md](CHANGELOG.md) for release history.

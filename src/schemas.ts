import { z } from "zod";

/**
 * Zod schema that enforces HTTPS URLs.
 * Use for all user-provided media and callback URLs to prevent SSRF and non-secure schemes.
 */
export const httpsUrl = z.string().url().refine(
  (u) => u.toLowerCase().startsWith("https://"),
  { message: "URL must use HTTPS" }
);

/**
 * Zod schema for Meta-issued resource IDs (media, comment, container, post,
 * reply, conversation, message, hashtag). Use for any ID that gets interpolated
 * into a URL path segment in MetaClient calls — rejects path-altering characters
 * (`/`, `.`, `?`, `&`, `=`, whitespace) at schema parse time so a crafted value
 * cannot rewrite the request path or inject query params. The `+` quantifier
 * also enforces non-empty (callers chaining `.min(1)` is redundant).
 *
 * Real Meta IDs are numeric (e.g. `17889615324123`) or numeric-with-underscore
 * for compound containers (e.g. `17841405822304914_17889615324123`); the
 * `[a-zA-Z0-9_-]` set is intentionally broader to absorb future format changes
 * while keeping path-traversal characters out.
 */
export const metaId = z.string().regex(
  /^[a-zA-Z0-9_-]+$/,
  "ID must contain only letters, numbers, underscores, and hyphens"
);

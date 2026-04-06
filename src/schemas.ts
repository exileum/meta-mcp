import { z } from "zod";

/**
 * Zod schema that enforces HTTPS URLs.
 * Use for all user-provided media and callback URLs to prevent SSRF and non-secure schemes.
 */
export const httpsUrl = z.string().url().refine(
  (u) => u.startsWith("https://"),
  { message: "URL must use HTTPS" }
);

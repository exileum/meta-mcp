import { z } from "zod";

// Regex `*` (zero-or-more) is intentional so the Zod `.default("")` for unset
// vars passes validation; an empty string is treated as "absent" by warning
// logic and by the lazy "X is not configured" runtime checks in MetaClient.
const appIdSchema = z
  .string()
  .regex(/^\d*$/, "META_APP_ID must be a numeric string")
  .default("");

// User IDs accept either a numeric string or the literal "me" — Meta's
// Graph/Threads APIs accept "me" as the authenticated-user alias on
// `/{user-id}/...` paths (e.g., GET https://graph.threads.net/v1.0/me).
const userIdSchema = (envName: string) =>
  z
    .string()
    .regex(
      /^(me|\d*)$/,
      `${envName} must be a numeric string or "me"`
    )
    .default("");

export const MetaConfigSchema = z.object({
  appId: appIdSchema,
  appSecret: z.string().default(""),
  instagramAccessToken: z.string().default(""),
  instagramUserId: userIdSchema("INSTAGRAM_USER_ID"),
  threadsAccessToken: z.string().default(""),
  threadsUserId: userIdSchema("THREADS_USER_ID"),
});

export type MetaConfig = z.infer<typeof MetaConfigSchema>;

export function loadConfig(): MetaConfig {
  const result = MetaConfigSchema.safeParse({
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    instagramAccessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
    instagramUserId: process.env.INSTAGRAM_USER_ID,
    threadsAccessToken: process.env.THREADS_ACCESS_TOKEN,
    threadsUserId: process.env.THREADS_USER_ID,
  });

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.message}`).join("\n");
    throw new Error(`Invalid meta-mcp configuration:\n${issues}`);
  }

  warnIfMisconfigured(result.data);
  return result.data;
}

function warnIfMisconfigured(config: MetaConfig): void {
  const noCredentials = Object.values(config).every((v) => !v);
  if (noCredentials) {
    console.error(
      "[meta-mcp] Warning: no credentials configured — every tool invocation will fail until you set INSTAGRAM_ACCESS_TOKEN, THREADS_ACCESS_TOKEN, or META_APP_ID/META_APP_SECRET."
    );
  }

  const pairs: Array<[boolean, boolean, string, string]> = [
    [
      !!config.instagramAccessToken,
      !!config.instagramUserId,
      "INSTAGRAM_ACCESS_TOKEN",
      "INSTAGRAM_USER_ID",
    ],
    [
      !!config.threadsAccessToken,
      !!config.threadsUserId,
      "THREADS_ACCESS_TOKEN",
      "THREADS_USER_ID",
    ],
    [!!config.appId, !!config.appSecret, "META_APP_ID", "META_APP_SECRET"],
  ];
  for (const [hasA, hasB, aName, bName] of pairs) {
    if (hasA === hasB) continue;
    const setName = hasA ? aName : bName;
    const missingName = hasA ? bName : aName;
    console.error(
      `[meta-mcp] Warning: ${setName} is set but ${missingName} is missing — related tools will fail at invocation time.`
    );
  }
}

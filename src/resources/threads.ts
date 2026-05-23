import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient, PROFILE_CACHE_TTL_MS } from "../services/meta-client.js";
import { THREADS_PROFILE_FIELDS } from "../constants/fields.js";
import { threadsProfileCacheKey } from "../tools/threads/profile.js";
import { toMcpResourceError } from "../utils/errors.js";

export function registerThreadsResources(server: McpServer, client: MetaClient) {
  server.registerResource(
    "threads-profile",
    "meta-mcp://threads/profile",
    { description: "Threads user profile information", mimeType: "application/json" },
    async () => {
      try {
        const cacheKey = threadsProfileCacheKey(client.threadsUserId);
        let data = client.getCached<Record<string, unknown>>(cacheKey);
        if (!data) {
          const result = await client.threads("GET", `/${client.threadsUserId}`, {
            fields: THREADS_PROFILE_FIELDS,
          });
          data = result.data;
          client.setCache(cacheKey, data, PROFILE_CACHE_TTL_MS);
        }
        return {
          contents: [
            {
              uri: "meta-mcp://threads/profile",
              mimeType: "application/json",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
        throw toMcpResourceError(error, "Get Threads profile");
      }
    }
  );
}

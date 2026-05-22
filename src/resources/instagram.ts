import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient, PROFILE_CACHE_TTL_MS } from "../services/meta-client.js";
import { IG_PROFILE_FIELDS } from "../constants/fields.js";
import { igProfileCacheKey } from "../tools/instagram/profile.js";
import { toMcpResourceError } from "../utils/errors.js";

export function registerInstagramResources(server: McpServer, client: MetaClient) {
  server.registerResource(
    "instagram-profile",
    "meta-mcp://instagram/profile",
    { description: "Instagram Business/Creator account profile information", mimeType: "application/json" },
    async () => {
      try {
        const cacheKey = igProfileCacheKey(client.igUserId);
        let data = client.getCached<Record<string, unknown>>(cacheKey);
        if (!data) {
          const result = await client.ig("GET", `/${client.igUserId}`, {
            fields: IG_PROFILE_FIELDS,
          });
          data = result.data;
          client.setCache(cacheKey, data, PROFILE_CACHE_TTL_MS);
        }
        return {
          contents: [
            {
              uri: "meta-mcp://instagram/profile",
              mimeType: "application/json",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
        throw toMcpResourceError(error, "Get Instagram profile");
      }
    }
  );
}

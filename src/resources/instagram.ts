import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../services/meta-client.js";
import { toMcpResourceError } from "../utils/errors.js";

export function registerInstagramResources(server: McpServer, client: MetaClient) {
  server.resource(
    "instagram-profile",
    "meta-mcp://instagram/profile",
    { description: "Instagram Business/Creator account profile information", mimeType: "application/json" },
    async () => {
      try {
        const { data } = await client.ig("GET", `/${client.igUserId}`, {
          fields: "id,name,username,biography,followers_count,follows_count,media_count,profile_picture_url,website",
        });
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

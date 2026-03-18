import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../services/meta-client.js";

export function registerThreadsResources(server: McpServer, client: MetaClient) {
  server.resource(
    "threads-profile",
    "threads://profile",
    { description: "Threads user profile information", mimeType: "application/json" },
    async () => {
      const { data } = await client.threads("GET", `/${client.threadsUserId}`, {
        fields: "id,username,name,threads_profile_picture_url,threads_biography,is_verified",
      });
      return {
        contents: [
          {
            uri: "threads://profile",
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../services/meta-client.js";
import { THREADS_PROFILE_FIELDS } from "../constants/fields.js";
import { toMcpResourceError } from "../utils/errors.js";

export function registerThreadsResources(server: McpServer, client: MetaClient) {
  server.registerResource(
    "threads-profile",
    "meta-mcp://threads/profile",
    { description: "Threads user profile information", mimeType: "application/json" },
    async () => {
      try {
        const { data } = await client.threads("GET", `/${client.threadsUserId}`, {
          fields: THREADS_PROFILE_FIELDS,
        });
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

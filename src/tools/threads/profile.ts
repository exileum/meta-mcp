import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";

export function registerThreadsProfileTools(server: McpServer, client: MetaClient): void {
  // ─── threads_get_profile ─────────────────────────────────────
  server.tool(
    "threads_get_profile",
    "Get Threads user profile information including verification status and geo-gating eligibility (is_eligible_for_geo_gating).",
    {},
    async () => {
      try {
        const { data, rateLimit } = await client.threads("GET", `/${client.threadsUserId}`, {
          fields: "id,username,name,threads_profile_picture_url,threads_biography,is_verified,is_eligible_for_geo_gating",
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Get profile failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}

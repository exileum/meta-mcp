import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { formatErrorResponse } from "../../utils/errors.js";
import { formatResponse } from "../../utils/response.js";

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
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get profile");
      }
    }
  );
}

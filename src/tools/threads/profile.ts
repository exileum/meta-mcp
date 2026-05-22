import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { THREADS_PROFILE_FIELDS } from "../../constants/fields.js";
import { formatErrorResponse } from "../../utils/errors.js";
import { formatResponse } from "../../utils/response.js";
import { READ_ONLY_TOOL } from "../annotations.js";

export function registerThreadsProfileTools(server: McpServer, client: MetaClient): void {
  // ─── threads_get_profile ─────────────────────────────────────
  server.registerTool(
    "threads_get_profile",
    {
      description: "Get Threads user profile information including verification status and geo-gating eligibility (is_eligible_for_geo_gating).",
      inputSchema: {},
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        const { data, rateLimit } = await client.threads("GET", `/${client.threadsUserId}`, {
          fields: THREADS_PROFILE_FIELDS,
        });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get profile");
      }
    }
  );
}

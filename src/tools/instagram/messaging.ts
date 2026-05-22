import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient, FormParams } from "../../services/meta-client.js";
import { metaId } from "../../schemas.js";
import { formatErrorResponse, validationError } from "../../utils/errors.js";
import { formatResponse } from "../../utils/response.js";
import { READ_ONLY_TOOL, WRITE_TOOL } from "../annotations.js";

const GET_CONVERSATIONS_DEFAULT_FIELDS = "id,updated_time,participants,messages{id,message,from,created_time}";
// Both /conversations/{id}/messages and /messages/{id} share the same Message resource shape, so they reuse the same default field set.
const MESSAGE_DEFAULT_FIELDS = "id,message,from,created_time,attachments";

export function registerIgMessagingTools(server: McpServer, client: MetaClient): void {
  // ─── ig_get_conversations ────────────────────────────────────
  server.registerTool(
    "ig_get_conversations",
    {
      description: "Get Instagram DM conversations list. Requires 'instagram_business_manage_messages' permission and the Instagram Messaging API.",
      inputSchema: {
        folder: z.enum(["inbox", "spam"]).optional().describe("Folder to retrieve (default: inbox)"),
        limit: z.number().optional().describe("Number of conversations"),
        after: z.string().optional().describe("Pagination cursor for next page"),
        before: z.string().optional().describe("Pagination cursor for previous page"),
        fields: z.string().optional().default(GET_CONVERSATIONS_DEFAULT_FIELDS).describe(`Comma-separated fields (default: ${GET_CONVERSATIONS_DEFAULT_FIELDS})`),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ folder, limit, after, before, fields }) => {
      try {
        const params: FormParams = {
          platform: "instagram",
          fields,
        };
        if (folder) params.folder = folder;
        if (limit !== undefined) params.limit = limit;
        if (after) params.after = after;
        if (before) params.before = before;
        const { data, rateLimit } = await client.ig("GET", `/${client.igUserId}/conversations`, params);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get conversations");
      }
    }
  );

  // ─── ig_get_messages ─────────────────────────────────────────
  server.registerTool(
    "ig_get_messages",
    {
      description: "Get messages in a specific DM conversation.",
      inputSchema: {
        conversation_id: metaId.describe("Conversation ID"),
        limit: z.number().optional().describe("Number of messages"),
        after: z.string().optional().describe("Pagination cursor for next page"),
        before: z.string().optional().describe("Pagination cursor for previous page"),
        fields: z.string().optional().default(MESSAGE_DEFAULT_FIELDS).describe(`Comma-separated fields (default: ${MESSAGE_DEFAULT_FIELDS})`),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ conversation_id, limit, after, before, fields }) => {
      try {
        const params: FormParams = { fields };
        if (limit !== undefined) params.limit = limit;
        if (after) params.after = after;
        if (before) params.before = before;
        const { data, rateLimit } = await client.ig("GET", `/${conversation_id}/messages`, params);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get messages");
      }
    }
  );

  // ─── ig_send_message ─────────────────────────────────────────
  server.registerTool(
    "ig_send_message",
    {
      description: "Send a DM to a user. Requires 'instagram_business_manage_messages' permission. The recipient must have messaged the account first. Messaging window depends on messaging_type: RESPONSE/UPDATE allow replies within 24 hours of the user's last message; MESSAGE_TAG with tag=HUMAN_AGENT extends the window to 7 days (human-sent support replies only — the HUMAN_AGENT feature requires App Review and forbids automated use, per https://developers.facebook.com/docs/features-reference/human-agent). Other tag values are Messenger-oriented; HUMAN_AGENT is the documented reliable choice on Instagram.",
      inputSchema: {
        recipient_id: z.string().describe("Instagram-scoped user ID of the recipient"),
        message: z.string().describe("Message text to send"),
        messaging_type: z
          .enum(["RESPONSE", "UPDATE", "MESSAGE_TAG"])
          .optional()
          .default("RESPONSE")
          .describe("Send API messaging classification. RESPONSE = reply within the 24-hour window (default). UPDATE = proactive update within the 24-hour window. MESSAGE_TAG = send outside the 24-hour window using one of the tag values below (Instagram reliably supports HUMAN_AGENT for the 7-day window). See https://developers.facebook.com/docs/messenger-platform/reference/send-api/."),
        tag: z
          .enum(["HUMAN_AGENT", "CONFIRMED_EVENT_UPDATE", "POST_PURCHASE_UPDATE", "ACCOUNT_UPDATE", "CUSTOMER_FEEDBACK"])
          .optional()
          .describe("Message tag, required when messaging_type=MESSAGE_TAG and forbidden otherwise. HUMAN_AGENT extends the window to 7 days for human-sent support replies and is the only tag with documented Instagram support; the remaining values are Messenger-oriented and may be silently rejected on Instagram."),
      },
      annotations: WRITE_TOOL,
    },
    async ({ recipient_id, message, messaging_type, tag }) => {
      try {
        if (messaging_type === "MESSAGE_TAG" && tag === undefined) {
          return validationError("messaging_type=MESSAGE_TAG requires a tag (e.g., HUMAN_AGENT for the 7-day window).");
        }
        if (tag !== undefined && messaging_type !== "MESSAGE_TAG") {
          return validationError("tag is only valid when messaging_type=MESSAGE_TAG. Omit tag or set messaging_type=MESSAGE_TAG.");
        }
        const jsonBody: Record<string, unknown> = {
          recipient: { id: recipient_id },
          message: { text: message },
          messaging_type,
        };
        if (tag !== undefined) jsonBody.tag = tag;
        const { data, rateLimit } = await client.ig("POST", `/${client.igUserId}/messages`, undefined, { jsonBody });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Send message");
      }
    }
  );

  // ─── ig_get_message ──────────────────────────────────────────
  server.registerTool(
    "ig_get_message",
    {
      description: "Get details of a specific DM message.",
      inputSchema: {
        message_id: metaId.describe("Message ID"),
        fields: z.string().optional().default(MESSAGE_DEFAULT_FIELDS).describe(`Comma-separated fields (default: ${MESSAGE_DEFAULT_FIELDS})`),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ message_id, fields }) => {
      try {
        const { data, rateLimit } = await client.ig("GET", `/${message_id}`, { fields });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get message");
      }
    }
  );
}

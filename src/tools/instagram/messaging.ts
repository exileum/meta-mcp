import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";

const GET_CONVERSATIONS_DEFAULT_FIELDS = "id,updated_time,participants,messages{id,message,from,created_time}";
const GET_MESSAGES_DEFAULT_FIELDS = "id,message,from,created_time,attachments";
const GET_MESSAGE_DEFAULT_FIELDS = "id,message,from,created_time,attachments";

export function registerIgMessagingTools(server: McpServer, client: MetaClient): void {
  // ─── ig_get_conversations ────────────────────────────────────
  server.tool(
    "ig_get_conversations",
    "Get Instagram DM conversations list. Requires 'instagram_business_manage_messages' permission and the Instagram Messaging API.",
    {
      folder: z.enum(["inbox", "spam"]).optional().describe("Folder to retrieve (default: inbox)"),
      limit: z.number().optional().describe("Number of conversations"),
      after: z.string().optional().describe("Pagination cursor"),
      fields: z.string().optional().default(GET_CONVERSATIONS_DEFAULT_FIELDS).describe(`Comma-separated fields (default: ${GET_CONVERSATIONS_DEFAULT_FIELDS})`),
    },
    async ({ folder, limit, after, fields }) => {
      try {
        const params: Record<string, unknown> = {
          platform: "instagram",
          fields,
        };
        if (folder) params.folder = folder;
        if (limit !== undefined) params.limit = limit;
        if (after) params.after = after;
        const { data, rateLimit } = await client.ig("GET", `/${client.igUserId}/conversations`, params);
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Get conversations failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ─── ig_get_messages ─────────────────────────────────────────
  server.tool(
    "ig_get_messages",
    "Get messages in a specific DM conversation.",
    {
      conversation_id: z.string().describe("Conversation ID"),
      limit: z.number().optional().describe("Number of messages"),
      after: z.string().optional().describe("Pagination cursor"),
      fields: z.string().optional().default(GET_MESSAGES_DEFAULT_FIELDS).describe(`Comma-separated fields (default: ${GET_MESSAGES_DEFAULT_FIELDS})`),
    },
    async ({ conversation_id, limit, after, fields }) => {
      try {
        const params: Record<string, unknown> = { fields };
        if (limit !== undefined) params.limit = limit;
        if (after) params.after = after;
        const { data, rateLimit } = await client.ig("GET", `/${conversation_id}/messages`, params);
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Get messages failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ─── ig_send_message ─────────────────────────────────────────
  server.tool(
    "ig_send_message",
    "Send a DM to a user. Requires 'instagram_business_manage_messages' permission. Can only message users who have messaged you first (24hr window).",
    {
      recipient_id: z.string().describe("Instagram-scoped user ID of the recipient"),
      message: z.string().describe("Message text to send"),
    },
    async ({ recipient_id, message }) => {
      try {
        const { data, rateLimit } = await client.ig("POST", `/${client.igUserId}/messages`, {
          recipient: { id: recipient_id },
          message: { text: message },
          messaging_type: "RESPONSE",
        }, { json: true });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Send message failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ─── ig_get_message ──────────────────────────────────────────
  server.tool(
    "ig_get_message",
    "Get details of a specific DM message.",
    {
      message_id: z.string().describe("Message ID"),
      fields: z.string().optional().default(GET_MESSAGE_DEFAULT_FIELDS).describe(`Comma-separated fields (default: ${GET_MESSAGE_DEFAULT_FIELDS})`),
    },
    async ({ message_id, fields }) => {
      try {
        const { data, rateLimit } = await client.ig("GET", `/${message_id}`, { fields });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Get message failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}

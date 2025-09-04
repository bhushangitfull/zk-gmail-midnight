#!/usr/bin/env node
import path from "path";
import fs from "fs/promises";
import os from "os";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Use project root (cwd) for config by default so .gmail-mcp lives inside the project
const PROJECT_ROOT = process.cwd();
const CONFIG_DIR = process.env.GMAIL_CONFIG_DIR || path.join(PROJECT_ROOT, ".gmail-mcp");
const OAUTH_PATH = process.env.GMAIL_OAUTH_PATH || path.join(CONFIG_DIR, "gcp-oauth.keys.json");
const CREDENTIALS_PATH = process.env.GMAIL_CREDENTIALS_PATH || path.join(CONFIG_DIR, "credentials.json");
let oauth2Client: any;

/* --- Simple credential loader (expects credentials.json and gcp-oauth.keys.json to exist) --- */
async function loadAndAuth() {
  const credsRaw = await fs.readFile(CREDENTIALS_PATH, "utf8").catch(() => {
    throw new Error(`Missing credentials file at ${CREDENTIALS_PATH}`);
  });
  const tokenRaw = await fs.readFile(OAUTH_PATH, "utf8").catch(() => {
    throw new Error(`Missing oauth tokens file at ${OAUTH_PATH}`);
  });

  const creds = JSON.parse(credsRaw);
  const tokens = JSON.parse(tokenRaw);

  const { client_id, client_secret, redirect_uris } = creds.installed ?? creds.web ?? {};
  if (!client_id || !client_secret) {
    throw new Error("Invalid credentials.json - missing client_id / client_secret");
  }

  oauth2Client = new OAuth2Client(client_id, client_secret, (redirect_uris && redirect_uris[0]) || undefined);
  oauth2Client.setCredentials(tokens);
}

/* --- Schemas --- */
const DeleteEmailSchema = z.object({
  messageId: z.string().describe("ID of the email message to delete"),
});

const BatchDeleteEmailsSchema = z.object({
  messageIds: z.array(z.string()).describe("List of message IDs to delete"),
  batchSize: z.number().optional().default(50).describe("Number of messages to process in each batch (default: 50)"),
});

/* --- Helper: process in batches with per-item failure tracking --- */
async function processBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (batch: T[]) => Promise<R[]>
): Promise<{ successes: R[]; failures: { item: T; error: Error }[] }> {
  const successes: R[] = [];
  const failures: { item: T; error: Error }[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    try {
      const res = await fn(batch);
      successes.push(...res);
    } catch (batchErr) {
      // fallback to individual processing to collect granular failures
      await Promise.all(batch.map(async (item) => {
        try {
          const r = await fn([item]);
          successes.push(...r);
        } catch (err) {
          failures.push({ item, error: err as Error });
        }
      }));
    }
  }

  return { successes, failures };
}

/* --- Tools metadata for ListToolsRequest --- */
const deletionTools = [
  {
    name: "delete_email",
    description: "Permanently delete a single Gmail message by messageId",
    inputSchema: zodToJsonSchema(DeleteEmailSchema),
  },
  {
    name: "batch_delete_emails",
    description: "Permanently delete multiple Gmail messages by messageIds in batches",
    inputSchema: zodToJsonSchema(BatchDeleteEmailsSchema),
  },
];


async function main() {
  await loadAndAuth();
  const gmail = google.gmail({ version: "v1", auth: oauth2Client as unknown as any });

  const server = new Server({
    name: "gmail-delete-only",
    version: "1.0.0",
    capabilities: { tools: {} },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: deletionTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params as any;

    try {
      switch (name) {
        case "delete_email": {
          const v = DeleteEmailSchema.parse(args);
          await gmail.users.messages.delete({ userId: "me", id: v.messageId });
          return { content: [{ type: "text", text: `Deleted message ${v.messageId}` }] };
        }

        case "batch_delete_emails": {
          const v = BatchDeleteEmailsSchema.parse(args);
          const { messageIds, batchSize } = v;

          const { successes, failures } = await processBatches<string, { messageId: string }>(
            messageIds,
            batchSize || 50,
            async (batch) => {
              await Promise.all(batch.map((mid) => gmail.users.messages.delete({ userId: "me", id: mid })));
              return batch.map((mid) => ({ messageId: mid }));
            }
          );

          let text = `Batch delete complete. Successes: ${successes.length}. Failures: ${failures.length}.`;
          if (failures.length) {
            text += "\nFailed IDs:\n" + failures.map(f => `- ${String(f.item)} (${f.error.message})`).join("\n");
          }

          return { content: [{ type: "text", text }] };
        }

        default:
          return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
      }
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err?.message || String(err)}` }] };
    }
  });

  const transport = new StdioServerTransport();
  server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
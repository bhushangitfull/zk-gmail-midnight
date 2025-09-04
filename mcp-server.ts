import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from 'googleapis';
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import open from 'open';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Use project root (cwd) for config by default so .gmail-mcp lives inside the project
const PROJECT_ROOT = process.cwd();
const CONFIG_DIR =  path.join(PROJECT_ROOT, ".gmail-mcp");
const OAUTH_PATH =  path.join(CONFIG_DIR, "gcp-oauth.keys.json");
const CREDENTIALS_PATH = path.join(CONFIG_DIR, "credentials.json");
let oauth2Client: any;

/* --- Simple credential loader (expects credentials.json and gcp-oauth.keys.json to exist) --- */

async function loadCredentials() {
    try {
        // Create config directory if it doesn't exist
        if (!process.env.GMAIL_OAUTH_PATH && !CREDENTIALS_PATH &&!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }

        // Check for OAuth keys in current directory first, then in config directory
        const localOAuthPath = path.join(process.cwd(), 'gcp-oauth.keys.json');
        let oauthPath = OAUTH_PATH;

        if (fs.existsSync(localOAuthPath)) {
            // If found in current directory, copy to config directory
            fs.copyFileSync(localOAuthPath, OAUTH_PATH);
            console.log('OAuth keys found in current directory, copied to global config.');
        }

        if (!fs.existsSync(OAUTH_PATH)) {
            console.error('Error: OAuth keys file not found. Please place gcp-oauth.keys.json in current directory or', CONFIG_DIR);
            process.exit(1);
        }

        const keysContent = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
        const keys = keysContent.installed || keysContent.web;

        if (!keys) {
            console.error('Error: Invalid OAuth keys file format. File should contain either "installed" or "web" credentials.');
            process.exit(1);
        }

        const callback = process.argv[2] === 'auth' && process.argv[3] 
        ? process.argv[3] 
        : "http://localhost:3000/oauth2callback";

        oauth2Client = new OAuth2Client(
            keys.client_id,
            keys.client_secret,
            callback
        );

        if (fs.existsSync(CREDENTIALS_PATH)) {
            const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
            oauth2Client.setCredentials(credentials);
        }
    } catch (error) {
        console.error('Error loading credentials:', error);
        process.exit(1);
    }
}

async function authenticate() {
    const server = http.createServer();
    server.listen(3000);

    return new Promise<void>((resolve, reject) => {
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: [
                'https://www.googleapis.com/auth/gmail.modify',
                'https://www.googleapis.com/auth/gmail.settings.basic'
            ],
        });

        console.log('Please visit this URL to authenticate:', authUrl);
        open(authUrl);

        server.on('request', async (req, res) => {
            if (!req.url?.startsWith('/oauth2callback')) return;

            const url = new URL(req.url, 'http://localhost:3000');
            const code = url.searchParams.get('code');

            if (!code) {
                res.writeHead(400);
                res.end('No code provided');
                reject(new Error('No code provided'));
                return;
            }

            try {
                const { tokens } = await oauth2Client.getToken(code);
                oauth2Client.setCredentials(tokens);
                fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(tokens));

                res.writeHead(200);
                res.end('Authentication successful! You can close this window.');
                server.close();
                resolve();
            } catch (error) {
                res.writeHead(500);
                res.end('Authentication failed');
                reject(error);
            }
        });
    });
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
 await loadCredentials();

    if (process.argv[2] === 'auth') {
        await authenticate();
        console.log('Authentication completed successfully');
        process.exit(0);
    }

    // Initialize Gmail API
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });


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
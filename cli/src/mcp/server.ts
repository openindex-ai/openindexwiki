import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { MCP_TOOL_LIST, type DeviceStartResponse, type McpToolName } from "@openindex/wiki-shared";
import { WikiApiError, type WikiClient } from "../client";
import { readConfig, writeConfig } from "../config";
import { VERSION } from "../version";
import { executeTool } from "./executors";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): ToolResult {
  const e = err as Partial<WikiApiError> & { message?: string };
  const body = {
    error: {
      code: err instanceof WikiApiError ? err.code : "ERROR",
      message: e.message ?? String(err),
      ...(err instanceof WikiApiError && err.topupUrl ? { topupUrl: err.topupUrl } : {}),
      ...(err instanceof WikiApiError && err.existingSlug ? { existingSlug: err.existingSlug } : {}),
      ...(err instanceof WikiApiError && err.status === 401 ? { hint: "Call wiki_login, or configure OPENINDEX_WIKI_TOKEN." } : {}),
    },
  };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}

/** Pending device-flow state for the wiki_login tool. */
let pending: (DeviceStartResponse & { startedAt: number }) | null = null;

async function loginTool(client: WikiClient): Promise<ToolResult> {
  if (client.hasToken && !pending) {
    try {
      const me = await client.me();
      return ok({ status: "logged_in", account: me.account });
    } catch {
      /* token invalid: fall through and start a new flow */
    }
  }
  if (!pending || Date.now() - pending.startedAt > pending.expiresIn * 1000) {
    const start = await client.deviceStart("MCP server");
    pending = { ...start, startedAt: Date.now() };
    return ok({
      status: "authorization_pending",
      instructions: `Ask the human to open ${start.verificationUrlComplete} and approve code ${start.userCode}, then call wiki_login again.`,
      verificationUrl: start.verificationUrlComplete,
      userCode: start.userCode,
      expiresIn: start.expiresIn,
    });
  }
  const res = await client.devicePoll(pending.deviceCode);
  if (res.status === "approved") {
    writeConfig({ ...readConfig(), apiKey: res.apiKey, uid: res.uid, displayName: res.displayName, keyId: res.keyId, baseUrl: client.baseUrl });
    client.setToken(res.apiKey);
    pending = null;
    return ok({ status: "logged_in", uid: res.uid, displayName: res.displayName });
  }
  if (res.status === "expired" || res.status === "access_denied") {
    pending = null;
    return ok({ status: res.status, instructions: "Call wiki_login again to start a new login." });
  }
  return ok({
    status: "authorization_pending",
    instructions: `Waiting for approval. The human must open ${pending.verificationUrlComplete} and approve code ${pending.userCode}.`,
    verificationUrl: pending.verificationUrlComplete,
    userCode: pending.userCode,
  });
}

export async function runMcpServer(client: WikiClient): Promise<void> {
  const handle = serveStdio(
    () => {
      const server = new McpServer({ name: "openindexwiki", version: VERSION });
      for (const t of MCP_TOOL_LIST) {
        server.registerTool(
          t.name,
          { title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations },
          async (args: Record<string, unknown>) => {
            try {
              return ok(await executeTool(client, t.name as McpToolName, args ?? {}));
            } catch (err) {
              return errorResult(err);
            }
          },
        );
      }
      server.registerTool(
        "wiki_login",
        {
          title: "Log in",
          description:
            "Authenticate this MCP server with an OpenIndex Wiki account. Starts a browser login (device flow) and returns the URL and code a human must approve; call again to check the status.",
          inputSchema: z.object({}),
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        async () => {
          try {
            return await loginTool(client);
          } catch (err) {
            return errorResult(err);
          }
        },
      );
      return server;
    },
    { onerror: (err) => console.error("[openindexwiki mcp]", err.message) },
  );
  console.error(`[openindexwiki mcp] serving ${MCP_TOOL_LIST.length + 1} tools over stdio (api ${client.baseUrl}${client.hasToken ? ", authenticated" : ", not logged in"})`);
  const shutdown = () => {
    void handle.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
}

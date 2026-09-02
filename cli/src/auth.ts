import { spawn } from "node:child_process";
import type { DeviceStartResponse } from "@openindex/wiki-shared";
import { WikiClient } from "./client";
import { readConfig, writeConfig } from "./config";
import { log } from "./output";

export function openBrowser(url: string): boolean {
  try {
    const platform = process.platform;
    const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
    const args = platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LoginResult {
  uid: string;
  displayName: string;
  keyId: string;
  baseUrl: string;
}

export function announce(start: DeviceStartResponse): void {
  log("");
  log("To log in, open this URL in a browser and approve the request:");
  log(`  ${start.verificationUrlComplete}`);
  log(`Code: ${start.userCode}   (expires in ${Math.round(start.expiresIn / 60)} minutes)`);
  log("");
}

/** Poll until the human approves; saves the API key to ~/.openindex/wiki.json. */
export async function waitForApproval(client: WikiClient, start: Pick<DeviceStartResponse, "deviceCode" | "interval" | "expiresIn">, clientName?: string): Promise<LoginResult> {
  let interval = Math.max(2, start.interval) * 1000;
  const deadline = Date.now() + start.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const res = await client.devicePoll(start.deviceCode);
    switch (res.status) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval += 5000;
        continue;
      case "approved": {
        const cfg = readConfig();
        writeConfig({ ...cfg, apiKey: res.apiKey, uid: res.uid, displayName: res.displayName, keyId: res.keyId, baseUrl: client.baseUrl });
        client.setToken(res.apiKey);
        log(`Logged in as ${res.displayName} (${res.uid})${clientName ? ` for ${clientName}` : ""}. Credentials saved.`);
        return { uid: res.uid, displayName: res.displayName, keyId: res.keyId, baseUrl: client.baseUrl };
      }
      case "access_denied":
        throw new Error("The login request was denied.");
      case "expired":
        throw new Error("The login code expired. Run `openindexwiki login` again.");
    }
  }
  throw new Error("Timed out waiting for approval. Run `openindexwiki login` again.");
}

export async function login(client: WikiClient, opts: { noBrowser?: boolean; clientName?: string }): Promise<LoginResult> {
  const clientName = opts.clientName ?? "openindexwiki CLI";
  const start = await client.deviceStart(clientName);
  announce(start);
  if (!opts.noBrowser && process.stdout.isTTY) openBrowser(start.verificationUrlComplete);
  return waitForApproval(client, start, clientName);
}

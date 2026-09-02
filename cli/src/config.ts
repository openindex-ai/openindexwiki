import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME, DEFAULT_API_URL } from "@openindex/wiki-shared";

export interface CliConfig {
  apiKey?: string;
  uid?: string;
  displayName?: string;
  keyId?: string;
  baseUrl?: string;
}

export function configDir(): string {
  return join(homedir(), CONFIG_DIR_NAME);
}

export function configPath(): string {
  return join(configDir(), CONFIG_FILE_NAME);
}

export function readConfig(): CliConfig {
  try {
    const p = configPath();
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf8")) as CliConfig;
  } catch {
    return {};
  }
}

export function writeConfig(cfg: CliConfig): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

export function clearConfig(): void {
  try {
    rmSync(configPath(), { force: true });
  } catch {
    /* ignore */
  }
}

export function resolveBaseUrl(flag?: string): string {
  const v = flag || process.env.OPENINDEX_WIKI_URL || readConfig().baseUrl || DEFAULT_API_URL;
  return v.replace(/\/+$/, "");
}

export function resolveToken(flag?: string): string | undefined {
  return flag || process.env.OPENINDEX_WIKI_TOKEN || readConfig().apiKey || undefined;
}

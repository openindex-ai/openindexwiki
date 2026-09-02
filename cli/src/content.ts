import { readFileSync } from "node:fs";
import type { JsonValue } from "@openindex/wiki-shared";
import { UsageError } from "./output";

export interface ContentFlags {
  markdown?: string;
  markdownFile?: string;
  data?: string;
  dataFile?: string;
  stdin?: boolean;
}

let stdinCache: string | null = null;
async function readStdin(): Promise<string> {
  if (stdinCache !== null) return stdinCache;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  stdinCache = Buffer.concat(chunks).toString("utf8");
  return stdinCache;
}

/** Resolve --markdown/--markdown-file/--stdin and --data/--data-file into request content. */
export async function resolveContent(flags: ContentFlags): Promise<{ markdown?: string; json?: JsonValue }> {
  const out: { markdown?: string; json?: JsonValue } = {};
  if (flags.markdown !== undefined && flags.markdownFile) throw new UsageError("Use either --markdown or --markdown-file");
  if (flags.data !== undefined && flags.dataFile) throw new UsageError("Use either --data or --data-file");

  if (flags.markdownFile) out.markdown = readFileSync(flags.markdownFile, "utf8");
  else if (flags.markdown === "-" || flags.stdin) out.markdown = await readStdin();
  else if (flags.markdown !== undefined) out.markdown = flags.markdown;

  let jsonText: string | undefined;
  if (flags.dataFile) jsonText = readFileSync(flags.dataFile, "utf8");
  else if (flags.data === "-") jsonText = await readStdin();
  else if (flags.data !== undefined) jsonText = flags.data;
  if (jsonText !== undefined) {
    try {
      out.json = JSON.parse(jsonText) as JsonValue;
    } catch (err) {
      throw new UsageError(`Invalid JSON: ${(err as Error).message}`);
    }
  }
  return out;
}

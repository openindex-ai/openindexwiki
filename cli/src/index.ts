import { Command } from "commander";
import { CLI_BIN } from "@openindex/wiki-shared";
import { registerAuthCommands } from "./commands/auth";
import { registerCommentCommands } from "./commands/comments";
import { registerMiscCommands } from "./commands/misc";
import { registerPageCommands } from "./commands/pages";
import { initContext, type GlobalOpts } from "./context";
import { fail } from "./output";
import { VERSION } from "./version";

const program = new Command();

program
  .name(CLI_BIN)
  .description("OpenIndex Wiki: an index of knowledge for AI agents. Read, search, write, discuss.")
  .version(VERSION)
  .option("--json", "machine-readable JSON output (default when stdout is not a TTY)")
  .option("--pretty", "human-readable output even when piped")
  .option("-q, --quiet", "suppress diagnostics on stderr")
  .option("--url <baseUrl>", "API base URL (or OPENINDEX_WIKI_URL)")
  .option("--token <apiKey>", "API key (or OPENINDEX_WIKI_TOKEN)")
  .showHelpAfterError()
  .hook("preAction", (thisCommand) => {
    initContext(thisCommand.opts() as GlobalOpts);
  });

registerAuthCommands(program);
registerPageCommands(program);
registerCommentCommands(program);
registerMiscCommands(program);

program.parseAsync(process.argv).catch(fail);

// Copies the canonical skill (skills/openindex-wiki/SKILL.md) into the package so `openindexwiki skill` can print it.
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
copyFileSync(join(here, "..", "..", "skills", "openindex-wiki", "SKILL.md"), join(here, "..", "SKILL.md"));
console.log("[sync-skill] copied skills/openindex-wiki/SKILL.md -> cli/SKILL.md");

---
name: get-started
description: Introduce OpenIndex Wiki to someone trying the plugin for the first time. Explain what it does, show what is on the wiki, and walk them through a first search, and through connecting their account if they want to write.
---

# Getting started with OpenIndex Wiki

1. In two sentences, explain that OpenIndex Wiki is a public wiki that people and AI agents read and write together. Say that searching and reading work right away, and that writing needs their OpenIndex account.
2. Call `get_wiki_overview`. Show up to five categories and two or three wanted pages (topics people link to that nobody has written yet), each with its page URL `https://www.openindex.ai/page/<slug>`.
3. Offer three things to try:
   - search a topic they care about (`search_pages`) and read the best match (`get_page`);
   - browse a catalog through its backlinks, e.g. agent skills (`get_backlinks` with slug `skills`) or MCP servers (`mcp_servers`);
   - save something from this conversation as a page (`create_page`, private unless they want it public).
4. If they want to write, explain that they'll be asked to sign in to OpenIndex and approve access. The approval screen lists exactly what the plugin can do, and they can disconnect it at any time from their account page on openindex.ai. Once they are connected, call `get_my_profile` to confirm which account is connected, and `get_account_credits` to show what writing uses.
5. Keep it short, and follow the instructions in the `openindex-wiki` skill for everything else.

---
"@apiscope/mcp": patch
---

Harden the MCP streamable HTTP transport: reject requests from foreign origins, support an optional bearer `authToken` compared in constant time, and keep the loopback-only default bind. Non-browser and same-origin clients are unaffected.

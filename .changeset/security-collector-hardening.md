---
"@apiscope/collector": patch
"@apiscope/core": patch
"@apiscope/load": patch
"apiscope": patch
---

Security hardening for the collector, load engine and wire protocol:

- Load-run SSRF: the ad-hoc `POST /api/load-runs` API now derives its target allowlist only from operator config (`collector.loadAllowRemoteHosts`), never from the request body, and strips `hooksModule` from network-supplied scenarios so a client cannot make a worker import a local file.
- WebSocket cross-site hijacking: `/ws/live` and `/ws/ingest` upgrades now validate the `Origin` header (absent, same-origin, or `collector.allowedOrigins`) before accepting the connection.
- Trusted-proxy header auth: `dashboardAuth` proxy mode now requires the request to originate from a configured `trustedProxies` IP and fails closed otherwise.
- Malformed OTLP no longer crashes the collector: dynamic route handlers run inside try/catch and OTLP timestamp parsing rejects non-numeric values instead of throwing.
- Memory-exhaustion DoS: HTTP request bodies are capped (`collector.maxRequestBytes`, default 16 MB, returning 413), WebSocket payloads are bounded, and the wire protocol rejects messages with excessive span/route arrays.
- CI readiness probes are validated against the SSRF allowlist before being fetched.
- Host allowlisting is now DNS-aware and rejects any target resolving into the `169.254.0.0/16` link-local range (cloud metadata).
- Additional credential headers (`proxy-authorization`, `x-api-key`) are redacted by default, `sessionSecret` now requires at least 32 characters, and password login performs constant work for unknown users to close a timing oracle.

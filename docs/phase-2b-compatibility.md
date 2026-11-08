# Phase 2B compatibility research

Research snapshot: 2026-11-08. This is source and local metadata review, not an interoperability receipt. No host configuration, credentials, permissions, chat history, or account settings were read or changed. Publication consent and per-report authorization remain enforced prerequisites under [architecture](architecture.md) and ADR-004 in [decisions](decisions.md).

The implementation uses Unix APIs and a private Unix-domain control socket. The only validated target is macOS Apple Silicon; other Unix systems and Windows are not supported or tested by this receipt.

## rmcp 3.9.0

The locally cached published crate's `README.md` identifies `transport-io` for server stdio and `transport-child-process` for a client spawning a stdio child; it identifies `transport-streamable-http-server` separately. Its `src/model.rs` lists known revisions `2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25`, and `2026-07-28`; `LATEST_WITH_INITIALIZE` is `2025-11-25`. Its server handler defaults to the known version list and negotiates according to the implementation. Inspect and test the negotiated revision rather than assuming a host supports the latest. The [official Rust SDK](https://github.com/modelcontextprotocol/rust-sdk) is the upstream source. The Phase 1 Tauri/rmcp build spike proved only compilation. Phase 2B now verifies actual stdio traffic for four legacy revisions, independent output-schema validation and Core-backed execution; see [the receipt](phase-2b.md). Actual host negotiation remains unverified. A stdio server must reserve stdout for protocol frames and send diagnostics to stderr; test initialization, discovery, valid and invalid calls, disconnect and restart with real client behavior.

## Claude Desktop

`/Applications/Claude.app` exists locally and its bundle metadata reports version `4.23118.0`; install presence does not prove sign-in, entitlement, configuration, or connection. The macOS `claude_desktop_config.json` file exists; only file metadata was inspected, not its content. The [official MCP SDK host guide](https://py.sdk.modelcontextprotocol.io/get-started/real-host/) documents local stdio `mcpServers` configuration and the macOS config and log locations. Configure only through an explicitly authorized host step, using the exact reviewed executable and bundle scope; do not print or replace existing configuration. Actual Orven discovery, advertised schemas, negotiated revision and calls remain **unverified**. Tool responses may be sent to the model provider even for a locally launched stdio process.

The documented macOS configuration path is `~/Library/Application Support/Claude/claude_desktop_config.json`. A **review-only example**, not a command to edit that file, is:

```json
{
  "mcpServers": {
    "orven": {
      "command": "/absolute/path/to/audit-host",
      "args": ["mcp", "/absolute/path/to/private-profile"]
    }
  }
}
```

Replace placeholders with the operator-reviewed executable and profile. The host starts that executable with those exact arguments; do not copy the example over an existing configuration. Preserve and merge existing entries only after explicit authorization, and review the exact payload before any host call. The configuration pathname and subprocess layout are documented by the linked MCP SDK; the `mcp PROFILE` command is Orven-specific. No such edit or launch was performed in this research.


## ChatGPT

The [official custom MCP guide](https://developers.openai.com/api/docs/guides/custom-mcp-server) describes ChatGPT web, a server URL or Tunnel, and workspace/security restrictions. [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) connects an accessible stdio or HTTP server via a running outbound client; it needs a tunnel ID, runtime API key, Platform permissions and the correct ChatGPT workspace association. ChatGPT custom-MCP permissions/security restrictions and Platform tunnel roles are separate; the current guide does not establish this account's plan eligibility. Availability for this account, workspace policy, credentials and actual protocol negotiation are **unknown**. This does not establish direct ChatGPT-to-local-stdio or service while the Mac/tunnel sleeps. For public endpoints, [OpenAI's authentication guidance](https://developers.openai.com/plugins/build/auth) and the architecture's authorization requirements apply; no public endpoint is authorized by this research. A tunnel does not authorize data disclosure; preview exact bytes and destination before publishing.

## Dependency advisories

Root `Cargo.lock` currently contains `proc-macro-error 1.0.4` and `glib 0.18.5`. Lockfile reverse-edge inspection gives representative chains `orven-desktop → tauri → gtk → gtk3-macros → proc-macro-error` and `orven-desktop → tauri → gtk → glib → glib-macros → proc-macro-error`, and `orven-desktop → tauri → gtk → glib`. A lockfile contains cross-target dependencies: `cargo tree --locked --offline --target aarch64-apple-darwin -i` for each returned “nothing to print”; cached Tauri 2.12.5 manifests place GTK/WebKit dependencies on Linux and BSD targets. Thus those packages are not in the observed Apple Silicon target dependency tree; this does not clear Linux/BSD builds. `--target all` offline resolution could not complete because `android_system_properties` was uncached; reverse edges are lockfile evidence, not a complete resolved target build.

- [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html): informational **unmaintained** proc-macro-error, no patched release; advisory suggests alternatives. Remediation requires upstream GTK macro/dependency migration or a reviewed replacement, not assuming a patch update exists. This is not a published vulnerability claim.
- [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html): informational **unsoundness** in `glib::VariantStrIter` methods in 0.15–<0.20, producing undefined behavior and potentially null-pointer crashes under optimization; fixed in >=0.20 and unaffected below 0.15. Upgrade the compatible GTK/WebKit dependency stack to a patched glib when supported, then rerun target-specific dependency and behavior checks. A lockfile-only edit cannot prove compatibility or affected code reachability.

Retain both advisories visibly in release/target review; do not suppress them as globally irrelevant based on a macOS tree. No Linux/BSD build or runtime reachability was tested here.

Lead cross-check: [MCP local-server host setup](https://modelcontextprotocol.io/docs/develop/connect-local-servers) independently documents the Claude stdio configuration path. The current OpenAI guide lists SSE/streaming HTTP URLs or Secure MCP Tunnel; `search`/`fetch` tools are not mandatory. This implementation supplies stdio only. ChatGPT support therefore remains blocked on a configured authorized tunnel or separately secured HTTP deployment and actual account/workspace availability. No entitlement was inferred from installed apps or this coding session.

# First-token startup regression

Run the same installed CLI and model through direct SDK and daemon sessions:

```sh
pnpm perf:first-token -- --samples 1
MISSIONS_TIMING=1 MISSIONS_PERF_HANG_MCP=1 pnpm perf:first-token -- --samples 1
```

These are live runs that spend model tokens. The hanging fixture writes `.factory/mcp.json` only in a disposable project, with a stdio process that reads input but never handshakes. It does not change this checkout or the user's Factory configuration. Inherited user MCP servers still run.

Output includes cold/warm first-thinking and first-text samples, startup stages, and actual supervisor registrations (one entry per spawned process, not repeated ownership updates). Compare registration timestamps with `perf.startup.readyAt` to distinguish startup from deferred title work. `MISSIONS_PERF_TITLES=0` disables background titles.

MCP diagnostics query `listMcpServers` once after initialization or loading, without awaiting it before readiness. Logs allow only server name, status, and `ms`. SDK 0.10.0 has no server duration field: `ms` sums observed connecting-to-terminal intervals, and is `null` if none were observed or a connection is still in progress. It is not the status-query duration. Errors, configuration, commands, environment, headers, and auth data are never logged. A failed or unsupported query does not affect startup.

## M3 upstream contract, not yet adopted

The daemon cannot remove inherited MCP waits inside CLI `initializeSession`. The required upstream change is:

1. In stream-jsonrpc initialization, await SDK-supplied `mcpServers` only. Connect config-file MCP servers in the background.
2. Do not retry already-attempted inherited servers during the ACP merge.
3. Apply the same readiness guarantee when loading a session: required daemon role tools are usable on the first turn.

No released SDK/CLI floor implementing this contract has been established. The installed CLI at implementation time is 0.249.0, with SDK 0.10.0. Do not invent a version threshold or lower `SESSION_START_TIMEOUT_MS`. Keep the 65s initialization compatibility test and leave `blockOnMcpLoad` unset for mission agents; that setting gates turns, not initialization.

Once upstream supplies a release and supported version matrix:

- Adopt its SDK floor and version-check the CLI without changing the old-CLI path.
- Add a live regression case, “hanging inherited MCP does not delay init”: require `startup.session_initialization < 5000ms`, then successfully call a `missions` orchestrator role tool on the first turn.
- Compare one-sample baseline and hanging-fixture runs with the same model: accepted-to-first-text should remain within roughly 3s of baseline.
- Verify downgrade behavior, retain the 120s compatibility deadline, and rewrite its workaround comment only after the new floor is enforced.

Until then, M1 names the blocker and M2 removes pre-ready title/catalog fan-out. Fixing or disabling the broken server, or setting its `connectTimeout` to 3000 in the user's configuration, remains a user-managed remedy. The daemon never rewrites that configuration.

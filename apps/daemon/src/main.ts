import { serve } from "@hono/node-server";

import { createApp } from "./app";

// Loopback only: the daemon holds credentials and repository access.
const HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;

const parsePort = (raw: string | undefined) => {
  if (raw === undefined) {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid MISSIONS_DAEMON_PORT: ${raw}`);
  }
  return port;
};

const port = parsePort(process.env.MISSIONS_DAEMON_PORT);
const app = createApp({
  startedAt: new Date(),
  version: process.env.npm_package_version ?? "0.0.0",
});

const server = serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
  process.stdout.write(
    `${JSON.stringify({ event: "daemon.listening", host: info.address, port: info.port })}\n`
  );
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import { serve } from "@hono/node-server";

import { loadConfig } from "./config";
import { createDaemon } from "./daemon";

// Loopback only: the daemon holds credentials and repository access.
const HOST = "127.0.0.1";

const config = loadConfig();
const daemon = await createDaemon({
  config,
  version: process.env.npm_package_version ?? "0.0.0",
});

const server = serve(
  { fetch: daemon.app.fetch, hostname: HOST, port: config.port },
  (info) => {
    process.stdout.write(
      `${JSON.stringify({ event: "daemon.listening", host: info.address, port: info.port })}\n`
    );
  }
);

const shutdown = () => {
  server.close(() => {
    void daemon.close().then(() => process.exit(0));
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

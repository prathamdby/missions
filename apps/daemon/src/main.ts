import { serve } from "@hono/node-server";

import { loadConfig } from "./config";
import { createDaemon } from "./daemon";

// Loopback only: the daemon holds credentials and repository access.
const HOST = "127.0.0.1";

const config = loadConfig();
const scripted =
  process.env.MISSIONS_SCRIPTED_AGENTS === "1"
    ? await import("./test/scripted-runtime")
    : null;
const daemon = await createDaemon({
  config,
  ...(scripted && {
    createRuntime: (options) =>
      new scripted.ScriptedRuntime(
        options,
        Number(process.env.MISSIONS_SCRIPTED_DELAY_MS ?? 250)
      ),
    loadModels: scripted.scriptedModels,
  }),
  version: process.env.npm_package_version ?? "0.0.0",
});

const startServer = async () => {
  try {
    return serve(
      { fetch: daemon.app.fetch, hostname: HOST, port: config.port },
      (info) => {
        process.stdout.write(
          `${JSON.stringify({ event: "daemon.listening", host: info.address, port: info.port })}\n`
        );
      }
    );
  } catch (error) {
    await daemon.close();
    throw error;
  }
};
const server = await startServer();

let stopping = false;
const shutdown = (exitCode = 0) => {
  if (stopping) {
    return;
  }
  stopping = true;
  const { promise: serverClosed, resolve } = Promise.withResolvers<undefined>();
  server.close(() => resolve(undefined));
  // Event streams never go idle, so close() alone would wait on them forever
  // and browsers would never learn the daemon is gone.
  if ("closeAllConnections" in server) {
    server.closeAllConnections();
  }
  void (async () => {
    try {
      await Promise.all([serverClosed, daemon.close()]);
      process.exit(exitCode);
    } catch (error) {
      process.stderr.write(`Daemon shutdown failed: ${String(error)}\n`);
      process.exit(1);
    }
  })();
};

server.on("error", (error) => {
  process.stderr.write(`Daemon server failed: ${error.message}\n`);
  shutdown(1);
});
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

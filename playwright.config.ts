import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Browser suite against a real daemon driven by scripted offline agents, so
 * every flow is deterministic and never spawns Droid. Ports differ from the
 * dev defaults so a running dev setup is left alone.
 */
const DAEMON_PORT = "4417";
const WEB_PORT = "4418";

// Set once in the runner; workers inherit it, so every process shares one home.
process.env.E2E_MISSIONS_HOME ??= mkdtempSync(
  path.join(os.tmpdir(), "missions-e2e-")
);
const home = process.env.E2E_MISSIONS_HOME;

const chromeLibs =
  process.env.E2E_CHROME_LIBS ??
  path.join(
    os.homedir(),
    ".cache/missions-chromelibs/root/usr/lib/x86_64-linux-gnu"
  );

const shared = {
  MISSIONS_DAEMON_PORT: DAEMON_PORT,
  MISSIONS_HOME: home,
  MISSIONS_WEB_PORT: WEB_PORT,
};

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "test-results/e2e",
  projects: [
    {
      name: "desktop",
      testIgnore: /mobile\.spec\.ts/u,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { height: 900, width: 1440 },
      },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/u,
      use: { ...devices["Pixel 7"] },
    },
  ],
  reporter: [["list"]],
  retries: 0,
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    launchOptions: existsSync(chromeLibs)
      ? { env: { ...process.env, LD_LIBRARY_PATH: chromeLibs } }
      : {},
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @missions/daemon start",
      env: {
        ...shared,
        MISSIONS_SCRIPTED_AGENTS: "1",
        MISSIONS_SCRIPTED_DELAY_MS: "80",
      },
      reuseExistingServer: false,
      timeout: 60_000,
      url: `http://127.0.0.1:${DAEMON_PORT}/v2/health`,
    },
    {
      command: `pnpm --filter @missions/web build && pnpm --filter @missions/web exec next start --hostname 127.0.0.1 --port ${WEB_PORT}`,
      env: { ...shared, MISSIONS_NEXT_DIST_DIR: ".next-e2e" },
      reuseExistingServer: false,
      timeout: 300_000,
      url: `http://127.0.0.1:${WEB_PORT}/`,
    },
  ],
  workers: 1,
});

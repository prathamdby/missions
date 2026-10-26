import type { NextConfig } from "next";

const config: NextConfig = {
  // Compression would buffer the proxied SSE stream; this server only serves loopback.
  compress: false,
  devIndicators: false,
  // Lets a second server (browser tests, parallel dev) build without sharing .next.
  distDir: process.env.MISSIONS_NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@missions/protocol"],
  turbopack: {
    resolveAlias: {
      "@openuidev/devtools": "./src/lib/openui-devtools-off.tsx",
    },
  },
};

export default config;

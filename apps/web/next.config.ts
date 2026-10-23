import type { NextConfig } from "next";

const config: NextConfig = {
  // Compression would buffer the proxied SSE stream; this server only serves loopback.
  compress: false,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@missions/protocol"],
};

export default config;

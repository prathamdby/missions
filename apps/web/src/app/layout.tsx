import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  description: "Coordinate Droid missions on your machine.",
  title: "Missions",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  viewportFit: "cover",
  width: "device-width",
};

const RootLayout = ({ children }: Readonly<{ children: ReactNode }>) => (
  <html className={`${GeistSans.variable} ${GeistMono.variable}`} lang="en">
    <body>
      <a
        className="sr-only fixed top-md left-md z-tooltip rounded-sm bg-accent px-lg py-sm type-label text-on-accent focus-visible:not-sr-only"
        href="#main"
      >
        Skip to content
      </a>
      <Providers>
        <AppShell>{children}</AppShell>
      </Providers>
    </body>
  </html>
);

export default RootLayout;

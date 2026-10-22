import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  description: "Coordinate Droid missions on your machine.",
  title: "Missions",
};

const RootLayout = ({ children }: Readonly<{ children: ReactNode }>) => (
  <html className={`${GeistSans.variable} ${GeistMono.variable}`} lang="en">
    <body>{children}</body>
  </html>
);

export default RootLayout;

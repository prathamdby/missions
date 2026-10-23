"use client";

import { routes } from "@missions/protocol/routes";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { proxyUrl } from "@/lib/api/client";
import { startGlobalSession } from "@/lib/live/global-session";

/** Keeps projects, clone jobs, and settings live for the whole app. */
export const GlobalLive = () => {
  const client = useQueryClient();

  useEffect(
    () =>
      startGlobalSession({
        client,
        eventsUrl: (after) => proxyUrl(routes.events(), { after }),
      }),
    [client]
  );

  return null;
};

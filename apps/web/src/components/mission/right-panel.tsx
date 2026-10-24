"use client";

import type { ReactNode } from "react";

import { ChangesTab } from "@/components/mission/changes-tab";
import { DigestTab } from "@/components/mission/digest-tab";
import { FilesTab } from "@/components/mission/files-tab";
import type { PanelTab } from "@/components/mission/mission-context";
import { OverviewTab } from "@/components/mission/overview-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const Body = ({
  children,
  gap,
}: {
  children: ReactNode;
  gap: "gutter" | "lg" | "section" | "xl";
}) => (
  <div
    className={cn(
      "flex min-h-full flex-col px-gutter pt-xl pb-lg",
      gap === "gutter" && "gap-gutter",
      gap === "section" && "gap-section",
      gap === "xl" && "gap-xl",
      gap === "lg" && "gap-lg"
    )}
  >
    {children}
  </div>
);

/** Paper FQQ / GDH / GNZ / HJD: the mission inspector. */
export const RightPanel = ({
  onTabChange,
  tab,
}: {
  onTabChange: (tab: PanelTab) => void;
  tab: PanelTab;
}) => (
  <Tabs
    className="flex min-h-0 flex-1 flex-col"
    onValueChange={(value) => onTabChange(value as PanelTab)}
    value={tab}
  >
    <div className="flex h-13 shrink-0 items-center border-b border-border-subtle px-lg">
      <TabsList aria-label="Mission details">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="digest">Digest</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger data-testid="tab-changes" value="changes">
          Changes
        </TabsTrigger>
      </TabsList>
    </div>
    <TabsContent
      className="overflow-y-auto overscroll-contain"
      tabIndex={-1}
      value="overview"
    >
      <Body gap="gutter">
        <OverviewTab />
      </Body>
    </TabsContent>
    <TabsContent
      className="overflow-y-auto overscroll-contain"
      tabIndex={-1}
      value="digest"
    >
      <Body gap="section">
        <DigestTab />
      </Body>
    </TabsContent>
    <TabsContent
      className="overflow-y-auto overscroll-contain"
      tabIndex={-1}
      value="files"
    >
      <Body gap="xl">
        <FilesTab />
      </Body>
    </TabsContent>
    <TabsContent
      className="overflow-y-auto overscroll-contain"
      tabIndex={-1}
      value="changes"
    >
      <Body gap="lg">
        <ChangesTab />
      </Body>
    </TabsContent>
  </Tabs>
);

"use client";

import type { ReactNode } from "react";

import { ChangesTab } from "@/components/mission/changes-tab";
import { DigestTab } from "@/components/mission/digest-tab";
import { FilesTab } from "@/components/mission/files-tab";
import type { PanelTab } from "@/components/mission/mission-context";
import { OverviewTab } from "@/components/mission/overview-tab";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const Body = ({
  children,
  gap,
  fixed = false,
}: {
  children: ReactNode;
  gap: "gutter" | "lg" | "section" | "xl";
  fixed?: boolean;
}) => (
  <div
    className={cn(
      "flex flex-col px-gutter pt-xl pb-lg",
      fixed ? "h-full min-h-0 overflow-hidden" : "min-h-full",
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
    <TabsContent value="overview">
      <Body fixed gap="gutter">
        <OverviewTab />
      </Body>
    </TabsContent>
    <TabsContent value="digest">
      <Body fixed gap="section">
        <DigestTab />
      </Body>
    </TabsContent>
    <ScrollArea asChild axis="y" overscroll="contain">
      <TabsContent value="files">
        <Body gap="xl">
          <FilesTab />
        </Body>
      </TabsContent>
    </ScrollArea>
    <ScrollArea asChild axis="y" overscroll="contain">
      <TabsContent value="changes">
        <Body gap="lg">
          <ChangesTab />
        </Body>
      </TabsContent>
    </ScrollArea>
  </Tabs>
);

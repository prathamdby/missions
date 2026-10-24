"use client";

import type { FileNode } from "@missions/protocol/files";
import type { Artifact } from "@missions/protocol/missions";
import Image from "next/image";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  ChevronDownIcon,
  DownloadIcon,
  FileTextIcon,
  FolderIcon,
  SearchIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { Meta } from "@/components/mission/panel-kit";
import { CodeBlock } from "@/components/ui/code-block";
import { Markdown } from "@/components/ui/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/api-error";
import { api } from "@/lib/api/endpoints";
import { useSharedFile, useSharedFiles } from "@/lib/api/queries";
import { shortAge } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const CHANGE: Record<
  NonNullable<FileNode["change"]>,
  { label: string; letter: string; tone: string }
> = {
  added: { label: "Added", letter: "A", tone: "text-success" },
  deleted: { label: "Deleted", letter: "D", tone: "text-danger" },
  modified: { label: "Modified", letter: "M", tone: "text-warning" },
  renamed: { label: "Renamed", letter: "R", tone: "text-info" },
  untracked: { label: "New", letter: "U", tone: "text-success" },
};

const baseName = (path: string) => path.split("/").at(-1) ?? path;

const Indent = ({ depth }: { depth: number }) =>
  depth > 0
    ? Array.from({ length: depth }, (_, index) => (
        <span aria-hidden="true" className="w-4.5 shrink-0" key={index} />
      ))
    : null;

interface LevelProps {
  authors: Readonly<Record<string, string>>;
  depth: number;
  dir: string;
  filter: string;
  onOpen: (path: string) => void;
}

const FileRow = ({
  authors,
  depth,
  node,
  onOpen,
}: {
  depth: number;
  node: FileNode;
  onOpen: (path: string) => void;
  authors: Readonly<Record<string, string>>;
}) => {
  const change = node.change ? CHANGE[node.change] : null;
  return (
    <li>
      <button
        className={cn(
          "flex h-7 w-full cursor-pointer items-center gap-md rounded-sm pr-md text-left transition-colors duration-fast hover:bg-surface-raised",
          depth === 0 ? "pl-control" : "pl-md"
        )}
        onClick={() => onOpen(node.path)}
        type="button"
      >
        <Indent depth={depth} />
        <FileTextIcon className="text-text-tertiary" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm leading-sm tracking-tight",
            change ? "font-medium text-text" : "font-book text-text-secondary"
          )}
        >
          {baseName(node.path)}
        </span>
        {authors[node.path] ? (
          <span className="shrink-0 text-xs leading-sm tracking-tight text-text-tertiary">
            {authors[node.path]}
          </span>
        ) : null}
        <span
          className={cn(
            "flex w-7 shrink-0 justify-end font-mono text-2xs leading-xs",
            change ? change.tone : "text-text-tertiary"
          )}
          title={change?.label}
        >
          {change ? change.letter : ""}
          {change ? <span className="sr-only"> {change.label}</span> : null}
        </span>
      </button>
    </li>
  );
};

const DirectoryRow = ({
  children,
  depth,
  node,
}: {
  /** The directory's own level, mounted only while it is open. */
  children: ReactNode;
  depth: number;
  node: FileNode;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        aria-expanded={open}
        className="flex h-7 w-full cursor-pointer items-center gap-sm rounded-sm px-md text-left transition-colors duration-fast hover:bg-surface-raised"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <Indent depth={depth} />
        <ChevronDownIcon
          className={cn(
            "size-3 text-text-tertiary transition-transform duration-fast",
            open ? "" : "-rotate-90"
          )}
        />
        <FolderIcon className="text-text-secondary" />
        <span className="min-w-0 flex-1 truncate text-sm leading-sm font-book tracking-tight text-text-secondary">
          {baseName(node.path)}
        </span>
        {node.change ? (
          <span
            className={cn(
              "font-mono text-2xs leading-xs",
              CHANGE[node.change].tone
            )}
          >
            ●<span className="sr-only"> contains changes</span>
          </span>
        ) : null}
      </button>
      {open ? children : null}
    </li>
  );
};

const directoriesFirst = (a: FileNode, b: FileNode) => {
  if (a.type === b.type) {
    return a.path.localeCompare(b.path);
  }
  return a.type === "directory" ? -1 : 1;
};

const TreeLevel = ({ authors, depth, dir, filter, onOpen }: LevelProps) => {
  const { missionId } = useMission();
  const tree = useSharedFiles(missionId, dir);
  if (tree.isPending) {
    return <Skeleton className="mx-md my-xs w-1/2" />;
  }
  if (tree.isError) {
    return (
      <p
        className="px-md py-xs text-xs leading-sm text-danger select-text"
        role="alert"
      >
        {errorMessage(tree.error)}
      </p>
    );
  }
  const needle = filter.trim().toLowerCase();
  const entries = tree.data.entries
    .filter(
      (node) =>
        !needle ||
        node.type === "directory" ||
        node.path.toLowerCase().includes(needle)
    )
    .toSorted(directoriesFirst);
  return (
    <ul className="flex flex-col">
      {entries.map((node) =>
        node.type === "directory" ? (
          <DirectoryRow depth={depth} key={node.path} node={node}>
            <TreeLevel
              authors={authors}
              depth={depth + 1}
              dir={node.path}
              filter={filter}
              onOpen={onOpen}
            />
          </DirectoryRow>
        ) : (
          <FileRow
            authors={authors}
            depth={depth}
            key={node.path}
            node={node}
            onOpen={onOpen}
          />
        )
      )}
      {tree.data.truncated ? (
        <li className="px-md py-xs text-xs leading-sm text-text-tertiary">
          Some entries are hidden. Use the filter to narrow the list.
        </li>
      ) : null}
    </ul>
  );
};

const KB = 1024;
const formatSize = (bytes: number) =>
  bytes < KB ? `${bytes} B` : `${Math.round(bytes / KB)} KB`;

const FileViewer = ({
  onClose,
  path,
}: {
  onClose: () => void;
  path: string;
}) => {
  const { missionId } = useMission();
  const content = useSharedFile(missionId, path);
  return (
    <div className="flex min-h-0 flex-col gap-md">
      <div className="flex h-7 items-center gap-sm">
        <button
          className="flex h-7 cursor-pointer items-center gap-sm rounded-sm px-md text-sm leading-sm font-medium tracking-tight text-text-secondary hover:bg-surface-raised hover:text-text"
          onClick={onClose}
          type="button"
        >
          <ChevronDownIcon className="size-3 rotate-90" />
          All files
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-2xs leading-xs text-text-tertiary">
          {path}
        </span>
      </div>
      {content.isPending ? <Skeleton className="h-40 w-full" /> : null}
      {content.isError ? (
        <p className="text-xs leading-sm text-danger select-text" role="alert">
          {errorMessage(content.error)}
        </p>
      ) : null}
      {content.data?.kind === "text" && path.endsWith(".md") ? (
        <Markdown>{content.data.content}</Markdown>
      ) : null}
      {content.data?.kind === "text" && !path.endsWith(".md") ? (
        <CodeBlock
          code={content.data.content}
          height="auto"
          meta={
            <Meta>
              {formatSize(content.data.size)}
              {content.data.truncated ? " · truncated" : ""}
            </Meta>
          }
          title={baseName(path)}
        />
      ) : null}
      {content.data?.kind === "binary" ? (
        <p className="text-xs leading-sm text-text-tertiary">
          Binary file · {content.data.mediaType} ·{" "}
          {formatSize(content.data.size)}. Open it from the worktree to view it.
        </p>
      ) : null}
      {content.data?.kind === "missing" ? (
        <p className="text-xs leading-sm text-text-tertiary">
          This shared file no longer exists.
        </p>
      ) : null}
    </div>
  );
};

const ArtifactRow = ({ artifact }: { artifact: Artifact }) => {
  const { live, missionId } = useMission();
  const now = useNow();
  const url = api.artifactUrl(missionId, artifact.id);
  const agent = artifact.agentId ? live.agents[artifact.agentId] : undefined;
  const role = agent?.role === "worker" ? "Worker" : "Orchestrator";
  return (
    <li className="flex flex-col gap-sm">
      {artifact.kind === "image" ? (
        <Image
          alt={artifact.name}
          className="max-h-60 w-full rounded-md bg-surface-raised object-contain shadow-sm"
          height={240}
          src={url}
          unoptimized
          width={480}
        />
      ) : null}
      {artifact.kind === "recording" ? (
        <video
          className="max-h-60 w-full rounded-md bg-bg shadow-sm"
          controls
          preload="metadata"
          src={url}
        >
          {/* Agent screen recordings have no narration to caption. */}
          <track kind="captions" />
        </video>
      ) : null}
      <a
        className="flex h-7 items-center gap-md rounded-sm px-control hover:bg-surface-raised"
        download={artifact.kind === "file" ? artifact.name : undefined}
        href={url}
        rel="noopener noreferrer"
        target="_blank"
      >
        {artifact.kind === "file" ? (
          <DownloadIcon className="text-text-tertiary" />
        ) : (
          <FileTextIcon className="text-text-tertiary" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm leading-sm font-medium tracking-tight text-text">
          {artifact.name}
        </span>
        <span className="shrink-0 text-xs leading-sm tracking-tight text-text-tertiary">
          {role}
        </span>
        <span className="flex w-7 shrink-0 justify-end font-mono text-2xs leading-xs text-text-tertiary">
          {shortAge(artifact.createdAt, now)}
        </span>
      </a>
    </li>
  );
};

/** Persistent shared knowledge and artifacts, never the repository checkout. */
export const FilesTab = () => {
  const authors = {};
  const { live } = useMission();
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const artifacts = Object.values(live.artifacts).toSorted((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  if (open) {
    return <FileViewer onClose={() => setOpen(null)} path={open} />;
  }
  return (
    <>
      <div className="flex h-7 shrink-0 items-center justify-between gap-md">
        <span className="text-xs leading-sm font-book tracking-tight text-text-tertiary">
          Shared mission files
          {artifacts.length > 0 ? ` · ${artifacts.length} from agents` : ""}
        </span>
        <label className="flex h-7 w-45 items-center gap-sm rounded-sm bg-bg px-md ring-1 ring-border focus-within:ring-border-strong">
          <SearchIcon className="size-3.5 text-text-tertiary" />
          <span className="sr-only">Filter files</span>
          <input
            className="min-w-0 flex-1 bg-transparent text-xs leading-sm text-text outline-none placeholder:text-text-tertiary"
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter"
            type="search"
            value={filter}
          />
        </label>
      </div>
      {artifacts.length > 0 ? (
        <ul aria-label="Agent files" className="-mx-md flex flex-col gap-sm">
          {artifacts.map((artifact) => (
            <ArtifactRow artifact={artifact} key={artifact.id} />
          ))}
        </ul>
      ) : null}
      <nav aria-label="Shared mission files" className="-mx-md">
        <TreeLevel
          authors={authors}
          depth={0}
          dir=""
          filter={filter}
          onOpen={setOpen}
        />
      </nav>
    </>
  );
};

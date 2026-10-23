import type { CloneSource } from "@missions/protocol/projects";

/** Where clones land unless the user picks another folder. */
export const DEFAULT_CLONE_PARENT = "~/code";

const TRAILING_SLASHES = /\/+$/u;
const PATH_SEPARATORS = /[/:]/u;
const GIT_SUFFIX = /\.git$/u;

/** Mirrors the daemon: the folder is named after the last path segment. */
export const repoNameOf = (source: CloneSource) => {
  const raw = source.kind === "github" ? source.repo : source.url;
  const last =
    raw.replace(TRAILING_SLASHES, "").split(PATH_SEPARATORS).at(-1) ??
    "repository";
  return last.replace(GIT_SUFFIX, "") || "repository";
};

export const joinPath = (parent: string, name: string) =>
  `${parent.replace(TRAILING_SLASHES, "")}/${name}`;

export const sourceLabel = (source: CloneSource) =>
  source.kind === "github" ? source.repo : source.url;

/** The command the daemon runs, shown so nothing happens behind the user's back. */
export const cloneCommand = (source: CloneSource, destination: string) =>
  source.kind === "github"
    ? `gh repo clone ${source.repo} ${destination}`
    : `git clone ${source.url} ${destination}`;

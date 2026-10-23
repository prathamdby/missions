/**
 * Recognizes direct git/gh invocations, including their common global options.
 * This is conservative approval classification, NOT a shell sandbox: programs,
 * aliases and shell expansion can execute arbitrary code.
 * Grant identity is the original command, never these classification tokens.
 */
const SHELL_WORD =
  /'(?<single>[^']*)'|"(?<double>(?:\\.|[^"\\])*)"|\\(?<escaped>[\s\S])|(?<plain>[^\s"'\\;&|()<>`]+)|(?<separator>[;&|()<>`\n])/gu;
const DOUBLE_ESCAPE = /\\(?<character>["\\$`])/gu;
const HAS_SPACE = /\s/u;

const words = (command: string) => {
  const result: string[] = [];
  let word = "";
  let end = 0;
  for (const match of command.matchAll(SHELL_WORD)) {
    const groups = match.groups ?? {};
    const gap = command.slice(end, match.index);
    if ((HAS_SPACE.test(gap) || groups.separator) && word !== "") {
      result.push(word);
      word = "";
    }
    const fragment =
      groups.single ??
      groups.double?.replaceAll(DOUBLE_ESCAPE, "$<character>") ??
      groups.escaped ??
      groups.plain ??
      groups.separator ??
      "";
    if (groups.separator) {
      result.push(fragment);
    } else {
      word += fragment;
    }
    end = match.index + match[0].length;
  }
  if (word !== "") {
    result.push(word);
  }
  return result;
};

type CommandCategory = "execute" | "vcs" | "publish";

const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);
const GIT_FLAGS = new Set([
  "--no-pager",
  "--paginate",
  "-P",
  "-p",
  "--bare",
  "--no-optional-locks",
  "--literal-pathspecs",
  "--no-literal-pathspecs",
  "--glob-pathspecs",
  "--noglob-pathspecs",
  "--icase-pathspecs",
]);
const GIT_READ = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "rev-list",
  "ls-files",
  "ls-tree",
  "cat-file",
  "show-ref",
  "check-ignore",
  "describe",
  "help",
  "version",
]);
const GIT_MUTATE = new Set([
  "add",
  "commit",
  "reset",
  "stash",
  "clean",
  "rebase",
  "merge",
  "cherry-pick",
  "revert",
  "tag",
  "branch",
  "worktree",
  "checkout",
  "switch",
  "restore",
  "fetch",
  "pull",
  "config",
  "update-ref",
  "apply",
  "am",
  "init",
  "clone",
]);

const gitCommand = (args: string[]): CommandCategory => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (GIT_FLAGS.has(arg)) {
      continue;
    }
    if (GIT_VALUE_OPTIONS.has(arg)) {
      index += 1;
      continue;
    }
    if (
      arg.startsWith("-C") ||
      arg.startsWith("-c") ||
      [...GIT_VALUE_OPTIONS].some((option) => arg.startsWith(`${option}=`))
    ) {
      continue;
    }
    if (GIT_READ.has(arg)) {
      return "execute";
    }
    if (GIT_MUTATE.has(arg)) {
      return "vcs";
    }
    // Push, aliases, unknown global options and unsupported commands cannot
    // be granted around the mandatory publish approval.
    return "publish";
  }
  return "publish";
};

const GH_VALUE_OPTIONS = new Set(["-R", "--repo", "--hostname"]);
const GH_FLAGS = new Set(["--help", "--version"]);
const GH_READ = new Set(["list", "view", "status", "diff", "checks"]);
const GH_LOCAL = new Set(["checkout", "clone", "sync"]);
const GH_API_MUTATION = new Set([
  "-f",
  "--raw-field",
  "-F",
  "--field",
  "--input",
]);

const ghApi = (args: string[]): CommandCategory => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (
      GH_API_MUTATION.has(arg) ||
      [...GH_API_MUTATION].some(
        (option) =>
          arg.startsWith(`${option}=`) ||
          ((option === "-f" || option === "-F") &&
            arg.startsWith(option) &&
            arg.length > 2)
      )
    ) {
      return "publish";
    }
    if (arg === "-X" || arg === "--method") {
      const method = args[index + 1]?.toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        return "publish";
      }
      index += 1;
    } else if (arg.startsWith("--method=") || arg.startsWith("-X")) {
      const method = arg.replace(/^(?:--method=|-X)/u, "").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        return "publish";
      }
    }
  }
  return "execute";
};

const ghCommand = (args: string[]): CommandCategory => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (GH_FLAGS.has(arg)) {
      continue;
    }
    if (GH_VALUE_OPTIONS.has(arg)) {
      index += 1;
      continue;
    }
    if (
      arg.startsWith("-R") ||
      [...GH_VALUE_OPTIONS].some((option) => arg.startsWith(`${option}=`))
    ) {
      continue;
    }
    if (arg === "api") {
      return ghApi(args.slice(index + 1));
    }
    if (GH_READ.has(args[index + 1] ?? "")) {
      return "execute";
    }
    if (GH_LOCAL.has(args[index + 1] ?? "")) {
      return "vcs";
    }
    return "publish";
  }
  return "publish";
};

export const commandCategory = (
  command: string,
  nesting = 0
): CommandCategory => {
  if (nesting > 8) {
    return "publish";
  }
  const tokens = words(command);
  let category: CommandCategory = "execute";
  for (let index = 0; index < tokens.length; index += 1) {
    const executable = tokens[index]?.split("/").at(-1);
    const args = tokens.slice(index + 1);
    let next: CommandCategory = "execute";
    if (executable === "git") {
      next = gitCommand(args);
    } else if (executable === "gh") {
      next = ghCommand(args);
    } else if (HAS_SPACE.test(tokens[index] ?? "")) {
      // Also inspect quoted command strings (for example `sh -c 'git push'`).
      // This deliberately over-approximates; it does not evaluate shell code.
      next = commandCategory(tokens[index] ?? "", nesting + 1);
    }
    if (next === "publish") {
      return "publish";
    }
    if (next === "vcs") {
      category = "vcs";
    }
  }
  return category;
};

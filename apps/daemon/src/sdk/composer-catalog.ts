import path from "node:path";

import type { DroidClient } from "@factory/droid-sdk/node";
import type {
  ComposerCatalog as Catalog,
  ComposerCommand,
} from "@missions/protocol/composer";
import { z } from "zod";

import { ProbeSessions } from "./probe-session";
import { MODEL_PROBE_TIMEOUT_MS, withDeadline } from "./startup";

export interface ComposerSkill {
  name: string;
  description?: string;
  enabled?: boolean;
  userInvocable?: boolean;
}
export interface SdkCommand {
  name: string;
  description: string;
  argumentHint?: string;
  isExecutable?: boolean;
}
export interface ComposerRuntime {
  listSkills: () => Promise<ComposerSkill[]>;
  listCommands: () => Promise<SdkCommand[]>;
}
export interface RawComposerCatalog {
  skills: ComposerSkill[];
  commands: SdkCommand[];
}

const SkillSchema = z.object({
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  name: z.string(),
  userInvocable: z.boolean().optional(),
});
const CommandSchema = z.object({
  argumentHint: z.string().optional(),
  description: z.string(),
  isExecutable: z.boolean().optional(),
  name: z.string(),
});
const SkillsResultSchema = z.object({ skills: z.array(SkillSchema) });
const CommandsResultSchema = z.object({ commands: z.array(CommandSchema) });
export const listSkills = async (
  client: DroidClient
): Promise<ComposerSkill[]> => {
  const response = await client.listSkills({ includeContent: false });
  if (!("result" in response) || !response.result) {
    throw new Error(response.error?.message ?? "Skill discovery failed");
  }
  return SkillsResultSchema.parse(response.result).skills;
};
export const listCommands = async (
  client: DroidClient
): Promise<SdkCommand[]> => {
  const response = await client.listCommands();
  if (!("result" in response) || !response.result) {
    throw new Error(response.error?.message ?? "Command discovery failed");
  }
  return CommandsResultSchema.parse(response.result).commands;
};

const readRuntime = async (
  runtime: ComposerRuntime
): Promise<RawComposerCatalog> => {
  const [skills, commands] = await Promise.all([
    runtime.listSkills(),
    runtime.listCommands(),
  ]);
  return { commands, skills };
};

const normalize = (raw: RawComposerCatalog): ComposerCommand[] => {
  const commands = new Map<string, ComposerCommand>();
  for (const skill of raw.skills) {
    if (skill.enabled !== false && skill.userInvocable !== false) {
      commands.set(skill.name, {
        description: skill.description ?? "",
        kind: "skill",
        name: skill.name,
      });
    }
  }
  for (const command of raw.commands) {
    if (!commands.has(command.name)) {
      commands.set(command.name, {
        argumentHint: command.argumentHint,
        description: command.description,
        kind: "command",
        name: command.name,
      });
    }
  }
  return [...commands.values()].toSorted((a, b) =>
    a.name.localeCompare(b.name)
  );
};

const CACHE_MS = 10 * 60_000;
const MAX_ROOTS = 128;
const UNAVAILABLE: Catalog = { commands: [], source: "unavailable" };

export class ComposerCatalog {
  readonly #probes: ProbeSessions;
  readonly #probe: (cwd: string) => Promise<RawComposerCatalog>;
  readonly #cache = new Map<string, { at: number; value: Catalog }>();
  readonly #pending = new Map<string, Promise<Catalog>>();
  readonly #now: () => number;
  readonly #cancel = new AbortController();

  constructor(
    droidPath: string,
    options: {
      now?: () => number;
      probe?: (cwd: string) => Promise<RawComposerCatalog>;
    } = {}
  ) {
    this.#probes = new ProbeSessions(droidPath);
    this.#probe =
      options.probe ??
      ((cwd) =>
        this.#probes.run(cwd, async (client) => {
          const [skills, commands] = await Promise.all([
            listSkills(client),
            listCommands(client),
          ]);
          return { commands, skills };
        }));
    this.#now = options.now ?? Date.now;
  }

  async list(
    cwd: string,
    runtime: ComposerRuntime | null = null
  ): Promise<Catalog> {
    if (this.#cancel.signal.aborted) {
      return UNAVAILABLE;
    }
    const key = path.resolve(cwd);
    const cached = this.#cache.get(key);
    if (cached && this.#now() - cached.at < CACHE_MS) {
      return cached.value;
    }
    let pending = this.#pending.get(key);
    if (!pending) {
      pending = this.#fetch(key, runtime).finally(() =>
        this.#pending.delete(key)
      );
      this.#pending.set(key, pending);
    }
    return await pending;
  }

  async #fetch(cwd: string, runtime: ComposerRuntime | null): Promise<Catalog> {
    const deadline = <T>(promise: Promise<T>) =>
      withDeadline(
        promise,
        MODEL_PROBE_TIMEOUT_MS,
        "Composer discovery timed out",
        this.#cancel.signal
      );
    try {
      let raw: RawComposerCatalog;
      try {
        if (!runtime) {
          throw new Error("No ready runtime");
        }
        raw = await deadline(readRuntime(runtime));
      } catch {
        raw = await deadline(this.#probe(cwd));
      }
      const value: Catalog = { commands: normalize(raw), source: "droid" };
      this.#cache.set(cwd, { at: this.#now(), value });
      if (this.#cache.size > MAX_ROOTS) {
        const oldest = this.#cache.keys().next().value;
        if (oldest !== undefined) {
          this.#cache.delete(oldest);
        }
      }
      return value;
    } catch {
      return UNAVAILABLE;
    }
  }

  async close(): Promise<void> {
    this.#cancel.abort();
    this.#cache.clear();
    await this.#probes.close();
  }
}

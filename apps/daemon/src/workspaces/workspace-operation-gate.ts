import { realpath } from "node:fs/promises";
import path from "node:path";

/** Admission and external mutation share one canonical-workspace exclusion interval. */
export class WorkspaceOperationGate {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(
    workspace: string,
    effect: (canonical: string) => T | Promise<T>
  ): Promise<T> {
    const canonical = await realpath(workspace);
    return await this.#exclusive(canonical, effect);
  }

  /** Only trusted persisted canonical bindings may survive an already-removed directory. */
  async runRecovery<T>(
    storedCanonical: string,
    effect: (canonical: string) => T | Promise<T>
  ): Promise<T> {
    if (!path.isAbsolute(storedCanonical)) {
      throw new Error(
        "Workspace recovery requires an absolute canonical binding"
      );
    }
    const canonical = await realpath(storedCanonical).catch(
      (error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return path.normalize(storedCanonical);
        }
        throw error;
      }
    );
    return await this.#exclusive(canonical, effect);
  }

  async #exclusive<T>(
    canonical: string,
    effect: (canonical: string) => T | Promise<T>
  ): Promise<T> {
    const previous = this.#tails.get(canonical) ?? Promise.resolve();
    const release = Promise.withResolvers<undefined>();
    const tail = previous.then(() => release.promise);
    this.#tails.set(canonical, tail);
    await previous;
    try {
      return await effect(canonical);
    } finally {
      release.resolve(undefined);
      if (this.#tails.get(canonical) === tail) {
        this.#tails.delete(canonical);
      }
    }
  }
}

import type {
  Settings,
  UpdateSettingsRequest,
} from "@missions/protocol/settings";

interface Persistence {
  commit: (settings: Settings) => void;
  onError: (error: unknown) => void;
  persist: (patch: UpdateSettingsRequest) => Promise<Settings>;
}

/** One ordered writer per settings cache, shared across controls and mounts. */
export class SettingsCoordinator {
  private readonly listeners = new Set<() => void>();
  private readonly queue: {
    patch: UpdateSettingsRequest;
    resolve: (saved: boolean) => void;
  }[] = [];
  private running = false;

  private readonly persistence: Persistence;

  constructor(persistence: Persistence) {
    this.persistence = persistence;
  }

  getSnapshot = () => this.running;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  save = (patch: UpdateSettingsRequest): Promise<boolean> => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    this.queue.push({ patch: structuredClone(patch), resolve });
    if (!this.running) {
      this.running = true;
      this.notify();
      void this.drain();
    }
    return promise;
  };

  private async drain(): Promise<void> {
    const entry = this.queue.shift();
    if (!entry) {
      this.running = false;
      this.notify();
      return;
    }
    try {
      const settings = await this.persistence.persist(entry.patch);
      this.persistence.commit(settings);
      entry.resolve(true);
    } catch (error) {
      this.persistence.onError(error);
      entry.resolve(false);
    }
    await this.drain();
  }
}

/** A failed save keeps the edit; late saves cannot close a newer edit. */
export class LocationDraft {
  private state: { pending: boolean; value: string | null } = {
    pending: false,
    value: null,
  };
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(value: string | null, pending = this.state.pending) {
    this.state = { pending, value };
    for (const listener of this.listeners) {
      listener();
    }
  }

  edit = (value: string) => {
    this.generation += 1;
    this.update(value);
  };

  cancel = () => {
    this.generation += 1;
    this.update(null);
  };

  save = async (
    persisted: string,
    persist: (value: string) => Promise<boolean>
  ) => {
    if (this.state.pending || this.state.value === null) {
      return;
    }
    const value = this.state.value.trim();
    if (!value) {
      return;
    }
    if (value === persisted) {
      this.cancel();
      return;
    }
    const { generation } = this;
    this.update(this.state.value, true);
    let saved = false;
    try {
      saved = await persist(value);
    } finally {
      const current = generation === this.generation;
      this.update(saved && current ? null : this.state.value, false);
    }
  };
}

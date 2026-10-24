/** Subscription owns the URL, including Strict Mode unsubscribe/resubscribe. */
export class FilePreviewSource {
  readonly #file: File;
  #url: string | null = null;

  constructor(file: File) {
    this.#file = file;
  }

  snapshot = () => this.#url;
  subscribe = (changed: () => void) => {
    const url = URL.createObjectURL(this.#file);
    this.#url = url;
    changed();
    return () => {
      URL.revokeObjectURL(url);
      this.#url = null;
    };
  };
}

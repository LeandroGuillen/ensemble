import { Injectable } from '@angular/core';

/** Saves a page's not-yet-written (debounced) edits. Must not reject. */
export type PendingEditsFlusher = () => Promise<void>;

/**
 * Debounced autosaves that must not be lost when the user leaves.
 *
 * Pages with debounced autosave `register()` a flusher while they are open and
 * `track()` the save they start on destroy. Before quit / reload / window close
 * (`AppComponent`) and before a project switch (`ProjectService`), `flushAll()`
 * runs every registered flusher and waits for every tracked save, so the edit
 * lands in the project it was made in.
 */
@Injectable({ providedIn: 'root' })
export class PendingEditsService {
  private readonly flushers = new Set<PendingEditsFlusher>();
  private readonly inFlight = new Set<Promise<void>>();

  /** Returns the unregister function. */
  register(flusher: PendingEditsFlusher): () => void {
    this.flushers.add(flusher);
    return () => {
      this.flushers.delete(flusher);
    };
  }

  /** Keeps a save started outside `flushAll()` (e.g. on destroy) awaited by it. */
  track(save: Promise<void>): void {
    const settled = save.catch(() => undefined).finally(() => {
      this.inFlight.delete(settled);
    });
    this.inFlight.add(settled);
  }

  async flushAll(): Promise<void> {
    const pending = [...this.flushers].map((flush) => flush().catch(() => undefined));
    await Promise.all([...pending, ...this.inFlight]);
  }
}

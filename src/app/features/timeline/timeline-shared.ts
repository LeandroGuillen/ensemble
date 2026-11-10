import { Character } from '../../core/interfaces/character.interface';
import { CharacterService } from '../../core/services/character.service';
import { TimelineItemKind } from '../../core/utils/timeline.utils';

export const KIND_LABELS: Record<TimelineItemKind, string> = {
  event: 'Event',
  legend: 'Legend',
  birth: 'Born',
  death: 'Died',
  reign: 'Reign',
  book: 'Book',
};

/**
 * Portraits for characters shown on a timeline. Loads only characters not loaded yet and
 * reports when new ones arrive.
 */
export class TimelinePortraits {
  private readonly urls = new Map<string, string>();
  private readonly requested = new Set<string>();

  constructor(private readonly characters: CharacterService) {}

  get(id: string): string | null {
    return this.urls.get(id) ?? null;
  }

  /** Load portraits for these characters; resolves true when any new portrait became available. */
  async load(list: Character[]): Promise<boolean> {
    const missing = list.filter((c) => !this.requested.has(c.id));
    if (!missing.length) return false;
    missing.forEach((c) => this.requested.add(c.id));
    try {
      await this.characters.loadThumbnailsForCharacters(missing);
    } catch {
      return false;
    }
    let changed = false;
    for (const character of missing) {
      const url = this.characters.getCachedThumbnail(character.id);
      if (url) {
        this.urls.set(character.id, url);
        changed = true;
      }
    }
    return changed;
  }

  reset(): void {
    this.urls.clear();
    this.requested.clear();
  }
}

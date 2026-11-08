import { ChangeDetectorRef, OnDestroy, Pipe, PipeTransform, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { WikiLinkTargetsService } from '../../core/services/wiki-link-targets.service';
import { markdownExcerpt, wikiLinksAsText } from '../../core/utils/markdown-excerpt.utils';
import type { WikiLinkRecordName } from '../../core/utils/wiki-links.utils';

/**
 * Follows the project's records so wiki links show the record name the resolver reads
 * (`[[C#]]` stays `C#` when a `C#` record exists), and caches the last result so the impure
 * pipes below only recompute when their input or the records change. Create in an injection context.
 */
class WikiLinkDisplay {
  recordName?: WikiLinkRecordName;
  private readonly subscription: Subscription;
  private cacheKey: unknown[] = [];
  private cacheValue = '';

  constructor() {
    const changeDetector = inject(ChangeDetectorRef);
    this.subscription = inject(WikiLinkTargetsService).recordName$().subscribe((recordName) => {
      this.recordName = recordName;
      changeDetector.markForCheck();
    });
  }

  cached(key: unknown[], compute: (recordName?: WikiLinkRecordName) => string): string {
    key = [...key, this.recordName];
    if (key.length !== this.cacheKey.length || key.some((value, i) => value !== this.cacheKey[i])) {
      this.cacheKey = key;
      this.cacheValue = compute(this.recordName);
    }
    return this.cacheValue;
  }

  destroy(): void {
    this.subscription.unsubscribe();
  }
}

/** `{{ body | excerpt:140 }}` — readable plain-text preview of a Markdown body. */
@Pipe({ name: 'excerpt', standalone: true, pure: false })
export class ExcerptPipe implements PipeTransform, OnDestroy {
  private readonly display = new WikiLinkDisplay();

  transform(content: string | null | undefined, maxLength = 160): string {
    return this.display.cached([content, maxLength], (recordName) => markdownExcerpt(content, maxLength, recordName));
  }

  ngOnDestroy(): void {
    this.display.destroy();
  }
}

/** `{{ beat | wikiText }}` — wiki links shown as their labels, other text unchanged. */
@Pipe({ name: 'wikiText', standalone: true, pure: false })
export class WikiTextPipe implements PipeTransform, OnDestroy {
  private readonly display = new WikiLinkDisplay();

  transform(text: string | null | undefined): string {
    return this.display.cached([text], (recordName) => wikiLinksAsText(text, recordName));
  }

  ngOnDestroy(): void {
    this.display.destroy();
  }
}

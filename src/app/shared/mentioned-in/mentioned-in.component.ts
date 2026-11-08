import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, Input, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BacklinkService } from '../../core/services/backlink.service';
import { Backlink, groupBacklinks, BacklinkSourceType } from '../../core/utils/backlinks.utils';

/** Collapsible "Mentioned in" backlinks panel for a character/Lore/location/House detail page. */
@Component({
  selector: 'app-mentioned-in',
  imports: [RouterLink],
  templateUrl: './mentioned-in.component.html',
  styleUrls: ['./mentioned-in.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentionedInComponent implements OnInit {
  @Input() targetId = '';
  @Input() targetName = '';
  @Input() targetAliases: string[] = [];

  groups: { key: BacklinkSourceType; label: string; items: Backlink[] }[] = [];
  total = 0;
  excludedCount = 0;

  private readonly backlinks = inject(BacklinkService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.backlinks.index$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.refresh();
      this.cdr.markForCheck();
    });
    this.refresh();
  }

  /** Whether there is anything to show (mentions or unresolved links to this name). */
  get visible(): boolean {
    return this.total > 0 || this.excludedCount > 0;
  }

  routerLinkFor(item: Backlink): (string | number)[] {
    switch (item.sourceType) {
      case 'draft':
        return ['/character-draft', item.sourceId];
      case 'location':
        return ['/location', item.sourceId];
      case 'house':
        return ['/house', item.sourceId];
      case 'book':
        // A book plan belongs to the book; a book page belongs to its character or draft.
        if (item.sourcePart === 'Book plan') return ['/book', item.sourceId];
        return [item.sourceDraft ? '/character-draft' : '/character', item.sourceId];
      default:
        return ['/character', item.sourceId];
    }
  }

  private refresh(): void {
    const backlinks = this.backlinks.backlinksFor(this.targetId);
    this.groups = groupBacklinks(backlinks);
    this.total = backlinks.length;
    this.excludedCount = this.backlinks.excludedCountFor(this.targetName, this.targetAliases);
  }
}

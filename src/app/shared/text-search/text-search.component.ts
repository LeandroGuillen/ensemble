import { Component, HostListener, Injector, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ModalFrameComponent } from '../modal-frame/modal-frame.component';
import { TextSearchService } from '../../core/services/text-search.service';
import { TextResult } from '../../core/utils/text-search.utils';
import { ProjectService } from '../../core/services/project.service';

@Component({
  selector: 'app-text-search',
  imports: [FormsModule, ModalFrameComponent],
  templateUrl: './text-search.component.html',
  styleUrl: './text-search.component.scss',
})
export class TextSearchComponent {
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private service?: TextSearchService;
  isOpen = false;
  query = '';
  loading = false;
  error = '';
  groups: { type: string; results: TextResult[] }[] = [];
  count = 0;

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== 'f') return;
    if (!this.injector.get(ProjectService).getCurrentProject()) return;
    event.preventDefault();
    event.stopPropagation();
    this.open();
  }

  open(): void {
    if (!this.service) {
      this.service = this.injector.get(TextSearchService);
      this.service.changed$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.search());
      this.service.loading$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => this.loading = value);
      this.service.error$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => this.error = value);
    }
    this.isOpen = true;
    this.query = '';
    this.search();
    void this.service.rebuild();
  }

  search(): void {
    const results = this.service?.index.search(this.query) ?? [];
    const grouped = new Map<string, TextResult[]>();
    for (const result of results) {
      if (!grouped.has(result.type)) grouped.set(result.type, []);
      grouped.get(result.type)!.push(result);
    }
    this.count = results.length;
    this.groups = [...grouped].map(([type, results]) => ({ type, results }));
  }

  async select(result: TextResult): Promise<void> {
    if (await this.injector.get(Router).navigate(result.route, { queryParams: result.queryParams })) {
      this.isOpen = false;
    }
  }
}

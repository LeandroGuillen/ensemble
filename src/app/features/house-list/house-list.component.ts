import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { House } from '../../core/interfaces/house.interface';
import { HouseService } from '../../core/services/house.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

@Component({ selector: 'app-house-list', imports: [FormsModule, RouterLink, PageHeaderComponent], templateUrl: './house-list.component.html', styleUrls: ['./house-list.component.scss'] })
export class HouseListComponent implements OnInit {
  readonly houses = inject(HouseService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  records: House[] = [];
  crests = new Map<string, string>();
  search = '';
  loading = true;
  error = '';
  ngOnInit(): void {
    this.houses.houses$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(records => {
      this.records = records;
      this.crests.clear();
      for (const house of records) void this.houses.loadCrest(house).then(url => {
        if (!this.destroyRef.destroyed && this.records.includes(house)) {
          if (url) this.crests.set(house.id, url);
          this.cdr.markForCheck();
        }
      }).catch(() => undefined);
    });
    void this.refresh();
  }
  get filtered(): House[] {
    const query = this.search.trim().toLowerCase();
    return this.records.filter(house => `${house.name} ${house.motto} ${house.content}`.toLowerCase().includes(query));
  }
  async refresh(): Promise<void> {
    this.loading = true;
    this.error = '';
    try { await this.houses.loadHouses(true); }
    catch (error) { this.error = String(error); }
    finally { this.loading = false; this.cdr.markForCheck(); }
  }
}

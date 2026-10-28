import { ChangeDetectorRef, Component, DestroyRef, HostListener, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { House } from '../../core/interfaces/house.interface';
import { HouseService } from '../../core/services/house.service';
import {
  isEditableKeyboardTarget,
  moveListSelection,
  plainLetterKey,
} from '../../core/utils/list-keyboard.utils';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

@Component({
  selector: 'app-house-list',
  imports: [FormsModule, RouterLink, PageHeaderComponent],
  templateUrl: './house-list.component.html',
  styleUrls: ['./house-list.component.scss'],
})
export class HouseListComponent implements OnInit {
  readonly houses = inject(HouseService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly router = inject(Router);

  records: House[] = [];
  crests = new Map<string, string>();
  search = '';
  loading = true;
  error = '';
  selectedHouseIndex = -1;

  ngOnInit(): void {
    this.houses.houses$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((records) => {
      this.records = records;
      this.crests.clear();
      this.selectedHouseIndex = -1;
      for (const house of records) {
        void this.houses
          .loadCrest(house)
          .then((url) => {
            if (!this.destroyRef.destroyed && this.records.includes(house)) {
              if (url) this.crests.set(house.id, url);
              this.cdr.markForCheck();
            }
          })
          .catch(() => undefined);
      }
    });
    void this.refresh();
  }

  get filtered(): House[] {
    const query = this.search.trim().toLowerCase();
    return this.records.filter((house) =>
      `${house.name} ${house.motto} ${house.content}`.toLowerCase().includes(query)
    );
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      await this.houses.loadHouses(true);
    } catch (error) {
      this.error = String(error);
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  createNewHouse(): void {
    void this.router.navigate(['/house']);
  }

  openHouse(house: House): void {
    void this.router.navigate(['/house', house.id]);
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    if (isEditableKeyboardTarget(event.target)) {
      return;
    }

    const list = this.filtered;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.length === 0) {
        return;
      }
      this.selectedHouseIndex = moveListSelection(
        this.selectedHouseIndex,
        event.key === 'ArrowDown' ? 'down' : 'up',
        list.length
      );
      this.scrollToSelectedHouse();
      this.cdr.markForCheck();
      return;
    }

    if (event.key === 'Enter' && this.selectedHouseIndex >= 0) {
      event.preventDefault();
      const selected = list[this.selectedHouseIndex];
      if (selected) {
        this.openHouse(selected);
      }
      return;
    }

    if (plainLetterKey(event) === 'n') {
      event.preventDefault();
      this.createNewHouse();
    }
  }

  private scrollToSelectedHouse(): void {
    if (this.selectedHouseIndex < 0) {
      return;
    }
    setTimeout(() => {
      const selectedElement = document.querySelector(
        `.house-card[data-index="${this.selectedHouseIndex}"]`
      ) as HTMLElement | null;
      selectedElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  }
}

import { DestroyRef, inject, Component, OnInit, NgZone, ChangeDetectorRef, HostListener } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Book } from '../../core/interfaces/project.interface';
import { Location } from '../../core/interfaces/location.interface';
import {
  MetadataService,
  LocationService,
  ProjectService,
  LoggingService,
  MetadataHelperService,
} from '../../core/services';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { contrastTextColor } from '../../core/utils/color-contrast.utils';
import { getBookDisplayName } from '../../core/utils/book-display.utils';

@Component({
  selector: 'app-location-list',
  imports: [FormsModule, PageHeaderComponent],
  templateUrl: './location-list.component.html',
  styleUrls: ['./location-list.component.scss'],
})
export class LocationListComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  allLocations: Location[] = [];
  filteredLocations: Location[] = [];
  books: Book[] = [];
  thumbnailDataUrls: Map<string, string> = new Map();

  searchTerm = '';
  selectedBook = '';
  selectedPictureFilter: '' | 'with' | 'without' = '';
  sortBy: 'name' | 'modified' | 'book' = 'name';
  sortDirection: 'asc' | 'desc' = 'asc';
  viewMode: 'grid' | 'list' = 'grid';
  selectedLocationIndex = -1;
  isLoading = false;
  error: string | null = null;

  constructor(
    private metadataService: MetadataService,
    private locationService: LocationService,
    private projectService: ProjectService,
    private router: Router,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
    private logger: LoggingService,
    private metadataHelper: MetadataHelperService
  ) {}

  ngOnInit(): void {
    const savedViewMode = localStorage.getItem('locationViewMode') as 'grid' | 'list';
    if (savedViewMode) {
      this.viewMode = savedViewMode;
    }

    const savedSearchTerm = localStorage.getItem('locationSearchTerm');
    if (savedSearchTerm) {
      this.searchTerm = savedSearchTerm;
    }

    const savedBook = localStorage.getItem('locationSelectedBook');
    if (savedBook) {
      this.selectedBook = savedBook;
    }

    const savedSortBy = localStorage.getItem('locationSortBy') as 'name' | 'modified' | 'book' | null;
    if (savedSortBy === 'name' || savedSortBy === 'modified' || savedSortBy === 'book') {
      this.sortBy = savedSortBy;
    }
    const savedSortDirection = localStorage.getItem('locationSortDirection') as 'asc' | 'desc' | null;
    if (savedSortDirection === 'asc' || savedSortDirection === 'desc') {
      this.sortDirection = savedSortDirection;
    }

    void this.loadLocationsIfNeeded();

    this.locationService
      .getLocations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((locations) => {
        this.allLocations = locations;
        this.applyFilters();
        void this.loadThumbnails(locations);
      });

    this.metadataService.metadata$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((metadata) => {
        if (metadata) {
          this.books = metadata.books || [];
          this.applyFilters();
        }
      });
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.filteredLocations.length === 0) {
        return;
      }
      if (event.key === 'ArrowDown') {
        this.selectedLocationIndex =
          this.selectedLocationIndex < this.filteredLocations.length - 1
            ? this.selectedLocationIndex + 1
            : 0;
      } else {
        this.selectedLocationIndex =
          this.selectedLocationIndex > 0
            ? this.selectedLocationIndex - 1
            : this.filteredLocations.length - 1;
      }
      this.scrollToSelectedLocation();
      return;
    }

    if (event.key === 'Enter' && this.selectedLocationIndex >= 0) {
      event.preventDefault();
      const selected = this.filteredLocations[this.selectedLocationIndex];
      if (selected) {
        this.editLocation(selected);
      }
      return;
    }

    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      this.createNewLocation();
      return;
    }

    if (event.key === 'l' || event.key === 'L') {
      event.preventDefault();
      this.toggleViewMode();
      return;
    }
  }

  private scrollToSelectedLocation(): void {
    if (this.selectedLocationIndex < 0) {
      return;
    }
    setTimeout(() => {
      const selectedElement = document.querySelector(
        `.location-item[data-index="${this.selectedLocationIndex}"]`
      ) as HTMLElement | null;
      selectedElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  }

  private async loadLocationsIfNeeded(): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      return;
    }

    this.isLoading = true;
    this.error = null;
    try {
      await this.locationService.loadLocations(project.path);
    } catch (error) {
      this.error = `Failed to load locations: ${error}`;
      this.logger.error('Failed to load locations:', error);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  async refreshLocations(): Promise<void> {
    this.isLoading = true;
    this.error = null;
    try {
      await this.locationService.forceReloadLocations();
    } catch (error) {
      this.error = `Failed to refresh locations: ${error}`;
      this.logger.error('Failed to refresh locations:', error);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  private async loadThumbnails(locations: Location[]): Promise<void> {
    await this.ngZone.runOutsideAngular(async () => {
      await this.locationService.loadThumbnailsForLocations(locations);
      for (const location of locations) {
        const cached = this.locationService.getCachedThumbnail(location.id);
        if (cached) {
          this.thumbnailDataUrls.set(location.id, cached);
        }
      }
    });
    this.cdr.detectChanges();
  }

  onSearchChange(): void {
    localStorage.setItem('locationSearchTerm', this.searchTerm);
    this.applyFilters();
  }

  clearSearchTerm(): void {
    this.searchTerm = '';
    localStorage.removeItem('locationSearchTerm');
    this.applyFilters();
  }

  onFilterChange(): void {
    if (this.selectedBook) {
      localStorage.setItem('locationSelectedBook', this.selectedBook);
    } else {
      localStorage.removeItem('locationSelectedBook');
    }
    this.applyFilters();
  }

  clearFilters(): void {
    this.clearSearchTerm();
    this.selectedBook = '';
    this.selectedPictureFilter = '';
    localStorage.removeItem('locationSelectedBook');
    this.applyFilters();
  }

  private applyFilters(): void {
    const searchLower = this.searchTerm.trim().toLowerCase();

    const filtered = this.allLocations.filter((location) => {
      if (this.selectedBook && !location.books.includes(this.selectedBook)) {
        return false;
      }
      if (this.selectedPictureFilter === 'with' && !location.thumbnail) {
        return false;
      }
      if (this.selectedPictureFilter === 'without' && location.thumbnail) {
        return false;
      }
      if (!searchLower) {
        return true;
      }

      const bookNames = location.books
        .map((bookId) => this.metadataHelper.getBookName(bookId).toLowerCase())
        .join(' ');
      return (
        location.name.toLowerCase().includes(searchLower) ||
        bookNames.includes(searchLower) ||
        (location.content || '').toLowerCase().includes(searchLower)
      );
    });

    this.filteredLocations = this.sortLocations(filtered);
    if (this.selectedLocationIndex >= this.filteredLocations.length) {
      this.selectedLocationIndex = this.filteredLocations.length > 0 ? 0 : -1;
    }
  }

  setSortBy(sortBy: 'name' | 'modified' | 'book'): void {
    if (this.sortBy === sortBy) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = sortBy;
      this.sortDirection = sortBy === 'modified' ? 'desc' : 'asc';
    }

    localStorage.setItem('locationSortBy', this.sortBy);
    localStorage.setItem('locationSortDirection', this.sortDirection);
    this.applyFilters();
  }

  private sortLocations(locations: Location[]): Location[] {
    const sorted = [...locations];

    if (this.sortBy === 'modified') {
      sorted.sort((a, b) => {
        const comparison = a.modified.getTime() - b.modified.getTime();
        if (comparison !== 0) {
          return this.sortDirection === 'asc' ? comparison : -comparison;
        }
        return a.name.localeCompare(b.name);
      });
      return sorted;
    }

    if (this.sortBy === 'book') {
      sorted.sort((a, b) => {
        const bookComparison = this.getPrimaryBookIndex(a) - this.getPrimaryBookIndex(b);
        if (bookComparison !== 0) {
          return this.sortDirection === 'asc' ? bookComparison : -bookComparison;
        }
        return a.name.localeCompare(b.name);
      });
      return sorted;
    }

    sorted.sort((a, b) => {
      const comparison = a.name.localeCompare(b.name);
      return this.sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }

  /** Earliest assigned book in project order; locations with no books sort last. */
  private getPrimaryBookIndex(location: Location): number {
    if (!location.books?.length || !this.books.length) {
      return Number.MAX_SAFE_INTEGER;
    }
    let best = Number.MAX_SAFE_INTEGER;
    for (const bookId of location.books) {
      const index = this.books.findIndex((book) => book.id === bookId);
      if (index !== -1 && index < best) {
        best = index;
      }
    }
    return best;
  }

  setViewMode(mode: 'grid' | 'list'): void {
    this.viewMode = mode;
    localStorage.setItem('locationViewMode', this.viewMode);
  }

  toggleViewMode(): void {
    this.setViewMode(this.viewMode === 'grid' ? 'list' : 'grid');
  }

  createNewLocation(): void {
    this.router.navigate(['/location']);
  }

  editLocation(location: Location): void {
    this.router.navigate(['/location', location.id]);
  }

  getLocationThumbnail(location: Location): string | null {
    return this.thumbnailDataUrls.get(location.id) || null;
  }

  getLocationBooks(location: Location): Book[] {
    return this.books.filter((book) => location.books.includes(book.id));
  }

  getBookLabel(book: Book): string {
    return getBookDisplayName(book);
  }

  getBookTextColor(color: string): string {
    return contrastTextColor(color);
  }

  get hasActiveFilters(): boolean {
    return !!(this.searchTerm || this.selectedBook || this.selectedPictureFilter);
  }
}

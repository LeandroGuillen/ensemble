import { DestroyRef, inject, Component, OnInit, NgZone, ChangeDetectorRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Book, Category, Tag } from '../../core/interfaces/project.interface';
import { Location } from '../../core/interfaces/location.interface';
import {
  MetadataService,
  LocationService,
  ProjectService,
  LoggingService,
  ModalService,
  MetadataHelperService,
  NotificationService,
} from '../../core/services';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { contrastTextColor } from '../../core/utils/color-contrast.utils';

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
  categories: Category[] = [];
  tags: Tag[] = [];
  books: Book[] = [];
  thumbnailDataUrls: Map<string, string> = new Map();

  searchTerm = '';
  selectedCategory = '';
  selectedBook = '';
  selectedPictureFilter: '' | 'with' | 'without' = '';
  viewMode: 'grid' | 'list' = 'grid';
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
    private modalService: ModalService,
    private metadataHelper: MetadataHelperService,
    private notificationService: NotificationService
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
          this.categories = metadata.categories || [];
          this.tags = metadata.tags || [];
          this.books = metadata.books || [];
          this.applyFilters();
        }
      });
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
    this.applyFilters();
  }

  private applyFilters(): void {
    const searchLower = this.searchTerm.trim().toLowerCase();

    this.filteredLocations = this.allLocations.filter((location) => {
      if (this.selectedCategory && location.category !== this.selectedCategory) {
        return false;
      }
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

      const categoryName = this.getCategoryName(location.category).toLowerCase();
      const tagNames = location.tags
        .map((tagId) => this.metadataHelper.getTagName(tagId).toLowerCase())
        .join(' ');
      return (
        location.name.toLowerCase().includes(searchLower) ||
        categoryName.includes(searchLower) ||
        tagNames.includes(searchLower) ||
        (location.content || '').toLowerCase().includes(searchLower)
      );
    });
  }

  setViewMode(mode: 'grid' | 'list'): void {
    this.viewMode = mode;
    localStorage.setItem('locationViewMode', this.viewMode);
  }

  createNewLocation(): void {
    this.router.navigate(['/location']);
  }

  editLocation(location: Location): void {
    this.router.navigate(['/location', location.id]);
  }

  async deleteLocation(location: Location, event: Event): Promise<void> {
    event.stopPropagation();

    if (
      !(await this.modalService.confirm(
        `Are you sure you want to delete the location "${location.name}"?`
      ))
    ) {
      return;
    }

    try {
      await this.locationService.deleteLocation(location.id);
      this.notificationService.showSuccess(`Deleted ${location.name}`);
    } catch (error) {
      this.error = `Failed to delete location: ${error}`;
      this.logger.error('Failed to delete location:', error);
    }
  }

  getCategoryName(categoryId: string): string {
    return this.metadataHelper.getCategoryName(categoryId);
  }

  getCategoryColor(categoryId: string): string {
    return this.metadataHelper.getCategoryColor(categoryId);
  }

  getCategoryTextColor(categoryId: string): string {
    return contrastTextColor(this.getCategoryColor(categoryId));
  }

  getLocationThumbnail(location: Location): string | null {
    return this.thumbnailDataUrls.get(location.id) || null;
  }

  getLocationTags(location: Location): Tag[] {
    return this.tags.filter((tag) => location.tags.includes(tag.id));
  }
}

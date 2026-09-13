import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Location } from '../interfaces/location.interface';
import { CommandPaletteService } from '../../shared/command-palette/command-palette.service';
import { LocationService } from './location.service';
import { MetadataHelperService } from './metadata-helper.service';

/** Keeps location-related commands available independently of the active route. */
@Injectable({
  providedIn: 'root',
})
export class LocationCommandService {
  private active = false;
  private subscribed = false;

  constructor(
    private locationService: LocationService,
    private commandPaletteService: CommandPaletteService,
    private metadataHelper: MetadataHelperService,
    private router: Router
  ) {}

  activate(): void {
    this.active = true;

    if (!this.subscribed) {
      this.subscribed = true;
      this.locationService.getLocations().subscribe((locations) => {
        if (this.active) {
          this.publishAndLoadThumbnails(locations);
        }
      });
    } else {
      this.publishAndLoadThumbnails(this.locationService.getLocationsSnapshot());
    }
  }

  deactivate(): void {
    this.active = false;
    this.commandPaletteService.replaceGroup('locations', []);
  }

  private publish(locations: Location[]): void {
    this.commandPaletteService.replaceGroup('locations', [
      {
        id: 'new-location',
        label: 'New Location',
        icon: '➕',
        keywords: ['create', 'add', 'location', 'new', 'place', 'setting'],
        group: 'locations',
        action: () => this.router.navigate(['/location']),
      },
      ...locations.map((location) => ({
        id: `location-${location.id}`,
        label: location.name,
        thumbnail: this.locationService.getCachedThumbnail(location.id) || undefined,
        metadata: this.metadataHelper.getCategoryName(location.category),
        keywords: [
          location.name,
          this.metadataHelper.getCategoryName(location.category),
          ...location.tags.map((tagId) => this.metadataHelper.getTagName(tagId)),
          ...location.books.map((bookId) => this.metadataHelper.getBookName(bookId)),
        ],
        group: 'locations',
        action: () => this.router.navigate(['/location', location.id]),
      })),
    ]);
  }

  private publishAndLoadThumbnails(locations: Location[]): void {
    this.publish(locations);
    void this.locationService.loadThumbnailsForLocations(locations).then(() => {
      if (this.active) {
        this.publish(this.locationService.getLocationsSnapshot());
      }
    });
  }
}

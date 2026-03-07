import {
  Component,
  OnInit,
  OnDestroy,
  NgZone,
  ChangeDetectorRef,
} from "@angular/core";
import { Router } from "@angular/router";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Subject, takeUntil } from "rxjs";
import { Cast, Category } from "../../core/interfaces/project.interface";
import { Character } from "../../core/interfaces/character.interface";
import {
  MetadataService,
  CharacterService,
  CastService,
  ElectronService,
  ProjectService,
  LoggingService,
} from "../../core/services";
import { PageHeaderComponent } from "../../shared/page-header/page-header.component";

@Component({
  selector: "app-cast-list",
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  templateUrl: "./cast-list.component.html",
  styleUrls: ["./cast-list.component.scss"],
})
export class CastListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  casts: Cast[] = [];
  allCasts: Cast[] = [];
  filteredCasts: Cast[] = [];
  characters: Character[] = [];
  categories: Category[] = [];
  characterThumbnails: Map<string, string> = new Map();
  castThumbnails: Map<string, string> = new Map();

  searchTerm = "";
  viewMode: "grid" | "list" = "grid";
  isLoading = false;
  error: string | null = null;

  constructor(
    private metadataService: MetadataService,
    private characterService: CharacterService,
    private castService: CastService,
    private electronService: ElectronService,
    private projectService: ProjectService,
    private router: Router,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
    private logger: LoggingService
  ) {}

  ngOnInit(): void {
    // Load saved view mode preference
    const savedViewMode = localStorage.getItem("castViewMode") as
      | "grid"
      | "list";
    if (savedViewMode) {
      this.viewMode = savedViewMode;
    }

    // Load saved search term
    const savedSearchTerm = localStorage.getItem("castSearchTerm");
    if (savedSearchTerm) {
      this.searchTerm = savedSearchTerm;
    }

    // Ensure characters are loaded for the current project
    this.loadCharactersIfNeeded();

    // Ensure casts are loaded for the current project
    this.loadCastsIfNeeded();

    // Subscribe to CastService for casts with folder data
    this.castService
      .getCasts()
      .pipe(takeUntil(this.destroy$))
      .subscribe((casts) => {
        this.allCasts = casts;
        this.casts = casts;
        this.applyFilters();
        this.loadCastThumbnails(casts);
      });

    // Subscribe to metadata changes for categories
    this.metadataService.metadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe((metadata) => {
        if (metadata) {
          this.categories = metadata.categories || [];
        }
      });

    // Subscribe to character changes
    this.characterService
      .getCharacters()
      .pipe(takeUntil(this.destroy$))
      .subscribe((characters) => {
        this.characters = characters;
        this.loadCharacterThumbnails(characters);
      });
  }

  private async loadCharactersIfNeeded(): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      return;
    }

    try {
      await this.characterService.loadCharacters(project.path);
    } catch (error) {
      this.logger.error("Failed to load characters:", error);
    }
  }

  private async loadCastsIfNeeded(): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      return;
    }

    try {
      await this.castService.loadCasts(project.path);
    } catch (error) {
      this.logger.error("Failed to load casts:", error);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadCharacterThumbnails(
    characters: Character[]
  ): Promise<void> {
    await this.ngZone.runOutsideAngular(async () => {
      const thumbnailPromises = characters
        .filter((char) => !this.characterThumbnails.has(char.id))
        .map(async (character) => {
          try {
            const dataUrl = await this.getCharacterThumbnailDataUrl(character);
            if (dataUrl) {
              this.characterThumbnails.set(character.id, dataUrl);
            }
          } catch (error) {
            this.logger.error(
              `Failed to load thumbnail for character ${character.name}:`,
              error
            );
          }
        });

      await Promise.all(thumbnailPromises);
    });

    this.cdr.detectChanges();
  }

  private async getCharacterThumbnailDataUrl(character: Character): Promise<string | null> {
    const cached = this.characterService.getCachedThumbnail(character.id);
    if (cached) {
      return cached;
    }
    return this.characterService.loadThumbnailForCharacter(character);
  }

  private async loadCastThumbnails(casts: Cast[]): Promise<void> {
    await this.ngZone.runOutsideAngular(async () => {
      const thumbnailPromises = casts
        .filter(
          (cast) =>
            cast.thumbnail &&
            cast.folderPath &&
            !this.castThumbnails.has(cast.id)
        )
        .map(async (cast) => {
          try {
            const thumbnailPath = await this.electronService.pathJoin(
              cast.folderPath!,
              cast.thumbnail!
            );
            const dataUrl = await this.electronService.getImageAsDataUrl(
              thumbnailPath
            );
            if (dataUrl) {
              this.castThumbnails.set(cast.id, dataUrl);
            }
          } catch (error) {
            this.logger.error(
              `Failed to load thumbnail for cast ${cast.name}:`,
              error
            );
          }
        });

      await Promise.all(thumbnailPromises);
    });

    this.cdr.detectChanges();
  }

  onSearchChange(): void {
    localStorage.setItem("castSearchTerm", this.searchTerm);
    this.applyFilters();
  }

  clearSearchTerm(): void {
    this.searchTerm = "";
    localStorage.removeItem("castSearchTerm");
    this.applyFilters();
  }

  private applyFilters(): void {
    if (!this.searchTerm.trim()) {
      this.filteredCasts = this.allCasts;
      return;
    }

    const searchLower = this.searchTerm.toLowerCase();
    this.filteredCasts = this.allCasts.filter((cast) => {
      // Search by cast name
      if (cast.name.toLowerCase().includes(searchLower)) {
        return true;
      }

      // Search by character names in the cast
      const castCharacters = this.getCastCharacters(cast);
      return castCharacters.some((char) =>
        char.name.toLowerCase().includes(searchLower)
      );
    });
  }

  setViewMode(mode: "grid" | "list"): void {
    this.viewMode = mode;
    localStorage.setItem("castViewMode", this.viewMode);
  }

  createNewCast(): void {
    this.router.navigate(["/cast/new"]);
  }

  editCast(cast: Cast): void {
    this.router.navigate(["/cast", cast.id]);
  }

  async deleteCast(cast: Cast, event: Event): Promise<void> {
    event.stopPropagation();

    if (
      confirm(
        `Are you sure you want to delete the cast "${cast.name}"?\n\nThis will not delete the characters themselves.`
      )
    ) {
      try {
        await this.metadataService.removeCast(cast.id);
      } catch (error) {
        this.error = `Failed to delete cast: ${error}`;
        this.logger.error("Failed to delete cast:", error);
      }
    }
  }

  getCastCharacters(cast: Cast): Character[] {
    return this.characters.filter((char) =>
      cast.characterIds.includes(char.id)
    );
  }

  getCastCharacterCount(cast: Cast): number {
    return cast.characterIds.length;
  }

  // Get cast thumbnail (custom or character collage)
  getCastThumbnail(cast: Cast): string | null {
    // First, check if cast has a custom thumbnail
    if (this.castThumbnails.has(cast.id)) {
      return this.castThumbnails.get(cast.id)!;
    }
    return null;
  }

  // Get up to 4 character thumbnails for collage, ordered by category
  getCastThumbnailCollage(cast: Cast): string[] {
    const castCharacters = this.getCastCharacters(cast).filter((char) =>
      this.characterThumbnails.has(char.id)
    );

    // Sort by category order (as defined in categories array)
    const sortedCharacters = castCharacters.sort((a, b) => {
      const aIndex = this.categories.findIndex((cat) => cat.id === a.category);
      const bIndex = this.categories.findIndex((cat) => cat.id === b.category);
      return aIndex - bIndex;
    });

    // Get up to 4 thumbnails
    return sortedCharacters
      .slice(0, 4)
      .map((char) => this.characterThumbnails.get(char.id)!)
      .filter((url) => url);
  }

  getCharacterName(characterId: string): string {
    const character = this.characters.find((char) => char.id === characterId);
    return character?.name || characterId;
  }

  getCategoryName(categoryId: string): string {
    const category = this.categories.find((cat) => cat.id === categoryId);
    return category?.name || categoryId;
  }
}

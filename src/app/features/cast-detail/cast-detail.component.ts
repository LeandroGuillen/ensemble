import {
  Component,
  OnInit,
  OnDestroy,
  NgZone,
  ChangeDetectorRef,
} from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { CommonModule } from "@angular/common";
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from "@angular/forms";
import { Subject, takeUntil } from "rxjs";
import { Cast, Category } from "../../core/interfaces/project.interface";
import { Character } from "../../core/interfaces/character.interface";
import {
  MetadataService,
  CharacterService,
  ElectronService,
  ProjectService,
  CastService,
} from "../../core/services";
import { PageHeaderComponent } from "../../shared/page-header/page-header.component";

@Component({
  selector: "app-cast-detail",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    PageHeaderComponent,
  ],
  templateUrl: "./cast-detail.component.html",
  styleUrls: ["./cast-detail.component.scss"],
})
export class CastDetailComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  castId: string | null = null;
  isNewCast = false;
  cast: Cast | null = null;

  castForm: FormGroup;
  characters: Character[] = [];
  categories: Category[] = [];
  characterThumbnails: Map<string, string> = new Map();
  selectedFilter = "";
  availableFilter = "";

  // Drag and drop state
  draggedCharacterId: string | null = null;
  dragOverZone: "selected" | "available" | null = null;

  // Thumbnail state
  castThumbnail: string | null = null;
  isUploadingThumbnail = false;
  pendingThumbnailPath: string | null = null;

  isLoading = false;
  isSaving = false;
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private metadataService: MetadataService,
    private characterService: CharacterService,
    private castService: CastService,
    private electronService: ElectronService,
    private projectService: ProjectService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef
  ) {
    this.castForm = this.fb.group({
      name: ["", [Validators.required, Validators.maxLength(100)]],
      characterIds: [[], []],
      description: [""],
    });
  }

  ngOnInit(): void {
    // Ensure characters are loaded for the current project
    this.loadCharactersIfNeeded();

    // Get cast ID from route
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = params.get("id");
      this.isNewCast = id === "new";
      this.castId = this.isNewCast ? null : id;
      this.loadCast();
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

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadCharactersIfNeeded(): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      return;
    }

    try {
      await this.characterService.loadCharacters(project.path);
    } catch (error) {
      console.error("Failed to load characters:", error);
    }
  }

  private async loadCast(): Promise<void> {
    if (this.isNewCast) {
      // New cast - reset form
      this.castForm.reset({
        name: "",
        characterIds: [],
        description: "",
      });
      this.castThumbnail = null;
      this.pendingThumbnailPath = null;
    } else if (this.castId) {
      // Load existing cast from CastService (includes folder data)
      const cast = this.castService.getCastById(this.castId);
      if (cast) {
        this.cast = cast;
        this.castForm.patchValue({
          name: cast.name,
          characterIds: cast.characterIds || [],
          description: cast.description || "",
        });

        // Load thumbnail if exists
        await this.loadCastThumbnail(cast);
      } else {
        this.error = "Cast not found";
        setTimeout(() => this.router.navigate(["/casts"]), 2000);
      }
    }
  }

  private async loadCharacterThumbnails(
    characters: Character[]
  ): Promise<void> {
    await this.ngZone.runOutsideAngular(async () => {
      const thumbnailPromises = characters
        .filter((char) => !this.characterThumbnails.has(char.id))
        .map(async (character) => {
          try {
            const dataUrl = await this.getThumbnailDataUrl(character);
            if (dataUrl) {
              this.characterThumbnails.set(character.id, dataUrl);
            }
          } catch (error) {
            console.error(
              `Failed to load thumbnail for character ${character.name}:`,
              error
            );
          }
        });

      await Promise.all(thumbnailPromises);
    });

    this.cdr.detectChanges();
  }

  private async getThumbnailDataUrl(character: Character): Promise<string | null> {
    try {
      // Try to get primary image from images array first
      const primaryImage = this.characterService.getPrimaryImage(character);

      if (primaryImage) {
        // Try new location first (images/ subfolder), then old location (root)
        let thumbnailPath: string;

        if (primaryImage.filename.includes('/')) {
          // Filename includes path, use as-is
          thumbnailPath = `${character.folderPath}/${primaryImage.filename}`;
        } else {
          // Try images/ folder first
          const newPath = `${character.folderPath}/images/${primaryImage.filename}`;
          const existsInNew = await this.electronService.fileExists(newPath);

          if (existsInNew) {
            thumbnailPath = newPath;
          } else {
            // Fall back to root folder
            thumbnailPath = `${character.folderPath}/${primaryImage.filename}`;
          }
        }

        return await this.electronService.getImageAsDataUrl(thumbnailPath);
      }

      // Fallback to old thumbnail field
      if (character.thumbnail) {
        const thumbnailPath = `${character.folderPath}/${character.thumbnail}`;
        return await this.electronService.getImageAsDataUrl(thumbnailPath);
      }

      return null;
    } catch (error) {
      console.error('Failed to load thumbnail as data URL:', error);
      return null;
    }
  }

  private async loadCastThumbnail(cast: Cast): Promise<void> {
    if (!cast.thumbnail || !cast.folderPath) {
      this.castThumbnail = null;
      return;
    }

    try {
      const thumbnailPath = await this.electronService.pathJoin(
        cast.folderPath,
        cast.thumbnail
      );
      const dataUrl = await this.electronService.getImageAsDataUrl(
        thumbnailPath
      );
      this.castThumbnail = dataUrl || null;
    } catch (error) {
      console.error("Failed to load cast thumbnail:", error);
      this.castThumbnail = null;
    }
  }

  // Get selected characters ordered by category
  getSelectedCharacters(): Character[] {
    const selectedIds = this.castForm.get("characterIds")?.value || [];
    const selectedCharacters = this.characters.filter((char) =>
      selectedIds.includes(char.id)
    );

    return this.sortByCategory(selectedCharacters);
  }

  // Get available (unselected) characters ordered by category
  getAvailableCharacters(): Character[] {
    const selectedIds = this.castForm.get("characterIds")?.value || [];
    const availableCharacters = this.characters.filter(
      (char) => !selectedIds.includes(char.id)
    );

    return this.sortByCategory(availableCharacters);
  }

  // Filter selected characters by search term
  getFilteredSelectedCharacters(): Character[] {
    const selected = this.getSelectedCharacters();

    if (!this.selectedFilter.trim()) {
      return selected;
    }

    const filterLower = this.selectedFilter.toLowerCase().trim();
    return selected.filter((character) => {
      const nameMatch = character.name.toLowerCase().includes(filterLower);
      const categoryMatch = this.getCategoryName(character.category)
        .toLowerCase()
        .includes(filterLower);
      return nameMatch || categoryMatch;
    });
  }

  // Filter available characters by search term
  getFilteredAvailableCharacters(): Character[] {
    const available = this.getAvailableCharacters();

    if (!this.availableFilter.trim()) {
      return available;
    }

    const filterLower = this.availableFilter.toLowerCase().trim();
    return available.filter((character) => {
      const nameMatch = character.name.toLowerCase().includes(filterLower);
      const categoryMatch = this.getCategoryName(character.category)
        .toLowerCase()
        .includes(filterLower);
      return nameMatch || categoryMatch;
    });
  }

  // Sort characters by category order
  private sortByCategory(characters: Character[]): Character[] {
    return characters.sort((a, b) => {
      const aIndex = this.categories.findIndex((cat) => cat.id === a.category);
      const bIndex = this.categories.findIndex((cat) => cat.id === b.category);
      const aPos = aIndex === -1 ? 9999 : aIndex;
      const bPos = bIndex === -1 ? 9999 : bIndex;

      if (aPos !== bPos) {
        return aPos - bPos;
      }

      return a.name.localeCompare(b.name);
    });
  }

  // Drag and drop handlers
  onDragStart(event: DragEvent, characterId: string): void {
    this.draggedCharacterId = characterId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", characterId);
    }
  }

  onDragEnd(event: DragEvent): void {
    this.draggedCharacterId = null;
    this.dragOverZone = null;
  }

  onDragOver(event: DragEvent, zone: "selected" | "available"): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    this.dragOverZone = zone;
  }

  onDragLeave(event: DragEvent): void {
    // Only clear if we're leaving the drop zone entirely
    const target = event.target as HTMLElement;
    if (target.classList.contains("character-drop-zone")) {
      this.dragOverZone = null;
    }
  }

  onDrop(event: DragEvent, zone: "selected" | "available"): void {
    event.preventDefault();
    this.dragOverZone = null;

    const characterId = event.dataTransfer?.getData("text/plain");
    if (!characterId) return;

    const currentIds = this.castForm.get("characterIds")?.value || [];
    const isCurrentlySelected = currentIds.includes(characterId);

    if (zone === "selected" && !isCurrentlySelected) {
      // Add to cast
      currentIds.push(characterId);
      this.castForm.patchValue({ characterIds: currentIds });
    } else if (zone === "available" && isCurrentlySelected) {
      // Remove from cast
      const index = currentIds.indexOf(characterId);
      if (index > -1) {
        currentIds.splice(index, 1);
        this.castForm.patchValue({ characterIds: currentIds });
      }
    }

    this.draggedCharacterId = null;
  }

  getCharacterThumbnail(characterId: string): string | null {
    return this.characterThumbnails.get(characterId) || null;
  }

  getCategoryName(categoryId: string): string {
    const category = this.categories.find((cat) => cat.id === categoryId);
    return category?.name || categoryId;
  }

  getCategoryColor(categoryId: string): string {
    const category = this.categories.find((cat) => cat.id === categoryId);
    return category?.color || "#95a5a6";
  }

  // Get appropriate text color (black or white) based on background brightness
  getCategoryTextColor(categoryId: string): string {
    const bgColor = this.getCategoryColor(categoryId);

    // Convert hex to RGB
    const hex = bgColor.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Calculate relative luminance using WCAG formula
    // https://www.w3.org/TR/WCAG20-TECHS/G17.html
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Return black for bright backgrounds, white for dark backgrounds
    return luminance > 0.5 ? "#000000" : "#ffffff";
  }

  async saveCast(): Promise<void> {
    if (this.castForm.invalid) {
      this.markFormTouched();
      return;
    }

    try {
      this.isSaving = true;
      this.error = null;

      const formData = this.castForm.value;

      let savedCast: Cast;

      if (this.isNewCast) {
        savedCast = await this.metadataService.addCast(formData);

        // If there's a pending thumbnail, upload it now
        if (this.pendingThumbnailPath && savedCast.id) {
          try {
            await this.castService.addThumbnail(
              savedCast.id,
              this.pendingThumbnailPath
            );
          } catch (thumbnailError) {
            console.warn(
              "Failed to upload thumbnail after creating cast:",
              thumbnailError
            );
            // Don't fail the entire save operation for thumbnail issues
          }
        }
      } else if (this.castId) {
        savedCast = await this.metadataService.updateCast(
          this.castId,
          formData
        );
      }

      // Navigate back to cast list
      this.router.navigate(["/casts"]);
    } catch (error) {
      this.error = `Failed to save cast: ${error}`;
      console.error("Failed to save cast:", error);
    } finally {
      this.isSaving = false;
    }
  }

  cancel(): void {
    this.router.navigate(["/casts"]);
  }

  async deleteCast(): Promise<void> {
    if (!this.cast) return;

    if (
      confirm(
        `Are you sure you want to delete the cast "${this.cast.name}"?\n\nThis will not delete the characters themselves.`
      )
    ) {
      try {
        await this.metadataService.removeCast(this.cast.id);
        this.router.navigate(["/casts"]);
      } catch (error) {
        this.error = `Failed to delete cast: ${error}`;
        console.error("Failed to delete cast:", error);
      }
    }
  }

  private markFormTouched(): void {
    Object.keys(this.castForm.controls).forEach((key) => {
      const control = this.castForm.get(key);
      control?.markAsTouched();
    });
  }

  getFieldError(fieldName: string): string | null {
    const field = this.castForm.get(fieldName);
    if (field && field.invalid && field.touched) {
      if (field.errors?.["required"]) {
        return `${fieldName} is required`;
      }
      if (field.errors?.["maxlength"]) {
        return `${fieldName} is too long`;
      }
    }
    return null;
  }

  // Thumbnail upload methods
  async selectThumbnail(): Promise<void> {
    if (this.isUploadingThumbnail) {
      return;
    }

    try {
      const imagePath = await this.electronService.selectImage();
      if (imagePath) {
        if (this.isNewCast) {
          // For new casts, just preview the image
          await this.previewThumbnail(imagePath);
        } else {
          // For existing casts, upload immediately
          await this.uploadThumbnail(imagePath);
        }
      }
    } catch (error) {
      this.error = `Failed to select thumbnail: ${error}`;
      console.error("Failed to select thumbnail:", error);
    }
  }

  private async previewThumbnail(sourcePath: string): Promise<void> {
    try {
      this.isUploadingThumbnail = true;
      this.error = null;

      // For new casts, just show a preview of the selected image
      const dataUrl = await this.electronService.getImageAsDataUrl(sourcePath);
      if (dataUrl) {
        this.castThumbnail = dataUrl;
        // Store the source path for later upload when cast is saved
        this.pendingThumbnailPath = sourcePath;
      }
    } catch (error) {
      this.error = `Failed to preview thumbnail: ${error}`;
      console.error("Failed to preview thumbnail:", error);
    } finally {
      this.isUploadingThumbnail = false;
    }
  }

  private async uploadThumbnail(sourcePath: string): Promise<void> {
    if (!this.cast || !this.cast.id) return;

    try {
      this.isUploadingThumbnail = true;
      this.error = null;

      // Upload thumbnail via CastService
      const thumbnailFilename = await this.castService.addThumbnail(
        this.cast.id,
        sourcePath
      );

      if (thumbnailFilename) {
        // Reload the cast to get updated thumbnail
        const updatedCast = this.castService.getCastById(this.cast.id);
        if (updatedCast) {
          this.cast = updatedCast;
          await this.loadCastThumbnail(updatedCast);
        }
      }
    } catch (error) {
      this.error = `Failed to upload thumbnail: ${error}`;
      console.error("Failed to upload thumbnail:", error);
    } finally {
      this.isUploadingThumbnail = false;
    }
  }

  async removeThumbnail(): Promise<void> {
    if (!this.castThumbnail) return;

    if (!confirm("Are you sure you want to remove the cast thumbnail?")) {
      return;
    }

    try {
      this.error = null;

      if (this.isNewCast) {
        // For new casts, just clear the preview and pending path
        this.castThumbnail = null;
        this.pendingThumbnailPath = null;
      } else if (this.cast && this.cast.id) {
        // For existing casts, remove from the cast service
        await this.castService.removeThumbnail(this.cast.id);

        // Reload the cast to get updated thumbnail (might find another image)
        const updatedCast = this.castService.getCastById(this.cast.id);
        if (updatedCast) {
          this.cast = updatedCast;
          await this.loadCastThumbnail(updatedCast);
        } else {
          this.castThumbnail = null;
        }
      }
    } catch (error) {
      this.error = `Failed to remove thumbnail: ${error}`;
      console.error("Failed to remove thumbnail:", error);
    }
  }
}

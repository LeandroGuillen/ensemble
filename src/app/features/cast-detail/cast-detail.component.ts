import { DestroyRef, inject, Component, OnInit, OnDestroy, ViewChild, NgZone, ChangeDetectorRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, NavigationEnd } from "@angular/router";

import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from "@angular/forms";
import { Cast, Category } from "../../core/interfaces/project.interface";
import { Character } from "../../core/interfaces/character.interface";
import {
  MetadataService,
  CharacterService,
  ElectronService,
  ProjectService,
  CastService,
  LoggingService,
  NotificationService,
  ModalService,
  MetadataHelperService,
} from "../../core/services";
import { pathJoin } from "../../core/utils/path.utils";
import { contrastTextColor } from "../../core/utils/color-contrast.utils";
import { aliasesMatchSearch } from "../../core/utils/character-alias.utils";
import { CastEditorSessionService } from '../../core/services/cast-editor-session.service';
import { PinboardViewComponent } from '../pinboard-view/pinboard-view.component';
import { PageHeaderComponent } from "../../shared/page-header/page-header.component";

@Component({
    selector: "app-cast-detail",
    imports: [
    FormsModule,
    ReactiveFormsModule,
    PageHeaderComponent,
    PinboardViewComponent
],
    templateUrl: "./cast-detail.component.html",
    styleUrls: ["./cast-detail.component.scss"]
})
export class CastDetailComponent implements OnInit, OnDestroy {
  @ViewChild(PinboardViewComponent) pinboardView?: PinboardViewComponent;
  view: 'members' | 'pinboard' = 'members';
  readonly editorSession = inject(CastEditorSessionService);
  private readonly destroyRef = inject(DestroyRef);

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
  pendingThumbnailRemoval = false;

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
    private cdr: ChangeDetectorRef,
    private logger: LoggingService,
    private notificationService: NotificationService,
    private modalService: ModalService,
    private metadataHelper: MetadataHelperService
  ) {
    this.castForm = this.fb.group({
      name: ["", [Validators.required, Validators.maxLength(100)]],
      characterIds: [[], []],
      description: [""],
    });
  }

  ngOnInit(): void {
    this.updateViewFromRoute();
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(event => {
      if (event instanceof NavigationEnd) this.updateViewFromRoute();
    });
    this.editorSession.changes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(state => {
      if (state && JSON.stringify(this.castForm.value.characterIds) !== JSON.stringify(state.cast.characterIds)) {
        this.castForm.patchValue({ characterIds: [...state.cast.characterIds] }, { emitEvent: false });
        this.castForm.markAsDirty();
      }
    });
    this.castForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      if (this.editorSession.cast) this.editorSession.updateCast(value);
    });
    // Ensure characters are loaded for the current project
    this.loadCharactersIfNeeded();

    // Get cast ID from route
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get("id");
      this.isNewCast = id === "new";
      this.castId = this.isNewCast ? null : id;
      this.loadCast();
    });

    // Subscribe to metadata changes for categories
    this.metadataService.metadata$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((metadata) => {
        if (metadata) {
          this.categories = metadata.categories || [];
        }
      });

    // Subscribe to character changes
    this.characterService
      .getReferenceCharacters()
      .pipe(takeUntilDestroyed(this.destroyRef))
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

  private async loadCast(): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (project) await this.castService.loadCasts(project.path);
    if (this.isNewCast) {
      this.editorSession.end();
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
        const board = this.projectService.getPinboards().find(board => board.id === cast.pinboardId);
        if (board) this.editorSession.begin(cast, board);
        this.castForm.patchValue({
          name: cast.name,
          characterIds: [...(cast.characterIds || [])],
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

  private async getThumbnailDataUrl(character: Character): Promise<string | null> {
    const cached = this.characterService.getCachedThumbnail(character.id);
    if (cached) {
      return cached;
    }
    return this.characterService.loadThumbnailForCharacter(character);
  }

  private async loadCastThumbnail(cast: Cast): Promise<void> {
    if (!cast.thumbnail || !cast.folderPath) {
      this.castThumbnail = null;
      return;
    }

    try {
      const thumbnailPath = pathJoin(
        cast.folderPath,
        cast.thumbnail
      );
      const dataUrl = await this.electronService.getImageAsDataUrl(
        thumbnailPath
      );
      this.castThumbnail = dataUrl || null;
    } catch (error) {
      this.logger.error("Failed to load cast thumbnail:", error);
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
      const aliasMatch = aliasesMatchSearch(character.aliases, filterLower);
      const categoryMatch = this.getCategoryName(character.category)
        .toLowerCase()
        .includes(filterLower);
      return nameMatch || aliasMatch || categoryMatch;
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
      const aliasMatch = aliasesMatchSearch(character.aliases, filterLower);
      const categoryMatch = this.getCategoryName(character.category)
        .toLowerCase()
        .includes(filterLower);
      return nameMatch || aliasMatch || categoryMatch;
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

    const currentIds = [...(this.castForm.get("characterIds")?.value || [])];
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

    this.castForm.markAsDirty();
    this.draggedCharacterId = null;
  }

  getCharacterThumbnail(characterId: string): string | null {
    return this.characterThumbnails.get(characterId) || null;
  }

  getCategoryName(categoryId: string): string {
    return this.metadataHelper.getCategoryName(categoryId);
  }

  getCategoryColor(categoryId: string): string {
    return this.metadataHelper.getCategoryColor(categoryId);
  }

  // Get appropriate text color (black or white) based on background brightness
  getCategoryTextColor(categoryId: string): string {
    return contrastTextColor(this.getCategoryColor(categoryId));
  }

  private updateViewFromRoute(): void {
    this.view = this.route.snapshot.firstChild?.routeConfig?.path === 'pinboard' ? 'pinboard' : 'members';
  }

  async switchView(view: 'members' | 'pinboard'): Promise<void> {
    if (!this.castId || this.isSaving || this.view === view) return;
    this.pinboardView?.networkService.saveViewState();
    await this.router.navigate(view === 'pinboard' ? ['/cast', this.castId, 'pinboard'] : ['/cast', this.castId]);
  }

  ngOnDestroy(): void {
    this.editorSession.end();
  }

  async saveCast(): Promise<void> {
    if (this.castForm.invalid) {
      this.markFormTouched();
      return;
    }

    try {
      this.isSaving = true;
      this.error = null;

      this.pinboardView?.networkService.saveViewState();
      const formData = this.castForm.value;
      const pendingBoard = this.editorSession.board ? structuredClone(this.editorSession.board) : null;

      let savedCast: Cast | undefined;

      if (this.isNewCast) {
        savedCast = await this.metadataService.addCast(formData);
      } else if (this.castId) {
        savedCast = await this.metadataService.updateCast(
          this.castId,
          formData
        );

      }

      if (savedCast) {
        if (this.pendingThumbnailRemoval) await this.castService.removeThumbnail(savedCast.id);
        if (this.pendingThumbnailPath) await this.castService.addThumbnail(savedCast.id, this.pendingThumbnailPath);
        savedCast = this.castService.getCastById(savedCast.id) || savedCast;
        this.pendingThumbnailPath = null;
        this.pendingThumbnailRemoval = false;
        if (pendingBoard && savedCast.pinboardId) {
          await this.projectService.updatePinboardById(savedCast.pinboardId, pendingBoard);
          if (pendingBoard.viewState) await this.projectService.savePinboardViewState(pendingBoard.viewState, savedCast.pinboardId);
        }
        this.cast = savedCast;
        this.editorSession.end();
        this.castForm.markAsPristine();
        await this.router.navigate(['/casts']);
      }
    } catch (error) {
      this.error = `Failed to save cast: ${error}`;
      this.logger.error("Failed to save cast:", error);
    } finally {
      this.isSaving = false;
    }
  }

  cancel(): void {
    this.editorSession.end();
    this.router.navigate(["/casts"]);
  }

  async deleteCast(): Promise<void> {
    if (!this.cast) return;

    if (
      await this.modalService.confirm(
        `Are you sure you want to delete the cast "${this.cast.name}"?\n\nThis will not delete the characters themselves.`
      )
    ) {
      try {
        await this.metadataService.removeCast(this.cast.id);
        this.notificationService.showSuccess(`Cast "${this.cast.name}" deleted successfully`);
        this.router.navigate(["/casts"]);
      } catch (error) {
        this.error = `Failed to delete cast: ${error}`;
        this.logger.error("Failed to delete cast:", error);
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
        await this.previewThumbnail(imagePath);
      }
    } catch (error) {
      this.error = `Failed to select thumbnail: ${error}`;
      this.logger.error("Failed to select thumbnail:", error);
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
        this.pendingThumbnailRemoval = false;
        this.castForm.markAsDirty();
      }
    } catch (error) {
      this.error = `Failed to preview thumbnail: ${error}`;
      this.logger.error("Failed to preview thumbnail:", error);
    } finally {
      this.isUploadingThumbnail = false;
    }
  }

  async removeThumbnail(): Promise<void> {
    if (!this.castThumbnail) return;

    if (!(await this.modalService.confirm("Are you sure you want to remove the cast thumbnail?"))) {
      return;
    }

    this.castThumbnail = null;
    this.pendingThumbnailPath = null;
    this.pendingThumbnailRemoval = !this.isNewCast;
    this.castForm.markAsDirty();
  }
}

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { MetadataService } from '../../core/services/metadata.service';
import { LoggingService } from '../../core/services/logging.service';
import { ProjectService } from '../../core/services/project.service';
import { CharacterService } from '../../core/services/character.service';
import { CastService } from '../../core/services/cast.service';
import { BackstageService } from '../../core/services/backstage.service';
import { ElectronService } from '../../core/services/electron.service';
import { ThemeService } from '../../core/services/theme.service';
import { ColorPaletteService } from '../../core/services/color-palette.service';
import { UpdateService, UpdateStatus } from '../../core/services/update.service';
import { ZoomService } from '../../core/services/zoom.service';
import { Category, Tag, ProjectSettings, CategoryFolderMode } from '../../core/interfaces/project.interface';
import { Character } from '../../core/interfaces/character.interface';
import { Theme } from '../../core/interfaces/theme.interface';
import { ColorPaletteConfig } from '../../core/interfaces/color-palette.interface';
import { BASE_COLOR_NAMES } from '../../core/interfaces/color-palette.interface';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { DEFAULT_BASE_COLORS } from '../../core/utils/color-palette.utils';

interface CategoryFormData {
  name: string;
  color: string;
  description?: string;
  folderMode?: CategoryFolderMode;
  folderPath?: string;
}

interface TagFormData {
  name: string;
  color: string;
}

@Component({
  selector: 'app-metadata-management',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, PageHeaderComponent],
  templateUrl: './metadata-management.component.html',
  styleUrls: ['./metadata-management.component.scss']
})
export class MetadataManagementComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  categories: Category[] = [];
  tags: Tag[] = [];
  settings: ProjectSettings | null = null;
  availableThemes: Theme[] = [];
  currentTheme: Theme | null = null;
  
  // Color palette management
  colorPalette: ColorPaletteConfig | null = null;
  baseColorNames = BASE_COLOR_NAMES;
  editingBaseColorIndex: number | null = null;
  newExtraColor = '';
  colorPaletteExpanded = false;

  // Form states
  showCategoryForm = false;
  showTagForm = false;
  editingCategory: Category | null = null;
  editingTag: Tag | null = null;

  // Forms
  categoryForm: FormGroup;
  tagForm: FormGroup;
  settingsForm: FormGroup;
  
  // Loading states
  loading = false;
  saving = false;
  
  // Error handling
  error: string | null = null;

  // Update checking
  updateStatus: UpdateStatus = { status: 'idle' };
  checkingForUpdates = false;

  zoomPercent = 100;

  // Drag and drop state for categories
  draggedIndex: number | null = null;
  dragOverIndex: number | null = null;

  // Drag and drop state for tags
  tagDraggedIndex: number | null = null;
  tagDragOverIndex: number | null = null;

  // Color presets - uses the shared color palette
  colorPresets: string[] = [];

  constructor(
    private metadataService: MetadataService,
    private projectService: ProjectService,
    private characterService: CharacterService,
    private castService: CastService,
    private backstageService: BackstageService,
    private themeService: ThemeService,
    private colorPaletteService: ColorPaletteService,
    private updateService: UpdateService,
    public zoomService: ZoomService,
    private fb: FormBuilder,
    private logger: LoggingService
  ) {
    this.categoryForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      color: [DEFAULT_BASE_COLORS[0], [Validators.required, Validators.pattern(/^#[0-9A-Fa-f]{6}$/)]],
      description: ['', [Validators.maxLength(500)]],
      folderMode: ['auto'],
      folderPath: ['', [Validators.maxLength(100)]]
    });

    this.tagForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      color: [DEFAULT_BASE_COLORS[2], [Validators.required, Validators.pattern(/^#[0-9A-Fa-f]{6}$/)]]
    });

    this.settingsForm = this.fb.group({
      defaultCategory: ['', Validators.required],
      autoSave: [true],
      fileWatchEnabled: [true],
      charactersFolder: ['', [Validators.maxLength(200)]],
      castsFolder: ['', [Validators.maxLength(200)]],
      namesFile: ['', [Validators.maxLength(500)]],
      theme: ['']
    });
  }

  ngOnInit(): void {
    // Load available themes
    this.availableThemes = this.themeService.getAvailableThemes();
    
    // Subscribe to current theme changes
    this.themeService.currentTheme$
      .pipe(takeUntil(this.destroy$))
      .subscribe(theme => {
        this.currentTheme = theme;
      });
    
    // Subscribe to color palette changes
    this.colorPaletteService.palette$
      .pipe(takeUntil(this.destroy$))
      .subscribe(palette => {
        this.colorPalette = palette;
        if (palette) {
          this.colorPresets = this.colorPaletteService.getAllColors();
        }
      });
    
    // Subscribe to zoom level (for display in General settings)
    this.zoomService.zoomLevel$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.zoomPercent = this.zoomService.getZoomPercent();
      });
    this.zoomPercent = this.zoomService.getZoomPercent();

    // Subscribe to update status changes
    this.updateService.updateStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        this.updateStatus = status;
        // Reset checking flag when status changes from checking
        if (status.status !== 'checking') {
          this.checkingForUpdates = false;
        }
      });
    
    this.loadData();
    
    // Subscribe to metadata changes
    this.metadataService.metadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe(metadata => {
        if (metadata) {
          this.categories = metadata.categories;
          this.tags = metadata.tags;
          this.settings = metadata.settings;
          this.updateSettingsForm();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadData(): Promise<void> {
    try {
      this.loading = true;
      this.error = null;
      
      const project = this.projectService.getCurrentProject();
      if (!project) {
        throw new Error('No project loaded');
      }
      
      await this.metadataService.loadMetadata(project.path);
    } catch (error) {
      this.logger.error('Failed to load metadata:', error);
      this.error = `Failed to load metadata: ${error}`;
    } finally {
      this.loading = false;
    }
  }

  private updateSettingsForm(): void {
    if (this.settings) {
      this.settingsForm.patchValue({
        defaultCategory: this.settings.defaultCategory,
        autoSave: this.settings.autoSave,
        fileWatchEnabled: this.settings.fileWatchEnabled,
        charactersFolder: this.settings.charactersFolder ?? 'characters',
        castsFolder: this.settings.castsFolder ?? 'characters/casts',
        namesFile: this.settings.namesFile ?? 'characters/names.md',
        theme: this.settings.theme || 'blue-gold'
      });
    }
  }

  // Category Management

  showAddCategoryForm(): void {
    this.showCategoryForm = true;
    this.editingCategory = null;
    const defaultColor = this.colorPresets[0] || DEFAULT_BASE_COLORS[0];
    this.categoryForm.reset({
      name: '',
      color: defaultColor,
      description: '',
      folderMode: 'auto',
      folderPath: ''
    });
  }

  showEditCategoryForm(category: Category): void {
    this.showCategoryForm = true;
    this.editingCategory = category;
    this.categoryForm.patchValue({
      name: category.name,
      color: category.color,
      description: category.description || '',
      folderMode: category.folderMode || 'auto',
      folderPath: category.folderPath || ''
    });
  }

  cancelCategoryForm(): void {
    this.showCategoryForm = false;
    this.editingCategory = null;
    this.categoryForm.reset();
  }

  async saveCategory(): Promise<void> {
    if (this.categoryForm.invalid) {
      this.markFormGroupTouched(this.categoryForm);
      return;
    }

    try {
      this.saving = true;
      this.error = null;
      
      const formData: CategoryFormData = this.categoryForm.value;
      
      // Track if folder mode or path changed for relocation
      let needsRelocation = false;
      let categoryId: string | null = null;
      
      if (this.editingCategory) {
        categoryId = this.editingCategory.id;
        
        // Check if folder configuration changed
        const oldFolderMode = this.editingCategory.folderMode || 'auto';
        const oldFolderPath = this.editingCategory.folderPath || '';
        const newFolderMode = formData.folderMode || 'auto';
        const newFolderPath = formData.folderPath || '';
        
        needsRelocation = (oldFolderMode !== newFolderMode) || 
                          (newFolderMode === 'specify' && oldFolderPath !== newFolderPath);
        
        await this.metadataService.updateCategory(this.editingCategory.id, formData);
      } else {
        await this.metadataService.addCategory(formData);
      }
      
      // If folder configuration changed, relocate existing characters
      if (needsRelocation && categoryId) {
        const relocatedCount = await this.characterService.relocateCharactersForCategory(categoryId);
        if (relocatedCount > 0) {
          this.logger.log(`Relocated ${relocatedCount} character(s) due to folder mode change`);
        }
      }
      
      this.cancelCategoryForm();
    } catch (error) {
      this.logger.error('Failed to save category:', error);
      this.error = `Failed to save category: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  async deleteCategory(category: Category): Promise<void> {
    if (!confirm(`Are you sure you want to delete the category "${category.name}"?`)) {
      return;
    }

    try {
      this.saving = true;
      this.error = null;
      
      await this.metadataService.removeCategory(category.id);
    } catch (error) {
      this.logger.error('Failed to delete category:', error);
      this.error = `Failed to delete category: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  // Tag Management

  showAddTagForm(): void {
    this.showTagForm = true;
    this.editingTag = null;
    const defaultColor = this.colorPresets[2] || DEFAULT_BASE_COLORS[2];
    this.tagForm.reset({
      name: '',
      color: defaultColor
    });
  }

  showEditTagForm(tag: Tag): void {
    this.showTagForm = true;
    this.editingTag = tag;
    this.tagForm.patchValue({
      name: tag.name,
      color: tag.color
    });
  }

  cancelTagForm(): void {
    this.showTagForm = false;
    this.editingTag = null;
    this.tagForm.reset();
  }

  async saveTag(): Promise<void> {
    if (this.tagForm.invalid) {
      this.markFormGroupTouched(this.tagForm);
      return;
    }

    try {
      this.saving = true;
      this.error = null;
      
      const formData: TagFormData = this.tagForm.value;
      
      if (this.editingTag) {
        await this.metadataService.updateTag(this.editingTag.id, formData);
      } else {
        await this.metadataService.addTag(formData);
      }
      
      this.cancelTagForm();
    } catch (error) {
      this.logger.error('Failed to save tag:', error);
      this.error = `Failed to save tag: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  async deleteTag(tag: Tag): Promise<void> {
    if (!confirm(`Are you sure you want to delete the tag "${tag.name}"?`)) {
      return;
    }

    try {
      this.saving = true;
      this.error = null;
      
      await this.metadataService.removeTag(tag.id);
    } catch (error) {
      this.logger.error('Failed to delete tag:', error);
      this.error = `Failed to delete tag: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  // Settings Management

  async saveSettings(): Promise<void> {
    if (this.settingsForm.invalid) {
      this.markFormGroupTouched(this.settingsForm);
      return;
    }

    try {
      this.saving = true;
      this.error = null;
      
      const formData = this.settingsForm.value;

      // Normalize charactersFolder: empty or whitespace = default 'characters'
      const charactersFolder = formData.charactersFolder?.trim() || 'characters';
      // Normalize castsFolder: empty or whitespace = default 'characters/casts' (project-relative)
      const castsFolder = formData.castsFolder?.trim() || 'characters/casts';
      // Normalize namesFile: empty or whitespace = default 'characters/names.md'
      const namesFile = formData.namesFile?.trim() || 'characters/names.md';
      const settingsUpdate = {
        ...formData,
        charactersFolder,
        castsFolder,
        namesFile
      };

      // If theme changed, apply it immediately
      if (formData.theme) {
        await this.themeService.setTheme(formData.theme);
      }

      const previousCharactersFolder = this.settings?.charactersFolder?.trim() || 'characters';
      const previousCastsFolder = this.settings?.castsFolder?.trim() || 'casts';
      const previousNamesFile = this.settings?.namesFile?.trim() || 'characters/names.md';
      await this.metadataService.updateSettings(settingsUpdate);

      // Reload characters if folder path changed
      if (charactersFolder !== previousCharactersFolder) {
        await this.characterService.forceReloadCharacters();
      }
      // Reload casts if casts folder path changed (project-relative)
      if (castsFolder !== previousCastsFolder) {
        await this.castService.forceReloadCasts();
      }
      // Reload backstage name lists if names file path changed
      if (namesFile !== previousNamesFile) {
        await this.backstageService.loadBackstageData();
      }
    } catch (error) {
      this.logger.error('Failed to save settings:', error);
      this.error = `Failed to save settings: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  // Color Management

  selectColor(color: string, formType: 'category' | 'tag'): void {
    if (formType === 'category') {
      this.categoryForm.patchValue({ color });
    } else {
      this.tagForm.patchValue({ color });
    }
  }

  // Utility Methods

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.keys(formGroup.controls).forEach(key => {
      const control = formGroup.get(key);
      control?.markAsTouched();
    });
  }

  getFieldError(formGroup: FormGroup, fieldName: string): string | null {
    const field = formGroup.get(fieldName);
    if (field && field.invalid && field.touched) {
      if (field.errors?.['required']) {
        return `${fieldName} is required`;
      }
      if (field.errors?.['maxlength']) {
        return `${fieldName} is too long`;
      }
      if (field.errors?.['pattern']) {
        return `${fieldName} must be a valid hex color`;
      }
    }
    return null;
  }

  isDefaultCategory(categoryId: string): boolean {
    return this.settings?.defaultCategory === categoryId;
  }

  canDeleteCategory(category: Category): boolean {
    return !this.isDefaultCategory(category.id);
  }

  // Drag and Drop Methods for Categories
  onDragStart(event: DragEvent, index: number): void {
    this.draggedIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/html', ''); // Required for Firefox
    }
  }

  onDragOver(event: DragEvent, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    // Don't apply drag-over to the dragged item itself
    if (this.draggedIndex !== null && this.draggedIndex !== index) {
      this.dragOverIndex = index;
    }
  }

  onDrop(event: DragEvent, dropIndex: number): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.draggedIndex !== null) {
      this.performReorder(dropIndex);
    }

    this.draggedIndex = null;
    this.dragOverIndex = null;
  }

  onDragEnd(): void {
    // If we have a valid dragOverIndex, treat it as a drop at that position
    if (this.draggedIndex !== null && this.dragOverIndex !== null) {
      this.performReorder(this.dragOverIndex);
    }

    this.draggedIndex = null;
    this.dragOverIndex = null;
  }

  private performReorder(dropIndex: number): void {
    if (this.draggedIndex === null) {
      return;
    }

    // Don't do anything if dropping in the same position
    if (this.draggedIndex === dropIndex) {
      return;
    }

    // Reorder the categories array
    const newCategories = [...this.categories];
    const draggedCategory = newCategories[this.draggedIndex];

    // Remove from old position
    newCategories.splice(this.draggedIndex, 1);

    // Adjust drop index if dropping after the removed item
    const adjustedDropIndex = dropIndex > this.draggedIndex ? dropIndex - 1 : dropIndex;

    // Insert at new position
    newCategories.splice(adjustedDropIndex, 0, draggedCategory);

    // Update categories in metadata and save
    this.categories = newCategories;
    this.saveReorderedCategories(newCategories);
  }

  private async saveReorderedCategories(newCategories: Category[]): Promise<void> {
    try {
      this.saving = true;
      this.error = null;

      const metadata = this.metadataService.getCurrentMetadata();
      if (!metadata) {
        throw new Error('No metadata loaded');
      }

      const updatedMetadata = {
        ...metadata,
        categories: newCategories
      };

      await this.metadataService.saveMetadata(updatedMetadata);
    } catch (error) {
      this.logger.error('Failed to save reordered categories:', error);
      this.error = `Failed to save category order: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  // Drag and Drop Methods for Tags
  onTagDragStart(event: DragEvent, index: number): void {
    this.tagDraggedIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/html', ''); // Required for Firefox
    }
  }

  onTagDragOver(event: DragEvent, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    // Don't apply drag-over to the dragged item itself
    if (this.tagDraggedIndex !== null && this.tagDraggedIndex !== index) {
      this.tagDragOverIndex = index;
    }
  }

  onTagDrop(event: DragEvent, dropIndex: number): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.tagDraggedIndex !== null) {
      this.performTagReorder(dropIndex);
    }

    this.tagDraggedIndex = null;
    this.tagDragOverIndex = null;
  }

  onTagDragEnd(): void {
    // If we have a valid tagDragOverIndex, treat it as a drop at that position
    if (this.tagDraggedIndex !== null && this.tagDragOverIndex !== null) {
      this.performTagReorder(this.tagDragOverIndex);
    }

    this.tagDraggedIndex = null;
    this.tagDragOverIndex = null;
  }

  private performTagReorder(dropIndex: number): void {
    if (this.tagDraggedIndex === null) {
      return;
    }

    // Don't do anything if dropping in the same position
    if (this.tagDraggedIndex === dropIndex) {
      return;
    }

    // Reorder the tags array
    const newTags = [...this.tags];
    const draggedTag = newTags[this.tagDraggedIndex];

    // Remove from old position
    newTags.splice(this.tagDraggedIndex, 1);

    // Adjust drop index if dropping after the removed item
    const adjustedDropIndex = dropIndex > this.tagDraggedIndex ? dropIndex - 1 : dropIndex;

    // Insert at new position
    newTags.splice(adjustedDropIndex, 0, draggedTag);

    // Update tags in metadata and save
    this.tags = newTags;
    this.saveReorderedTags(newTags);
  }

  private async saveReorderedTags(newTags: Tag[]): Promise<void> {
    try {
      this.saving = true;
      this.error = null;

      const metadata = this.metadataService.getCurrentMetadata();
      if (!metadata) {
        throw new Error('No metadata loaded');
      }

      const updatedMetadata = {
        ...metadata,
        tags: newTags
      };

      await this.metadataService.saveMetadata(updatedMetadata);
    } catch (error) {
      this.logger.error('Failed to save reordered tags:', error);
      this.error = `Failed to save tag order: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  // Color Palette Management

  getBaseColors(): string[] {
    return this.colorPaletteService.getBaseColors();
  }

  getExtraColors(): string[] {
    return this.colorPaletteService.getExtraColors();
  }

  async updateBaseColor(index: number, color: string): Promise<void> {
    try {
      this.saving = true;
      this.error = null;
      await this.colorPaletteService.updateBaseColor(index, color);
    } catch (error) {
      this.logger.error('Failed to update base color:', error);
      this.error = `Failed to update color: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  startEditingBaseColor(index: number): void {
    this.editingBaseColorIndex = index;
  }

  cancelEditingBaseColor(): void {
    this.editingBaseColorIndex = null;
  }

  async saveBaseColor(index: number, color: string): Promise<void> {
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      this.error = 'Invalid color format. Use hex format like #3498db';
      return;
    }
    await this.updateBaseColor(index, color);
    this.editingBaseColorIndex = null;
  }

  async resetBaseColors(): Promise<void> {
    if (!confirm('Reset all base colors to defaults? This cannot be undone.')) {
      return;
    }
    try {
      this.saving = true;
      this.error = null;
      await this.colorPaletteService.resetBaseColors();
    } catch (error) {
      this.logger.error('Failed to reset base colors:', error);
      this.error = `Failed to reset colors: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  async addExtraColor(): Promise<void> {
    if (!this.newExtraColor || !/^#[0-9A-Fa-f]{6}$/.test(this.newExtraColor)) {
      this.error = 'Please enter a valid hex color (e.g., #3498db)';
      return;
    }
    try {
      this.saving = true;
      this.error = null;
      await this.colorPaletteService.addExtraColor(this.newExtraColor);
      this.newExtraColor = '';
    } catch (error) {
      this.logger.error('Failed to add extra color:', error);
      this.error = `Failed to add color: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  async removeExtraColor(color: string): Promise<void> {
    if (!confirm(`Remove color ${color}?`)) {
      return;
    }
    try {
      this.saving = true;
      this.error = null;
      await this.colorPaletteService.removeExtraColor(color);
    } catch (error) {
      this.logger.error('Failed to remove extra color:', error);
      this.error = `Failed to remove color: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  async setThemeOverrides(): Promise<void> {
    if (!this.currentTheme) {
      return;
    }
    const baseColors = this.getBaseColors();
    try {
      this.saving = true;
      this.error = null;
      await this.colorPaletteService.setThemeOverrides(this.currentTheme.id, baseColors);
    } catch (error) {
      this.logger.error('Failed to set theme overrides:', error);
      this.error = `Failed to set theme overrides: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  async removeThemeOverrides(): Promise<void> {
    if (!this.currentTheme) {
      return;
    }
    if (!confirm(`Remove color overrides for ${this.currentTheme.name} theme?`)) {
      return;
    }
    try {
      this.saving = true;
      this.error = null;
      await this.colorPaletteService.removeThemeOverrides(this.currentTheme.id);
    } catch (error) {
      this.logger.error('Failed to remove theme overrides:', error);
      this.error = `Failed to remove theme overrides: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  hasThemeOverrides(): boolean {
    if (!this.currentTheme || !this.colorPalette) {
      return false;
    }
    return !!this.colorPalette.themeOverrides?.[this.currentTheme.id];
  }

  // Update checking
  async checkForUpdates(): Promise<void> {
    this.checkingForUpdates = true;
    this.updateStatus = { status: 'checking', message: 'Checking for updates...' };
    
    try {
      const result = await this.updateService.checkForUpdates();
      if (!result.success) {
        this.updateStatus = {
          status: 'error',
          message: 'Failed to check for updates',
          error: result.error
        };
      }
      // The actual status will be updated via the updateStatus$ subscription
    } catch (error: any) {
      this.logger.error('Error checking for updates', error);
      this.updateStatus = {
        status: 'error',
        message: 'Failed to check for updates',
        error: error.message || 'Unknown error'
      };
      this.checkingForUpdates = false;
    }
  }

  getUpdateStatusMessage(): string {
    if (this.updateStatus.status === 'checking') {
      return 'Checking for updates...';
    } else if (this.updateStatus.status === 'available') {
      return `Update available: ${this.updateStatus.version || 'new version'}`;
    } else if (this.updateStatus.status === 'not-available') {
      return 'You are using the latest version';
    } else if (this.updateStatus.status === 'error') {
      return this.updateStatus.error || 'Error checking for updates';
    }
    return '';
  }

  hasUpdateStatus(): boolean {
    return this.updateStatus.status !== 'idle';
  }

  isUpdateAvailable(): boolean {
    return this.updateStatus.status === 'available';
  }

  isUpdateError(): boolean {
    return this.updateStatus.status === 'error';
  }
}
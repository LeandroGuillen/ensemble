import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { MetadataService } from '../../core/services/metadata.service';
import { ProjectService } from '../../core/services/project.service';
import { Category, Tag, ProjectSettings } from '../../core/interfaces/project.interface';

interface CategoryFormData {
  name: string;
  color: string;
  description?: string;
}

interface TagFormData {
  name: string;
  color: string;
}

@Component({
  selector: 'app-metadata-management',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './metadata-management.component.html',
  styleUrls: ['./metadata-management.component.scss']
})
export class MetadataManagementComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  categories: Category[] = [];
  tags: Tag[] = [];
  settings: ProjectSettings | null = null;
  
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

  // Drag and drop state for categories
  draggedIndex: number | null = null;
  dragOverIndex: number | null = null;

  // Drag and drop state for tags
  tagDraggedIndex: number | null = null;
  tagDragOverIndex: number | null = null;

  // Color presets - distinct and visually unique colors
  colorPresets = [
    '#e74c3c', // Red
    '#3498db', // Blue  
    '#2ecc71', // Green
    '#f39c12', // Orange
    '#9b59b6', // Purple
    '#1abc9c', // Teal
    '#e91e63', // Pink
    '#ff5722', // Deep Orange
    '#4caf50', // Light Green
    '#2196f3', // Light Blue
    '#ff9800', // Amber
    '#795548', // Brown
    '#607d8b', // Blue Grey
    '#ffeb3b', // Yellow
    '#8bc34a'  // Lime
  ];

  constructor(
    private metadataService: MetadataService,
    private projectService: ProjectService,
    private fb: FormBuilder
  ) {
    this.categoryForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      color: ['#3498db', [Validators.required, Validators.pattern(/^#[0-9A-Fa-f]{6}$/)]],
      description: ['', [Validators.maxLength(500)]]
    });
    
    this.tagForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      color: ['#e74c3c', [Validators.required, Validators.pattern(/^#[0-9A-Fa-f]{6}$/)]]
    });
    
    this.settingsForm = this.fb.group({
      defaultCategory: ['', Validators.required],
      autoSave: [true],
      fileWatchEnabled: [true]
    });
  }

  ngOnInit(): void {
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
      console.error('Failed to load metadata:', error);
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
        fileWatchEnabled: this.settings.fileWatchEnabled
      });
    }
  }

  // Category Management

  showAddCategoryForm(): void {
    this.showCategoryForm = true;
    this.editingCategory = null;
    this.categoryForm.reset({
      name: '',
      color: '#3498db',
      description: ''
    });
  }

  showEditCategoryForm(category: Category): void {
    this.showCategoryForm = true;
    this.editingCategory = category;
    this.categoryForm.patchValue({
      name: category.name,
      color: category.color,
      description: category.description || ''
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
      
      if (this.editingCategory) {
        await this.metadataService.updateCategory(this.editingCategory.id, formData);
      } else {
        await this.metadataService.addCategory(formData);
      }
      
      this.cancelCategoryForm();
    } catch (error) {
      console.error('Failed to save category:', error);
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
      console.error('Failed to delete category:', error);
      this.error = `Failed to delete category: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  // Tag Management

  showAddTagForm(): void {
    this.showTagForm = true;
    this.editingTag = null;
    this.tagForm.reset({
      name: '',
      color: '#e74c3c'
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
      console.error('Failed to save tag:', error);
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
      console.error('Failed to delete tag:', error);
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
      await this.metadataService.updateSettings(formData);
    } catch (error) {
      console.error('Failed to save settings:', error);
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
      console.error('Failed to save reordered categories:', error);
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
      console.error('Failed to save reordered tags:', error);
      this.error = `Failed to save tag order: ${error}`;
    } finally {
      this.saving = false;
    }
  }
}
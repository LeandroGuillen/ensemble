import { Component, OnInit, OnDestroy, HostListener, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Character, CharacterFormData, Category, Tag, Book, Project } from '../../core/interfaces';
import { CharacterService, ProjectService, ElectronService, MetadataService } from '../../core/services';

@Component({
  selector: 'app-character-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './character-detail.component.html',
  styleUrls: ['./character-detail.component.scss']
})
export class CharacterDetailComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('nameInput') nameInput?: ElementRef<HTMLInputElement>;

  private destroy$ = new Subject<void>();

  characterForm: FormGroup;
  character: Character | null = null;
  categories: Category[] = [];
  tags: Tag[] = [];
  books: Book[] = [];
  currentProject: Project | null = null;

  isEditing = false;
  isLoading = false;
  isSaving = false;
  error: string | null = null;

  selectedThumbnailPath: string | null = null;
  thumbnailPreview: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private characterService: CharacterService,
    private projectService: ProjectService,
    private electronService: ElectronService,
    private metadataService: MetadataService
  ) {
    this.characterForm = this.createForm();
  }

  ngOnInit(): void {
    // Subscribe to project changes
    this.projectService.currentProject$
      .pipe(takeUntil(this.destroy$))
      .subscribe(project => {
        this.currentProject = project;
        this.categories = this.projectService.getCategories();
        this.tags = this.projectService.getTags();
        this.books = this.metadataService.getBooks();
        
        // Set default category if available
        if (this.categories.length > 0 && !this.isEditing) {
          const defaultCategory = this.categories.find(cat => 
            cat.id === project?.metadata.settings.defaultCategory
          ) || this.categories[0];
          this.characterForm.patchValue({ category: defaultCategory.id });
        }
      });
    
    const characterId = this.route.snapshot.paramMap.get('id');
    if (characterId && characterId !== 'new') {
      this.isEditing = true;
      this.loadCharacter(characterId);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngAfterViewInit(): void {
    // Focus the name input after view is initialized
    setTimeout(() => {
      this.nameInput?.nativeElement.focus();
    }, 0);
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    // Escape to cancel
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onCancel();
      return;
    }

    // Ctrl+Enter to save
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      this.onSubmit();
      return;
    }
  }

  private createForm(): FormGroup {
    return this.fb.group({
      name: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(100)]],
      category: ['', Validators.required],
      tags: [[]],
      books: [[]],
      thumbnail: [''],
      description: [''],
      notes: ['']
    });
  }

  private loadCharacter(id: string): void {
    this.isLoading = true;
    this.error = null;
    
    try {
      this.character = this.characterService.getCharacterById(id) || null;
      if (this.character) {
        this.characterForm.patchValue({
          name: this.character.name,
          category: this.character.category,
          tags: this.character.tags,
          books: this.character.books,
          thumbnail: this.character.thumbnail,
          description: this.character.description,
          notes: this.character.notes
        });
        
        // Set thumbnail preview
        if (this.character.thumbnail && this.currentProject) {
          this.loadThumbnailPreview(`${this.currentProject.path}/thumbnails/${this.character.thumbnail}`);
        }
      } else {
        this.error = 'Character not found';
      }
    } catch (error) {
      this.error = `Failed to load character: ${error}`;
      console.error('Load character error:', error);
    } finally {
      this.isLoading = false;
    }
  }

  async onSubmit(): Promise<void> {
    if (this.characterForm.invalid) {
      this.markFormGroupTouched(this.characterForm);
      return;
    }

    if (!this.currentProject) {
      this.error = 'No project loaded';
      return;
    }

    this.isSaving = true;
    this.error = null;

    try {
      const formData: CharacterFormData = {
        ...this.characterForm.value,
        thumbnail: this.selectedThumbnailPath || this.characterForm.value.thumbnail
      };
      
      if (this.isEditing && this.character) {
        const updatedCharacter = await this.characterService.updateCharacter(this.character.id, formData);
        if (!updatedCharacter) {
          throw new Error('Character not found');
        }
      } else {
        await this.characterService.createCharacter(formData);
      }
      
      this.router.navigate(['/characters']);
    } catch (error) {
      this.error = `Failed to save character: ${error}`;
      console.error('Save error:', error);
    } finally {
      this.isSaving = false;
    }
  }

  onCancel(): void {
    if (this.characterForm.dirty) {
      if (confirm('You have unsaved changes. Are you sure you want to leave?')) {
        this.router.navigate(['/characters']);
      }
    } else {
      this.router.navigate(['/characters']);
    }
  }

  onTagChange(tagId: string, checked: boolean): void {
    const currentTags = this.characterForm.get('tags')?.value || [];
    let updatedTags: string[];
    
    if (checked) {
      updatedTags = [...currentTags, tagId];
    } else {
      updatedTags = currentTags.filter((id: string) => id !== tagId);
    }
    
    this.characterForm.patchValue({ tags: updatedTags });
    this.characterForm.markAsDirty();
  }

  isTagSelected(tagId: string): boolean {
    const selectedTags = this.characterForm.get('tags')?.value || [];
    return selectedTags.includes(tagId);
  }

  onBookChange(bookId: string, checked: boolean): void {
    const currentBooks = this.characterForm.get('books')?.value || [];
    let updatedBooks: string[];
    
    if (checked) {
      updatedBooks = [...currentBooks, bookId];
    } else {
      updatedBooks = currentBooks.filter((id: string) => id !== bookId);
    }
    
    this.characterForm.patchValue({ books: updatedBooks });
    this.characterForm.markAsDirty();
  }

  isBookSelected(bookId: string): boolean {
    const selectedBooks = this.characterForm.get('books')?.value || [];
    return selectedBooks.includes(bookId);
  }

  async selectThumbnail(): Promise<void> {
    try {
      const imagePath = await this.electronService.selectImage();
      if (imagePath) {
        this.selectedThumbnailPath = imagePath;
        await this.loadThumbnailPreview(imagePath);
        this.characterForm.markAsDirty();
      }
    } catch (error) {
      console.error('Failed to select thumbnail:', error);
      this.error = 'Failed to select thumbnail';
    }
  }

  private async loadThumbnailPreview(imagePath: string): Promise<void> {
    try {
      const dataUrl = await this.electronService.getImageAsDataUrl(imagePath);
      this.thumbnailPreview = dataUrl;
    } catch (error) {
      console.error('Failed to load thumbnail preview:', error);
      this.thumbnailPreview = null;
    }
  }

  removeThumbnail(): void {
    this.selectedThumbnailPath = null;
    this.thumbnailPreview = null;
    this.characterForm.patchValue({ thumbnail: '' });
    this.characterForm.markAsDirty();
  }

  getCategoryName(categoryId: string): string {
    const category = this.categories.find(cat => cat.id === categoryId);
    return category?.name || categoryId;
  }

  getCategoryColor(categoryId: string): string {
    const category = this.categories.find(cat => cat.id === categoryId);
    return category?.color || '#95a5a6';
  }

  getCategoryTooltip(categoryId: string): string {
    const category = this.categories.find(cat => cat.id === categoryId);
    if (!category) return categoryId;
    
    if (category.description) {
      return category.description;
    }
    return category.name;
  }

  getTagName(tagId: string): string {
    const tag = this.tags.find(t => t.id === tagId);
    return tag?.name || tagId;
  }

  getTagColor(tagId: string): string {
    const tag = this.tags.find(t => t.id === tagId);
    return tag?.color || '#95a5a6';
  }

  getFieldError(fieldName: string): string | null {
    const field = this.characterForm.get(fieldName);
    if (field && field.invalid && field.touched) {
      if (field.errors?.['required']) {
        return `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} is required`;
      }
      if (field.errors?.['minlength']) {
        return `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} must be at least ${field.errors['minlength'].requiredLength} characters`;
      }
      if (field.errors?.['maxlength']) {
        return `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} must be no more than ${field.errors['maxlength'].requiredLength} characters`;
      }
    }
    return null;
  }

  onTagCheckboxChange(event: Event, tagId: string): void {
    const checkbox = event.target as HTMLInputElement;
    if (checkbox) {
      this.onTagChange(tagId, checkbox.checked);
    }
  }

  onCategorySelect(categoryId: string): void {
    this.characterForm.patchValue({ category: categoryId });
    this.characterForm.markAsDirty();
  }

  onTagToggle(tagId: string): void {
    const isSelected = this.isTagSelected(tagId);
    this.onTagChange(tagId, !isSelected);
  }

  onBookToggle(bookId: string): void {
    const isSelected = this.isBookSelected(bookId);
    this.onBookChange(bookId, !isSelected);
  }

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.keys(formGroup.controls).forEach(key => {
      const control = formGroup.get(key);
      control?.markAsTouched();
    });
  }
}
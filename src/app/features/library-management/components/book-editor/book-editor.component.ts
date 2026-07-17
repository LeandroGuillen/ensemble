import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges, HostListener } from '@angular/core';

import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Book } from '../../../../core/interfaces/project.interface';
import { Character } from '../../../../core/interfaces/character.interface';
import { CharacterPickerService } from '../../../../core/services/character-picker.service';
import { CharacterService } from '../../../../core/services/character.service';
import { ProjectService } from '../../../../core/services/project.service';

interface BookFormData {
  name: string;
  color: string;
  description?: string;
  status?: 'draft' | 'in-progress' | 'complete' | 'published' | 'on-hold';
  publicationDate?: string;
  isbn?: string;
  coverImage?: string;
  povCharacterIds?: string[];
}

interface PovCharacterDisplay {
  id: string;
  name: string;
  thumbnail: string | null;
}

@Component({
    selector: 'app-book-editor',
    imports: [FormsModule, ReactiveFormsModule],
    templateUrl: './book-editor.component.html',
    styleUrls: ['./book-editor.component.scss']
})
export class BookEditorComponent implements OnInit, OnChanges {
  @Input() book: Book | null = null;
  @Input() isVisible = false;
  @Input() saving = false;
  @Output() save = new EventEmitter<BookFormData>();
  @Output() cancel = new EventEmitter<void>();
  @Output() delete = new EventEmitter<Book>();

  bookForm: FormGroup;
  isEditMode = false;
  private mouseDownOnOverlay = false;
  povCharacterIds: string[] = [];
  povCharacters: PovCharacterDisplay[] = [];
  pickingPov = false;

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

  // Status options
  statusOptions = [
    { value: 'draft', label: 'Draft' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'complete', label: 'Complete' },
    { value: 'published', label: 'Published' },
    { value: 'on-hold', label: 'On Hold' }
  ];

  constructor(
    private fb: FormBuilder,
    private characterPicker: CharacterPickerService,
    private characterService: CharacterService,
    private projectService: ProjectService
  ) {
    this.bookForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(200)]],
      color: ['#3498db', [Validators.required, Validators.pattern(/^#[0-9A-Fa-f]{6}$/)]],
      description: ['', [Validators.maxLength(1000)]],
      status: ['', []],
      publicationDate: ['', []],
      isbn: ['', [Validators.maxLength(50)]],
      coverImage: ['', []]
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeKey(event: Event): void {
    if (this.isVisible && !this.pickingPov) {
      event.preventDefault();
      this.onCancel();
    }
  }

  ngOnInit(): void {
    this.initializeForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['book'] || changes['isVisible']) {
      this.initializeForm();
    }
  }

  private initializeForm(): void {
    this.isEditMode = !!this.book;

    if (this.book) {
      this.bookForm.patchValue({
        name: this.book.name,
        color: this.book.color,
        description: this.book.description || '',
        status: this.book.status || '',
        publicationDate: this.book.publicationDate || '',
        isbn: this.book.isbn || '',
        coverImage: this.book.coverImage || ''
      });
      this.povCharacterIds = [...(this.book.povCharacterIds || [])];
    } else {
      this.bookForm.reset({
        name: '',
        color: '#3498db',
        description: '',
        status: '',
        publicationDate: '',
        isbn: '',
        coverImage: ''
      });
      this.povCharacterIds = [];
    }

    void this.refreshPovCharacters();
  }

  private async refreshPovCharacters(): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (project?.path) {
      await this.characterService.loadCharacters(project.path);
    }

    const styleId = this.projectService.getDefaultCharacterStyle();
    const known: Character[] = [];

    for (const id of this.povCharacterIds) {
      const character = this.characterService.getCharacterById(id);
      if (character) {
        known.push(character);
      }
    }

    if (known.length > 0) {
      await this.characterService.loadThumbnailsForCharacters(known);
    }

    this.povCharacters = this.povCharacterIds.map((id) => {
      const character = this.characterService.getCharacterById(id);
      if (!character) {
        return { id, name: id, thumbnail: null };
      }
      return {
        id,
        name: character.name,
        thumbnail: this.characterService.getCachedThumbnail(id, styleId) || null,
      };
    });
  }

  async onAddPovCharacter(): Promise<void> {
    this.pickingPov = true;
    try {
      const picked = await this.characterPicker.pick();
      if (!picked || this.povCharacterIds.includes(picked.id)) {
        return;
      }
      this.povCharacterIds = [...this.povCharacterIds, picked.id];
      await this.refreshPovCharacters();
    } finally {
      this.pickingPov = false;
    }
  }

  onRemovePovCharacter(characterId: string): void {
    this.povCharacterIds = this.povCharacterIds.filter((id) => id !== characterId);
    this.povCharacters = this.povCharacters.filter((c) => c.id !== characterId);
  }

  onSave(): void {
    if (this.bookForm.invalid) {
      this.markFormGroupTouched(this.bookForm);
      return;
    }

    const formData: BookFormData = {
      ...this.bookForm.value,
      povCharacterIds: [...this.povCharacterIds],
    };
    this.save.emit(formData);
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onOverlayMouseDown(): void {
    this.mouseDownOnOverlay = true;
  }

  onOverlayClick(): void {
    // Only close if the mouse was pressed down on the overlay
    if (this.mouseDownOnOverlay) {
      this.onCancel();
    }
    this.mouseDownOnOverlay = false;
  }

  onModalClick(): void {
    // Reset the flag when clicking inside the modal
    this.mouseDownOnOverlay = false;
  }

  onDelete(): void {
    if (this.book && confirm(`Are you sure you want to delete "${this.book.name}"?`)) {
      this.delete.emit(this.book);
    }
  }

  selectColor(color: string): void {
    this.bookForm.patchValue({ color });
  }

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.keys(formGroup.controls).forEach(key => {
      const control = formGroup.get(key);
      control?.markAsTouched();
    });
  }

  getFieldError(fieldName: string): string | null {
    const field = this.bookForm.get(fieldName);
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

  getCurrentColor(): string {
    return this.bookForm.get('color')?.value || '#3498db';
  }
}

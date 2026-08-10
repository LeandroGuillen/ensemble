import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges, HostListener } from '@angular/core';

import { AbstractControl, FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { Book, Saga, Series } from '../../../../core/interfaces/project.interface';
import { Character } from '../../../../core/interfaces/character.interface';
import { CharacterPickerService } from '../../../../core/services/character-picker.service';
import { CharacterService } from '../../../../core/services/character.service';
import { ModalService } from '../../../../core/services/modal.service';
import { ProjectService } from '../../../../core/services/project.service';
import { getBookDisplayName } from '../../../../core/utils/book-display.utils';

interface BookFormData {
  name: string;
  code?: string;
  color: string;
  description?: string;
  status?: 'draft' | 'in-progress' | 'complete' | 'published' | 'on-hold';
  publicationDate?: string;
  isbn?: string;
  coverImage?: string;
  povCharacterIds?: string[];
  seriesId?: string;
  sagaId?: string;
}

interface PovCharacterDisplay {
  id: string;
  name: string;
  thumbnail: string | null;
}

function codeOrTitleRequired(): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const code = (group.get('code')?.value ?? '').toString().trim();
    const name = (group.get('name')?.value ?? '').toString().trim();
    return code || name ? null : { codeOrTitleRequired: true };
  };
}

@Component({
    selector: 'app-book-editor',
    imports: [FormsModule, ReactiveFormsModule],
    templateUrl: './book-editor.component.html',
    styleUrls: ['./book-editor.component.scss']
})
export class BookEditorComponent implements OnInit, OnChanges {
  @Input() book: Book | null = null;
  @Input() seriesList: Series[] = [];
  @Input() sagasList: Saga[] = [];
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

  colorPresets = [
    '#e74c3c',
    '#3498db',
    '#2ecc71',
    '#f39c12',
    '#9b59b6',
    '#1abc9c',
    '#e91e63',
    '#ff5722',
    '#4caf50',
    '#2196f3',
    '#ff9800',
    '#795548',
    '#607d8b',
    '#ffeb3b',
    '#8bc34a'
  ];

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
    private projectService: ProjectService,
    private modalService: ModalService
  ) {
    this.bookForm = this.fb.group({
      code: ['', [Validators.maxLength(50)]],
      name: ['', [Validators.maxLength(200)]],
      color: ['#3498db', [Validators.required, Validators.pattern(/^#[0-9A-Fa-f]{6}$/)]],
      description: ['', [Validators.maxLength(1000)]],
      status: ['', []],
      publicationDate: ['', []],
      isbn: ['', [Validators.maxLength(50)]],
      coverImage: ['', []],
      seriesId: [''],
      sagaId: ['']
    }, { validators: codeOrTitleRequired() });
  }

  get availableSagas(): Saga[] {
    const seriesId = this.bookForm.get('seriesId')?.value;
    if (!seriesId) {
      return [];
    }
    return this.sagasList.filter((s) => s.seriesId === seriesId);
  }

  get identityError(): string | null {
    if (
      this.bookForm.hasError('codeOrTitleRequired') &&
      (this.bookForm.get('code')?.touched || this.bookForm.get('name')?.touched)
    ) {
      return 'Either code or title is required';
    }
    return null;
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
    this.bookForm.get('seriesId')?.valueChanges.subscribe(() => {
      this.onSeriesChange();
    });
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
        code: this.book.code || '',
        name: this.book.name === 'Untitled' ? '' : this.book.name,
        color: this.book.color,
        description: this.book.description || '',
        status: this.book.status || '',
        publicationDate: this.book.publicationDate || '',
        isbn: this.book.isbn || '',
        coverImage: this.book.coverImage || '',
        seriesId: this.book.seriesId || '',
        sagaId: this.book.sagaId || ''
      });
      this.povCharacterIds = [...(this.book.povCharacterIds || [])];
    } else {
      this.bookForm.reset({
        code: '',
        name: '',
        color: '#3498db',
        description: '',
        status: '',
        publicationDate: '',
        isbn: '',
        coverImage: '',
        seriesId: '',
        sagaId: ''
      });
      this.povCharacterIds = [];
    }

    void this.refreshPovCharacters();
  }

  onSeriesChange(): void {
    const seriesId = this.bookForm.get('seriesId')?.value;
    const sagaId = this.bookForm.get('sagaId')?.value;
    if (!seriesId) {
      this.bookForm.patchValue({ sagaId: '' }, { emitEvent: false });
      return;
    }
    const stillValid = this.sagasList.some(
      (s) => s.id === sagaId && s.seriesId === seriesId
    );
    if (!stillValid) {
      this.bookForm.patchValue({ sagaId: '' }, { emitEvent: false });
    }
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

    const seriesId = (this.bookForm.value.seriesId || '').trim() || undefined;
    const sagaId = seriesId
      ? ((this.bookForm.value.sagaId || '').trim() || undefined)
      : undefined;

    const formData: BookFormData = {
      ...this.bookForm.value,
      seriesId,
      sagaId,
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
    if (this.mouseDownOnOverlay) {
      this.onCancel();
    }
    this.mouseDownOnOverlay = false;
  }

  onModalClick(): void {
    this.mouseDownOnOverlay = false;
  }

  async onDelete(): Promise<void> {
    if (!this.book) return;
    if (
      await this.modalService.confirm(
        `Are you sure you want to delete "${getBookDisplayName(this.book)}"?`,
        'Delete Book',
        { confirmText: 'Delete', danger: true }
      )
    ) {
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

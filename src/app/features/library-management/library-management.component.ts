import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { MetadataService } from '../../core/services/metadata.service';
import { ProjectService } from '../../core/services/project.service';
import { Book } from '../../core/interfaces/project.interface';

interface BookFormData {
  name: string;
  color: string;
  description?: string;
  status?: 'draft' | 'in-progress' | 'published' | 'archived';
  publicationDate?: string;
  isbn?: string;
  coverImage?: string;
}

@Component({
  selector: 'app-library-management',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './library-management.component.html',
  styleUrls: ['./library-management.component.scss']
})
export class LibraryManagementComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  books: Book[] = [];

  // Form states
  showBookForm = false;
  editingBook: Book | null = null;

  // Forms
  bookForm: FormGroup;

  // Loading states
  loading = false;
  saving = false;

  // Error handling
  error: string | null = null;

  // Drag and drop state for books
  draggedIndex: number | null = null;
  dragOverIndex: number | null = null;

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
    private metadataService: MetadataService,
    private projectService: ProjectService,
    private fb: FormBuilder
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

  ngOnInit(): void {
    this.loadData();

    // Subscribe to metadata changes
    this.metadataService.metadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe(metadata => {
        if (metadata) {
          this.books = metadata.books || [];
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

  // Book Management

  showAddBookForm(): void {
    this.showBookForm = true;
    this.editingBook = null;
    this.bookForm.reset({
      name: '',
      color: '#3498db',
      description: '',
      status: '',
      publicationDate: '',
      isbn: '',
      coverImage: ''
    });
  }

  showEditBookForm(book: Book): void {
    this.showBookForm = true;
    this.editingBook = book;
    this.bookForm.patchValue({
      name: book.name,
      color: book.color,
      description: book.description || '',
      status: book.status || '',
      publicationDate: book.publicationDate || '',
      isbn: book.isbn || '',
      coverImage: book.coverImage || ''
    });
  }

  cancelBookForm(): void {
    this.showBookForm = false;
    this.editingBook = null;
    this.bookForm.reset();
  }

  async saveBook(): Promise<void> {
    if (this.bookForm.invalid) {
      this.markFormGroupTouched(this.bookForm);
      return;
    }

    try {
      this.saving = true;
      this.error = null;

      const formData: BookFormData = this.bookForm.value;

      if (this.editingBook) {
        await this.metadataService.updateBook(this.editingBook.id, formData);
      } else {
        await this.metadataService.addBook(formData);
      }

      this.cancelBookForm();
    } catch (error) {
      console.error('Failed to save book:', error);
      this.error = `Failed to save book: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  async deleteBook(book: Book): Promise<void> {
    if (!confirm(`Are you sure you want to delete the book "${book.name}"?\n\nThis will remove the book from all characters that reference it. Characters themselves will not be deleted.`)) {
      return;
    }

    try {
      this.saving = true;
      this.error = null;

      await this.metadataService.removeBook(book.id);
    } catch (error) {
      console.error('Failed to delete book:', error);
      this.error = `Failed to delete book: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  // Color Management

  selectColor(color: string): void {
    this.bookForm.patchValue({ color });
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

  getStatusLabel(status?: string): string {
    if (!status) return '';
    const option = this.statusOptions.find(opt => opt.value === status);
    return option?.label || status;
  }

  // Drag and Drop Methods for Books
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

    // Reorder the books array
    const newBooks = [...this.books];
    const draggedBook = newBooks[this.draggedIndex];

    // Remove from old position
    newBooks.splice(this.draggedIndex, 1);

    // Adjust drop index if dropping after the removed item
    const adjustedDropIndex = dropIndex > this.draggedIndex ? dropIndex - 1 : dropIndex;

    // Insert at new position
    newBooks.splice(adjustedDropIndex, 0, draggedBook);

    // Update books in metadata and save
    this.books = newBooks;
    this.saveReorderedBooks(newBooks);
  }

  private async saveReorderedBooks(newBooks: Book[]): Promise<void> {
    try {
      this.saving = true;
      this.error = null;

      const metadata = this.metadataService.getCurrentMetadata();
      if (!metadata) {
        throw new Error('No metadata loaded');
      }

      const updatedMetadata = {
        ...metadata,
        books: newBooks
      };

      await this.metadataService.saveMetadata(updatedMetadata);
    } catch (error) {
      console.error('Failed to save reordered books:', error);
      this.error = `Failed to save book order: ${error}`;
    } finally {
      this.saving = false;
    }
  }
}

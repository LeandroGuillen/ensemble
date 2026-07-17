import { Component, OnInit, OnDestroy } from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";

import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from "@angular/forms";
import { Subject, takeUntil } from "rxjs";
import { MetadataService } from "../../core/services/metadata.service";
import { ProjectService } from "../../core/services/project.service";
import { LoggingService } from "../../core/services/logging.service";
import { NotificationService } from "../../core/services/notification.service";
import { ModalService } from "../../core/services/modal.service";
import { Book, Saga, Series } from "../../core/interfaces/project.interface";
import {
  getBookDisplayName,
  getBookTitle as formatBookTitle,
} from "../../core/utils/book-display.utils";
import {
  BookPlacement,
  LibraryGrouping,
  buildLibraryGrouping,
  placementKey,
} from "../../core/utils/library-grouping.utils";
import { PageHeaderComponent } from "../../shared/page-header/page-header.component";
import { BookEditorComponent } from "./components/book-editor/book-editor.component";
import { BookItemComponent } from "./components/book-item/book-item.component";

interface BookFormData {
  name: string;
  code?: string;
  color: string;
  description?: string;
  status?:
    | "draft"
    | "in-progress"
    | "complete"
    | "published"
    | "on-hold"
    | "archived";
  publicationDate?: string;
  isbn?: string;
  coverImage?: string;
  povCharacterIds?: string[];
  seriesId?: string;
  sagaId?: string;
}

type DragKind = "book" | "series" | "saga";

@Component({
  selector: "app-library-management",
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ReactiveFormsModule,
    PageHeaderComponent,
    BookItemComponent,
    BookEditorComponent,
  ],
  templateUrl: "./library-management.component.html",
  styleUrls: ["./library-management.component.scss"],
})
export class LibraryManagementComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  books: Book[] = [];
  seriesList: Series[] = [];
  sagasList: Saga[] = [];
  grouping: LibraryGrouping = { seriesGroups: [], ungrouped: [] };

  viewMode: "gallery" | "list" = "gallery";

  showBookForm = false;
  editingBook: Book | null = null;
  selectedBook: Book | null = null;

  showSeriesForm = false;
  editingSeries: Series | null = null;
  seriesForm: FormGroup;

  showSagaForm = false;
  editingSaga: Saga | null = null;
  sagaForm: FormGroup;

  bookForm: FormGroup;

  loading = false;
  saving = false;
  error: string | null = null;

  // Book DnD
  draggedBookId: string | null = null;
  dragOverPlacementKey: string | null = null;
  dragOverIndex: number | null = null;
  dragOverSide: "left" | "right" | null = null;

  // Series / saga reorder DnD
  dragKind: DragKind | null = null;
  draggedSeriesId: string | null = null;
  draggedSagaId: string | null = null;
  dragOverSeriesId: string | null = null;
  dragOverSagaId: string | null = null;

  colorPresets = [
    "#e74c3c",
    "#3498db",
    "#2ecc71",
    "#f39c12",
    "#9b59b6",
    "#1abc9c",
    "#e91e63",
    "#ff5722",
    "#4caf50",
    "#2196f3",
    "#ff9800",
    "#795548",
    "#607d8b",
    "#ffeb3b",
    "#8bc34a",
  ];

  statusOptions = [
    { value: "draft", label: "Draft" },
    { value: "in-progress", label: "In Progress" },
    { value: "complete", label: "Complete" },
    { value: "published", label: "Published" },
    { value: "on-hold", label: "On Hold" },
  ];

  constructor(
    private metadataService: MetadataService,
    private projectService: ProjectService,
    private fb: FormBuilder,
    private logger: LoggingService,
    private notificationService: NotificationService,
    private modalService: ModalService
  ) {
    this.bookForm = this.fb.group({
      code: ["", [Validators.maxLength(50)]],
      name: ["", [Validators.maxLength(200)]],
      color: [
        "#3498db",
        [Validators.required, Validators.pattern(/^#[0-9A-Fa-f]{6}$/)],
      ],
      description: ["", [Validators.maxLength(1000)]],
      status: ["", []],
      publicationDate: ["", []],
      isbn: ["", [Validators.maxLength(50)]],
      coverImage: ["", []],
    });

    this.seriesForm = this.fb.group({
      name: ["", [Validators.required, Validators.maxLength(200)]],
      color: ["#607d8b", [Validators.pattern(/^#[0-9A-Fa-f]{6}$/)]],
      description: ["", [Validators.maxLength(1000)]],
    });

    this.sagaForm = this.fb.group({
      name: ["", [Validators.required, Validators.maxLength(200)]],
      seriesId: ["", [Validators.required]],
      description: ["", [Validators.maxLength(1000)]],
    });
  }

  ngOnInit(): void {
    const savedViewMode = localStorage.getItem("libraryViewMode");
    if (savedViewMode === "gallery" || savedViewMode === "list") {
      this.viewMode = savedViewMode;
    }

    this.loadData();

    this.metadataService.metadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe((metadata) => {
        if (metadata) {
          this.books = metadata.books || [];
          this.seriesList = metadata.series || [];
          this.sagasList = metadata.sagas || [];
          this.refreshGrouping();
        }
      });
  }

  setViewMode(mode: "gallery" | "list"): void {
    this.viewMode = mode;
    localStorage.setItem("libraryViewMode", mode);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private refreshGrouping(): void {
    this.grouping = buildLibraryGrouping(
      this.books,
      this.seriesList,
      this.sagasList
    );
  }

  get isDraggingBook(): boolean {
    return this.dragKind === "book" && this.draggedBookId !== null;
  }

  get showUngroupedSection(): boolean {
    return (
      this.grouping.ungrouped.length > 0 ||
      this.isDraggingBook ||
      (this.books.length === 0 &&
        this.seriesList.length === 0 &&
        this.sagasList.length === 0)
    );
  }

  private async loadData(): Promise<void> {
    try {
      this.loading = true;
      this.error = null;

      const project = this.projectService.getCurrentProject();
      if (!project) {
        throw new Error("No project loaded");
      }

      await this.metadataService.loadMetadata(project.path);
    } catch (error) {
      this.logger.error("Failed to load metadata:", error);
      this.error = `Failed to load metadata: ${error}`;
    } finally {
      this.loading = false;
    }
  }

  // --- Book CRUD ---

  showAddBookForm(): void {
    this.showBookForm = true;
    this.editingBook = null;
    this.selectedBook = null;
  }

  onBookClick(book: Book): void {
    this.selectedBook = book;
    this.editingBook = book;
    this.showBookForm = true;
  }

  onEditorSave(formData: BookFormData): void {
    this.saveBook(formData);
  }

  onEditorCancel(): void {
    this.cancelBookForm();
  }

  onEditorDelete(book: Book): void {
    this.deleteBook(book);
  }

  cancelBookForm(): void {
    this.showBookForm = false;
    this.editingBook = null;
    this.selectedBook = null;
  }

  async saveBook(editorData?: BookFormData): Promise<void> {
    if (!editorData) {
      return;
    }

    try {
      this.saving = true;
      this.error = null;

      const statusMap: Record<string, Book["status"]> = {
        draft: "draft",
        "in-progress": "in-progress",
        published: "published",
        archived: "archived",
        complete: "published",
        "on-hold": "archived",
      };

      const seriesId = editorData.seriesId || undefined;
      const sagaId = seriesId ? editorData.sagaId || undefined : undefined;

      const bookPayload: Omit<Book, "id"> = {
        name: editorData.name,
        code: editorData.code,
        color: editorData.color,
        description: editorData.description,
        status: editorData.status ? statusMap[editorData.status] : undefined,
        publicationDate: editorData.publicationDate,
        isbn: editorData.isbn,
        coverImage: editorData.coverImage,
        povCharacterIds: editorData.povCharacterIds ?? [],
        seriesId,
        sagaId,
      };

      if (this.editingBook) {
        const prevSeries = this.editingBook.seriesId || undefined;
        const prevSaga = this.editingBook.sagaId || undefined;
        await this.metadataService.updateBook(this.editingBook.id, bookPayload);
        if (prevSeries !== seriesId || prevSaga !== sagaId) {
          await this.metadataService.moveBook(
            this.editingBook.id,
            { seriesId, sagaId },
            undefined
          );
        }
        this.notificationService.showSuccess("Book updated successfully");
      } else {
        await this.metadataService.addBook(bookPayload);
        this.notificationService.showSuccess("Book created successfully");
      }

      this.cancelBookForm();
    } catch (error) {
      this.logger.error("Failed to save book:", error);
      this.error = `Failed to save book: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  async deleteBook(book: Book): Promise<void> {
    if (
      !(await this.modalService.confirm(
        `Are you sure you want to delete the book "${getBookDisplayName(book)}"?\n\nThis will remove the book from all characters that reference it. Characters themselves will not be deleted.`
      ))
    ) {
      return;
    }

    try {
      this.saving = true;
      this.error = null;

      await this.metadataService.removeBook(book.id);
      this.notificationService.showSuccess(
        `Book "${getBookDisplayName(book)}" deleted successfully`
      );
      this.cancelBookForm();
    } catch (error) {
      this.logger.error("Failed to delete book:", error);
      this.error = `Failed to delete book: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  // --- Series CRUD ---

  showAddSeriesForm(): void {
    this.editingSeries = null;
    this.seriesForm.reset({
      name: "",
      color: "#607d8b",
      description: "",
    });
    this.showSeriesForm = true;
  }

  showEditSeriesForm(series: Series): void {
    this.editingSeries = series;
    this.seriesForm.reset({
      name: series.name,
      color: series.color || "#607d8b",
      description: series.description || "",
    });
    this.showSeriesForm = true;
  }

  cancelSeriesForm(): void {
    this.showSeriesForm = false;
    this.editingSeries = null;
    this.seriesForm.reset();
  }

  async saveSeries(): Promise<void> {
    if (this.seriesForm.invalid) {
      this.seriesForm.markAllAsTouched();
      return;
    }

    try {
      this.saving = true;
      this.error = null;
      const value = this.seriesForm.value;
      const payload = {
        name: value.name.trim(),
        color: value.color || undefined,
        description: value.description?.trim() || undefined,
      };

      if (this.editingSeries) {
        await this.metadataService.updateSeries(this.editingSeries.id, payload);
        this.notificationService.showSuccess("Series updated");
      } else {
        await this.metadataService.addSeries(payload);
        this.notificationService.showSuccess("Series created");
      }
      this.cancelSeriesForm();
    } catch (error) {
      this.logger.error("Failed to save series:", error);
      this.error = `Failed to save series: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  async deleteSeries(series: Series): Promise<void> {
    if (
      !(await this.modalService.confirm(
        `Delete series "${series.name}"?\n\nIts sagas will be removed. Books will become ungrouped.`
      ))
    ) {
      return;
    }

    try {
      this.saving = true;
      await this.metadataService.removeSeries(series.id);
      this.notificationService.showSuccess(`Series "${series.name}" deleted`);
      this.cancelSeriesForm();
    } catch (error) {
      this.logger.error("Failed to delete series:", error);
      this.error = `Failed to delete series: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  // --- Saga CRUD ---

  showAddSagaForm(prefillSeriesId?: string): void {
    if (this.seriesList.length === 0) {
      this.notificationService.showError(
        "Create a series before adding a saga"
      );
      return;
    }

    this.editingSaga = null;
    this.sagaForm.reset({
      name: "",
      seriesId: prefillSeriesId || this.seriesList[0].id,
      description: "",
    });
    this.showSagaForm = true;
  }

  showEditSagaForm(saga: Saga): void {
    this.editingSaga = saga;
    this.sagaForm.reset({
      name: saga.name,
      seriesId: saga.seriesId,
      description: saga.description || "",
    });
    this.showSagaForm = true;
  }

  cancelSagaForm(): void {
    this.showSagaForm = false;
    this.editingSaga = null;
    this.sagaForm.reset();
  }

  async saveSaga(): Promise<void> {
    if (this.sagaForm.invalid) {
      this.sagaForm.markAllAsTouched();
      return;
    }

    try {
      this.saving = true;
      this.error = null;
      const value = this.sagaForm.value;
      const payload = {
        name: value.name.trim(),
        seriesId: value.seriesId,
        description: value.description?.trim() || undefined,
      };

      if (this.editingSaga) {
        await this.metadataService.updateSaga(this.editingSaga.id, payload);
        this.notificationService.showSuccess("Saga updated");
      } else {
        await this.metadataService.addSaga(payload);
        this.notificationService.showSuccess("Saga created");
      }
      this.cancelSagaForm();
    } catch (error) {
      this.logger.error("Failed to save saga:", error);
      this.error = `Failed to save saga: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  async deleteSaga(saga: Saga): Promise<void> {
    if (
      !(await this.modalService.confirm(
        `Delete saga "${saga.name}"?\n\nBooks in this saga will stay in the series.`
      ))
    ) {
      return;
    }

    try {
      this.saving = true;
      await this.metadataService.removeSaga(saga.id);
      this.notificationService.showSuccess(`Saga "${saga.name}" deleted`);
      this.cancelSagaForm();
    } catch (error) {
      this.logger.error("Failed to delete saga:", error);
      this.error = `Failed to delete saga: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  // --- Display helpers ---

  getStatusLabel(status?: string): string {
    if (!status) return "";
    const option = this.statusOptions.find((opt) => opt.value === status);
    return option?.label || status;
  }

  getBookTitle(book: Book): string {
    return formatBookTitle(book);
  }

  getSeriesAccent(series: Series): string {
    return series.color || "#607d8b";
  }

  getSagaAccent(saga: Saga, fallback: string): string {
    return saga.color || fallback;
  }

  placementKeyFor(placement: BookPlacement): string {
    return placementKey(placement);
  }

  // --- Book drag and drop ---

  onBookDragStart(event: DragEvent, book: Book): void {
    this.dragKind = "book";
    this.draggedBookId = book.id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", book.id);
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      event.dataTransfer.setDragImage(canvas, 0, 0);
    }
  }

  onBookDragEnd(): void {
    this.clearBookDragState();
  }

  onBookDragOver(
    event: DragEvent,
    placement: BookPlacement,
    index: number,
    side?: "left" | "right"
  ): void {
    if (this.acceptGroupDragOver(event, placement)) {
      return;
    }
    if (this.dragKind !== "book") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    this.dragOverPlacementKey = placementKey(placement);
    this.dragOverIndex = index;
    this.dragOverSide = side || null;
  }

  onBookDragEnter(
    event: DragEvent,
    placement: BookPlacement,
    index: number,
    side?: "left" | "right"
  ): void {
    if (this.acceptGroupDragOver(event, placement)) {
      return;
    }
    if (this.dragKind !== "book") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.dragOverPlacementKey = placementKey(placement);
    this.dragOverIndex = index;
    this.dragOverSide = side || null;
  }

  onBookDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      this.dragOverIndex = null;
      this.dragOverSide = null;
    }
  }

  onBookDrop(
    event: DragEvent,
    placement: BookPlacement,
    dropIndex: number
  ): void {
    if (this.handleGroupDrop(event, placement)) {
      return;
    }
    if (this.dragKind !== "book" || !this.draggedBookId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void this.performBookMove(this.draggedBookId, placement, dropIndex);
    this.clearBookDragState();
  }

  onShelfDragOver(event: DragEvent, placement: BookPlacement): void {
    if (this.acceptGroupDragOver(event, placement)) {
      return;
    }
    if (this.dragKind !== "book") {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    this.dragOverPlacementKey = placementKey(placement);
  }

  onShelfDrop(event: DragEvent, placement: BookPlacement, shelfLength: number): void {
    if (this.handleGroupDrop(event, placement)) {
      return;
    }
    if (this.dragKind !== "book" || !this.draggedBookId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void this.performBookMove(this.draggedBookId, placement, shelfLength);
    this.clearBookDragState();
  }

  /** Allow series/saga drops while hovering book/shelf children. */
  private acceptGroupDragOver(
    event: DragEvent,
    placement: BookPlacement
  ): boolean {
    if (this.dragKind === "series" && placement.seriesId) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      this.dragOverSeriesId = placement.seriesId;
      return true;
    }
    if (this.dragKind === "saga" && placement.sagaId) {
      const dragged = this.sagasList.find((s) => s.id === this.draggedSagaId);
      const target = this.sagasList.find((s) => s.id === placement.sagaId);
      if (
        dragged &&
        target &&
        dragged.seriesId === target.seriesId
      ) {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        this.dragOverSagaId = target.id;
        return true;
      }
    }
    return false;
  }

  /** Complete series/saga reorder when drop lands on a book/shelf child. */
  private handleGroupDrop(
    event: DragEvent,
    placement: BookPlacement
  ): boolean {
    if (this.dragKind === "series" && this.draggedSeriesId && placement.seriesId) {
      event.preventDefault();
      event.stopPropagation();
      void this.reorderSeries(this.draggedSeriesId, placement.seriesId);
      this.clearSeriesDragState();
      return true;
    }
    if (this.dragKind === "saga" && this.draggedSagaId && placement.sagaId) {
      const target = this.sagasList.find((s) => s.id === placement.sagaId);
      if (target) {
        event.preventDefault();
        event.stopPropagation();
        void this.reorderSaga(this.draggedSagaId, target);
        this.clearSagaDragState();
        return true;
      }
    }
    return false;
  }

  private async performBookMove(
    bookId: string,
    placement: BookPlacement,
    dropIndex: number
  ): Promise<void> {
    try {
      this.saving = true;
      this.error = null;

      const book = this.books.find((b) => b.id === bookId);
      if (!book) {
        return;
      }

      // Adjust insert index when moving within the same shelf after the current index
      const sameShelf =
        (book.seriesId || undefined) === (placement.seriesId || undefined) &&
        (book.sagaId || undefined) === (placement.sagaId || undefined);

      let insertIndex = dropIndex;
      if (sameShelf) {
        const peers = this.books.filter((b) => {
          if (placement.sagaId) {
            return b.sagaId === placement.sagaId;
          }
          if (placement.seriesId) {
            return b.seriesId === placement.seriesId && !b.sagaId;
          }
          return !b.seriesId;
        });
        const fromIndex = peers.findIndex((b) => b.id === bookId);
        if (fromIndex !== -1 && dropIndex > fromIndex) {
          insertIndex = dropIndex - 1;
        }
      }

      await this.metadataService.moveBook(bookId, placement, insertIndex);
    } catch (error) {
      this.logger.error("Failed to move book:", error);
      this.error = `Failed to move book: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  private clearBookDragState(): void {
    this.draggedBookId = null;
    this.dragOverPlacementKey = null;
    this.dragOverIndex = null;
    this.dragOverSide = null;
    if (this.dragKind === "book") {
      this.dragKind = null;
    }
  }

  isBookDragging(book: Book): boolean {
    return this.draggedBookId === book.id;
  }

  isDropHighlight(
    placement: BookPlacement,
    index: number,
    side: "left" | "right"
  ): boolean {
    return (
      this.dragOverPlacementKey === placementKey(placement) &&
      this.dragOverIndex === index &&
      this.dragOverSide === side
    );
  }

  // --- Series reorder DnD ---

  onSeriesDragStart(event: DragEvent, seriesId: string): void {
    event.stopPropagation();
    this.dragKind = "series";
    this.draggedSeriesId = seriesId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `series:${seriesId}`);
    }
  }

  onSeriesDragOver(event: DragEvent, seriesId: string): void {
    if (this.dragKind !== "series") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    this.dragOverSeriesId = seriesId;
  }

  onSeriesDrop(event: DragEvent, targetSeriesId: string): void {
    if (this.dragKind !== "series" || !this.draggedSeriesId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void this.reorderSeries(this.draggedSeriesId, targetSeriesId);
    this.clearSeriesDragState();
  }

  onSeriesDragEnd(): void {
    this.clearSeriesDragState();
  }

  private async reorderSeries(
    draggedId: string,
    targetId: string
  ): Promise<void> {
    if (draggedId === targetId) {
      return;
    }
    const ids = this.seriesList.map((s) => s.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) {
      return;
    }
    ids.splice(from, 1);
    ids.splice(to, 0, draggedId);
    try {
      this.saving = true;
      await this.metadataService.reorderSeries(ids);
    } catch (error) {
      this.logger.error("Failed to reorder series:", error);
      this.error = `Failed to reorder series: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  private clearSeriesDragState(): void {
    this.draggedSeriesId = null;
    this.dragOverSeriesId = null;
    if (this.dragKind === "series") {
      this.dragKind = null;
    }
  }

  // --- Saga reorder DnD (within series) ---

  onSagaDragStart(event: DragEvent, sagaId: string): void {
    event.stopPropagation();
    this.dragKind = "saga";
    this.draggedSagaId = sagaId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `saga:${sagaId}`);
    }
  }

  onSagaDragOver(event: DragEvent, saga: Saga): void {
    if (this.dragKind === "series") {
      // Allow dropping a series onto another series via this saga segment
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      this.dragOverSeriesId = saga.seriesId;
      return;
    }
    if (this.dragKind !== "saga" || !this.draggedSagaId) {
      return;
    }
    const dragged = this.sagasList.find((s) => s.id === this.draggedSagaId);
    if (!dragged || dragged.seriesId !== saga.seriesId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    this.dragOverSagaId = saga.id;
  }

  onSagaDrop(event: DragEvent, targetSaga: Saga): void {
    if (this.dragKind === "series" && this.draggedSeriesId) {
      event.preventDefault();
      event.stopPropagation();
      void this.reorderSeries(this.draggedSeriesId, targetSaga.seriesId);
      this.clearSeriesDragState();
      return;
    }
    if (this.dragKind !== "saga" || !this.draggedSagaId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void this.reorderSaga(this.draggedSagaId, targetSaga);
    this.clearSagaDragState();
  }

  onSagaDragEnd(): void {
    this.clearSagaDragState();
  }

  private async reorderSaga(
    draggedId: string,
    target: Saga
  ): Promise<void> {
    const dragged = this.sagasList.find((s) => s.id === draggedId);
    if (!dragged || dragged.seriesId !== target.seriesId || draggedId === target.id) {
      return;
    }

    const ids = this.sagasList
      .filter((s) => s.seriesId === target.seriesId)
      .map((s) => s.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(target.id);
    if (from < 0 || to < 0) {
      return;
    }
    ids.splice(from, 1);
    ids.splice(to, 0, draggedId);

    try {
      this.saving = true;
      await this.metadataService.reorderSagasInSeries(target.seriesId, ids);
    } catch (error) {
      this.logger.error("Failed to reorder sagas:", error);
      this.error = `Failed to reorder sagas: ${error}`;
    } finally {
      this.saving = false;
    }
  }

  private clearSagaDragState(): void {
    this.draggedSagaId = null;
    this.dragOverSagaId = null;
    if (this.dragKind === "saga") {
      this.dragKind = null;
    }
  }

  selectSeriesColor(color: string): void {
    this.seriesForm.patchValue({ color });
  }
}

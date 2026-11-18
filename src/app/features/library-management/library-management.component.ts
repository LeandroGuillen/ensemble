import { ProjectReadOnlyDirective } from '../../shared/project-read-only.directive';
import { DestroyRef, inject, Component, HostListener, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from "@angular/common";

import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from "@angular/forms";
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
import { requireProject } from "../../core/utils/project.utils";
import { PageHeaderComponent } from "../../shared/page-header/page-header.component";
import { BookEditorComponent } from "./components/book-editor/book-editor.component";
import { BookItemComponent } from "./components/book-item/book-item.component";
import {
  BookEditActionsService,
  BookFormData,
} from "../../core/services/book-edit-actions.service";
import { Router } from "@angular/router";
import { BOOK_DRAG_TYPE, PinnedBooksService } from "../../core/services/pinned-books.service";
import { setBookDragImage } from "./book-drag-image";
import { insertionIndexAt } from "./book-drop-position";

type DragKind = "book" | "series" | "saga";


/** A ghost of the dragged book on a shelf, drawn before item `renderBefore`. */
interface BookGhost {
  id: number;
  placementKey: string;
  renderBefore: number;
  /** Shrinking away after the ghost moved on; removed when its animation ends. */
  leaving: boolean;
  /** The ghost the drag starts with, in the book's own place: it fades in instead of growing. */
  initial?: boolean;
}
@Component({
  selector: "app-library-management",
  imports: [ProjectReadOnlyDirective,
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
export class LibraryManagementComponent implements OnInit {
  private readonly toasts = inject(NotificationService);
  private readonly pinnedBooks = inject(PinnedBooksService);
  private readonly destroyRef = inject(DestroyRef);

  books: Book[] = [];
  seriesList: Series[] = [];
  sagasList: Saga[] = [];
  grouping: LibraryGrouping = { seriesGroups: [], ungrouped: [] };

  viewMode: "gallery" | "list" = "gallery";
  /** Book size in the gallery view. */
  gallerySize: "large" | "small" = "large";

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

  // Book DnD
  draggedBookId: string | null = null;
  dragOverPlacementKey: string | null = null;
  newBookPlacement: { seriesId?: string; sagaId?: string } | null = null;
  /** Book lifted out of its shelf while dragged (its slot collapses so the shelf closes up). */
  liftedBookId: string | null = null;
  /**
   * Ghosts of the dragged book: the current one (where the book would land)
   * plus any still shrinking away from earlier spots. Keeping a departing
   * ghost until its shrink animation ends lets the books on both sides close
   * the old gap while the new one opens, so books move left as well as right.
   * (Angular's `animate.leave` is skipped under the app's legacy
   * `provideAnimations()`, so the departure is handled here.)
   */
  ghosts: BookGhost[] = [];
  /** Set for the frame that ends a drop, so the shelf settles without animating. */
  settleInstantly = false;
  /** Set for the frames where a picked-up book turns into its ghost in place. */
  liftInstant = false;
  private ghostSeq = 0;
  private settlingDrop = false;
  private liftTimer: ReturnType<typeof setTimeout> | null = null;

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
    private modalService: ModalService,
    private bookEditActions: BookEditActionsService,
    private router: Router
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
    const savedSize = localStorage.getItem("libraryGallerySize");
    if (savedSize === "large" || savedSize === "small") {
      this.gallerySize = savedSize;
    }

    this.loadData();

    this.metadataService.metadata$
      .pipe(takeUntilDestroyed(this.destroyRef))
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

  setGallerySize(size: "large" | "small"): void {
    this.gallerySize = size;
    localStorage.setItem("libraryGallerySize", size);
  }

  /** The size slider has two stops: 0 small, 1 large. */
  setGallerySizeFromSlider(value: string): void {
    this.setGallerySize(value === "0" ? "small" : "large");
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

      const project = requireProject(this.projectService.getCurrentProject());

      await this.metadataService.loadMetadata(project.path);
    } catch (error) {
      this.logger.error("Failed to load metadata:", error);
      this.toasts.showError(`Failed to load metadata: ${error}`);
    } finally {
      this.loading = false;
    }
  }

  // --- Book CRUD ---

  /** Opens the New Book form; from a shelf's "New book" button it starts in that series/saga. */
  showAddBookForm(placement?: BookPlacement): void {
    this.newBookPlacement = placement?.seriesId ? { seriesId: placement.seriesId, sagaId: placement.sagaId } : null;
    this.showBookForm = true;
    this.editingBook = null;
    this.selectedBook = null;
  }

  /** A book opens its page (the plan); editing happens from there via "Edit book…". */
  onBookClick(book: Book): void {
    this.router.navigate(["/book", book.id]);
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
    this.newBookPlacement = null;
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
      await this.bookEditActions.save(this.editingBook, editorData);
      this.notificationService.showSuccess(
        this.editingBook ? "Book updated successfully" : "Book created successfully"
      );
      this.cancelBookForm();
    } catch (error) {
      this.logger.error("Failed to save book:", error); // toasts once (see LoggingService.error)
    } finally {
      this.saving = false;
    }
  }

  async deleteBook(book: Book): Promise<void> {
    try {
      this.saving = true;
      if (!(await this.bookEditActions.confirmAndDelete(book))) {
        return;
      }
      this.notificationService.showSuccess(
        `Book "${getBookDisplayName(book)}" deleted successfully`
      );
      this.cancelBookForm();
    } catch (error) {
      this.logger.error("Failed to delete book:", error); // toasts once (see LoggingService.error)
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
      this.logger.error("Failed to save series:", error); // toasts once (see LoggingService.error)
    } finally {
      this.saving = false;
    }
  }

  async deleteSeries(series: Series): Promise<void> {
    if (
      !(await this.modalService.confirm(
        `Delete series "${series.name}"?\n\nIts sagas will be removed. Books will become ungrouped.`,
        'Delete series',
        { confirmText: 'Delete series', danger: true }
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
      this.logger.error("Failed to delete series:", error); // toasts once (see LoggingService.error)
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

  /**
   * Escape closes the Series and Saga dialogs. A dialog opened on top of them
   * (e.g. the "Delete saga?" confirmation, a modal-frame) handles its own Escape.
   */
  @HostListener("document:keydown.escape", ["$event"])
  onEscapeKey(event: Event): void {
    if (!this.showSagaForm && !this.showSeriesForm) return;
    if (document.querySelector("app-modal-frame .modal-overlay")) return;
    event.preventDefault();
    if (this.showSagaForm) {
      this.cancelSagaForm();
    } else {
      this.cancelSeriesForm();
    }
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
      this.logger.error("Failed to save saga:", error); // toasts once (see LoggingService.error)
    } finally {
      this.saving = false;
    }
  }

  async deleteSaga(saga: Saga): Promise<void> {
    if (
      !(await this.modalService.confirm(
        `Delete saga "${saga.name}"?\n\nBooks in this saga will stay in the series.`,
        'Delete saga',
        { confirmText: 'Delete saga', danger: true }
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
      this.logger.error("Failed to delete saga:", error); // toasts once (see LoggingService.error)
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
    // Dropping on the sidebar pins the book (a copy); shelves move it.
    this.pinnedBooks.startBookDrag(book.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "copyMove";
      event.dataTransfer.setData("text/plain", book.id);
      event.dataTransfer.setData(BOOK_DRAG_TYPE, book.id);
      setBookDragImage(event.dataTransfer, book);
    }
    // Where the book sits now: its ghost starts there, so picking a book up
    // just fades it in place instead of sliding the shelf.
    const origin = this.originSpot(event, book);
    // Collapse the source after the drag has started (hiding it inside
    // dragstart would cancel the drag in Chromium).
    this.liftTimer = setTimeout(() => {
      this.liftTimer = null;
      if (this.draggedBookId !== book.id) return;
      this.liftInstant = true;
      this.liftedBookId = book.id;
      if (origin) {
        this.ghosts = [{ id: ++this.ghostSeq, ...origin, leaving: false, initial: true }];
      }
      // Later changes (a cancelled drag returning the book) animate again.
      requestAnimationFrame(() => requestAnimationFrame(() => (this.liftInstant = false)));
    }, 0);
  }

  onBookDragEnd(): void {
    // A drop on a shelf finishes once the move is saved (see onShelfDrop).
    if (this.settlingDrop) return;
    this.clearBookDragState();
  }

  /**
   * The shelf works out where the book would land from the cursor (see
   * `insertionIndexAt`) and moves a ghost of it there, so the other books
   * slide apart to show the place. A drop lands where the ghost is.
   */
  onShelfDragOver(event: DragEvent, placement: BookPlacement, layout: "grid" | "list" = "grid"): void {
    if (this.acceptGroupDragOver(event, placement)) {
      return;
    }
    if (this.dragKind !== "book" || this.settlingDrop) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    this.dragOverPlacementKey = placementKey(placement);
    const target = this.dropTarget(event, layout);
    const key = placementKey(placement);
    if (target.othersCount === 0) {
      // Empty shelf: its book-sized "Drop here" box lights up instead of a
      // ghost. Swapping one for the other would resize the shelf under the
      // cursor, fire dragleave and make the two blink in turns.
      this.moveGhost(null);
    } else {
      this.moveGhost({ placementKey: key, renderBefore: target.renderBefore });
    }
  }

  /** The ghost leaves when the cursor leaves the shelf (e.g. on its way to the sidebar). */
  onShelfDragLeave(event: DragEvent): void {
    const shelf = event.currentTarget as HTMLElement | null;
    const next = event.relatedTarget as Node | null;
    if (this.dragKind !== "book" || this.settlingDrop || (shelf && next && shelf.contains(next))) {
      return;
    }
    this.moveGhost(null);
    this.dragOverPlacementKey = null;
  }

  onShelfDrop(event: DragEvent, placement: BookPlacement, layout: "grid" | "list" = "grid"): void {
    if (this.handleGroupDrop(event, placement)) {
      return;
    }
    if (this.dragKind !== "book" || !this.draggedBookId || this.settlingDrop) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const { insertIndex } = this.dropTarget(event, layout);
    const bookId = this.draggedBookId;
    const fromIndex = this.shelfIndexOf(bookId, placement);
    // Keep the ghost and the lifted slot until the new order is saved, then
    // settle in one frame: the book appears exactly where its ghost was.
    this.settlingDrop = true;
    const move = fromIndex === insertIndex
      ? Promise.resolve()
      : this.performBookMove(bookId, placement, insertIndex);
    void move.finally(() => this.settleDrop());
  }

  private settleDrop(): void {
    this.settleInstantly = true;
    this.settlingDrop = false;
    this.clearBookDragState();
    requestAnimationFrame(() => requestAnimationFrame(() => (this.settleInstantly = false)));
  }

  /**
   * Insert position among the shelf's other books (the dragged one left out),
   * and the list item the ghost goes before.
   */
  private dropTarget(
    event: DragEvent,
    layout: "grid" | "list"
  ): { insertIndex: number; renderBefore: number; othersCount: number } {
    const shelf = event.currentTarget as HTMLElement | null;
    const all = shelf
      ? Array.from(shelf.querySelectorAll<HTMLElement>("[data-book-slot]")).filter(
          (el) => el.closest(".shelf-panel") === shelf
        )
      : [];
    const others = all.filter((el) => el.dataset["bookId"] !== this.draggedBookId);
    const insertIndex = insertionIndexAt(
      others.map((el) => el.getBoundingClientRect()),
      event.clientX,
      event.clientY,
      layout
    );
    const renderBefore = insertIndex < others.length ? all.indexOf(others[insertIndex]) : all.length;
    return { insertIndex, renderBefore, othersCount: others.length };
  }

  /** The dragged book's own spot as a ghost position: its shelf, and the item after it. */
  private originSpot(event: DragEvent, book: Book): { placementKey: string; renderBefore: number } | null {
    const slot = (event.target as Element | null)?.closest?.("[data-book-slot]") as HTMLElement | null;
    const shelf = slot?.closest(".shelf-panel");
    if (!slot || !shelf) return null;
    const all = Array.from(shelf.querySelectorAll<HTMLElement>("[data-book-slot]")).filter(
      (el) => el.closest(".shelf-panel") === shelf
    );
    const index = all.indexOf(slot);
    if (index === -1) return null;
    const placement: BookPlacement = book.sagaId
      ? { seriesId: book.seriesId, sagaId: book.sagaId }
      : book.seriesId
        ? { seriesId: book.seriesId }
        : {};
    return { placementKey: placementKey(placement), renderBefore: index + 1 };
  }

  /** Ghosts to draw before item `index` of a shelf (the list length = at the end). */
  ghostsBefore(placement: BookPlacement, index: number): BookGhost[] {
    if (!this.ghosts.length || !this.draggedBook) return [];
    const key = placementKey(placement);
    return this.ghosts.filter((g) => g.placementKey === key && g.renderBefore === index);
  }

  /** Sends the current ghost to `spot` (null: none), letting the old one shrink away. */
  private moveGhost(spot: { placementKey: string; renderBefore: number } | null): void {
    const current = this.ghosts.find((g) => !g.leaving);
    if (current && spot && current.placementKey === spot.placementKey && current.renderBefore === spot.renderBefore) {
      return;
    }
    if (!current && !spot) return;
    const next = this.ghosts.map((g) => (g === current ? { ...g, leaving: true } : g));
    if (current) {
      const id = current.id;
      // Fallback in case animationend never comes (reduced motion, hidden tab).
      setTimeout(() => this.removeGhost(id), 400);
    }
    if (spot) next.push({ id: ++this.ghostSeq, ...spot, leaving: false });
    this.ghosts = next;
  }

  onGhostAnimationEnd(ghost: BookGhost, event: AnimationEvent): void {
    if (ghost.leaving && event.target === event.currentTarget) this.removeGhost(ghost.id);
  }

  private removeGhost(id: number): void {
    if (this.ghosts.some((g) => g.id === id)) this.ghosts = this.ghosts.filter((g) => g.id !== id);
  }

  trackGhost(_: number, ghost: BookGhost): number {
    return ghost.id;
  }

  /** No visible books: none at all, or only the one lifted out by the drag. */
  shelfLooksEmpty(books: Book[]): boolean {
    return books.every((book) => book.id === this.liftedBookId);
  }

  get draggedBook(): Book | null {
    return this.draggedBookId ? this.books.find((b) => b.id === this.draggedBookId) ?? null : null;
  }

  /** Position of a book among the books of a shelf, or -1 when it is on another shelf. */
  private shelfIndexOf(bookId: string, placement: BookPlacement): number {
    return this.shelfPeers(placement).findIndex((b) => b.id === bookId);
  }

  private shelfPeers(placement: BookPlacement): Book[] {
    return this.books.filter((b) => {
      if (placement.sagaId) {
        return b.sagaId === placement.sagaId;
      }
      if (placement.seriesId) {
        return b.seriesId === placement.seriesId && !b.sagaId;
      }
      return !b.seriesId;
    });
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

      const book = this.books.find((b) => b.id === bookId);
      if (!book) {
        return;
      }

      // `dropIndex` counts the shelf's other books only (the dragged one left out).
      await this.metadataService.moveBook(bookId, placement, dropIndex);
    } catch (error) {
      this.logger.error("Failed to move book:", error);
      this.toasts.showError(`Failed to move book: ${error}`);
    } finally {
      this.saving = false;
    }
  }

  private clearBookDragState(): void {
    this.pinnedBooks.endBookDrag();
    if (this.liftTimer) {
      clearTimeout(this.liftTimer);
      this.liftTimer = null;
    }
    this.draggedBookId = null;
    this.liftedBookId = null;
    this.ghosts = [];
    this.dragOverPlacementKey = null;
    if (this.dragKind === "book") {
      this.dragKind = null;
    }
  }

  isBookDragging(book: Book): boolean {
    return this.draggedBookId === book.id;
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
      this.toasts.showError(`Failed to reorder series: ${error}`);
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
      this.toasts.showError(`Failed to reorder sagas: ${error}`);
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

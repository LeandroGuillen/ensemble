import { ChangeDetectorRef, Component, DestroyRef, HostListener, inject, OnDestroy, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Book, Character, Location, ProjectImage } from '../../core/interfaces';
import { House, HouseFormData, HouseLeadership } from '../../core/interfaces/house.interface';
import { HouseService } from '../../core/services/house.service';
import { CharacterPickerService, CharacterService, ImagePickerService, LocationService, ProjectService } from '../../core/services';
import { generateId } from '../../core/utils/id.utils';
import { formatThumbnailWikiLink } from '../../core/utils/thumbnail.utils';
import { getBookDisplayName } from '../../core/utils/book-display.utils';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { ImagePickerDialogComponent } from '../../shared/image-picker-dialog/image-picker-dialog.component';
import { ConfirmButtonDirective } from '../../shared/confirm-button/confirm-button.directive';

@Component({ selector: 'app-house-detail', imports: [FormsModule, RouterLink, DragDropModule, PageHeaderComponent, ImagePickerDialogComponent, ConfirmButtonDirective], templateUrl: './house-detail.component.html', styleUrls: ['./house-detail.component.scss'] })
export class HouseDetailComponent implements OnInit, OnDestroy {
  readonly houses = inject(HouseService);
  readonly charactersService = inject(CharacterService);
  readonly picker = inject(ImagePickerService);
  private readonly characterPicker = inject(CharacterPickerService);
  private readonly locationsService = inject(LocationService);
  private readonly projects = inject(ProjectService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  house: House | null = null;
  model: HouseFormData = { name: '', motto: '', colors: [], characterIds: [], leadership: [], content: '' };
  characters: Character[] = [];
  locations: Location[] = [];
  books: Book[] = [];
  loading = true;
  saving = false;
  dirty = false;
  conflict = false;
  deleted = false;
  error = '';
  crest: string | null = null;
  pickingMember = false;
  selectedBook = '';
  leadershipEditing = false;
  showPicker = false;
  private request = 0;

  ngOnInit(): void {
    this.charactersService.getReferenceCharacters().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(characters => {
      this.characters = characters;
      this.loadMemberThumbnails();
    });
    this.locationsService.getLocations().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(locations => this.locations = locations);
    this.projects.currentProject$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(project => this.books = project?.metadata.books || []);
    this.houses.houses$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(houses => {
      if (!this.house || this.saving || this.loading) return;
      const latest = houses.find(house => house.id === this.house!.id);
      if (!latest) { this.deleted = true; this.conflict = true; return; }
      if (latest.raw === this.house.raw) return;
      if (this.dirty) this.conflict = true;
      else this.accept(latest);
    });
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => { void this.open(params.get('id')); });
  }

  private async open(id: string | null): Promise<void> {
    const request = ++this.request;
    this.loading = true;
    this.leadershipEditing = false;
    this.error = '';
    this.house = null;
    this.dirty = false;
    this.conflict = false;
    this.deleted = false;
    try {
      const project = this.projects.getCurrentProject();
      if (!project) throw new Error('Select a project first.');
      await Promise.all([this.houses.loadHouses(), this.charactersService.loadCharacters(project.path), this.locationsService.loadLocations(project.path)]);
      if (request !== this.request || this.destroyRef.destroyed) return;
      if (id) {
        const house = this.houses.getById(id);
        if (!house) { this.deleted = true; throw new Error('This House no longer exists.'); }
        this.accept(house);
      } else {
        this.model = { name: '', motto: '', colors: [], characterIds: [], leadership: [], content: '' };
        this.crest = null;
      }
    } catch (error) { if (request === this.request) this.error = String(error); }
    finally { if (request === this.request && !this.destroyRef.destroyed) { this.loading = false; this.cdr.markForCheck(); } }
  }

  private accept(house: House): void {
    this.house = house;
    this.model = structuredClone(house);
    this.dirty = false;
    this.conflict = false;
    this.deleted = false;
    void this.previewCrest();
    this.loadMemberThumbnails();
  }
  changed(): void { this.dirty = true; }
  characterName(id: string): string { return this.characters.find(character => character.id === id)?.name || `Missing character (${id})`; }
  get currentHeadNames(): string {
    const current = this.model.leadership.find(entry => entry.id === this.model.currentLeadershipId);
    return current?.characterIds.length ? current.characterIds.map(id => this.characterName(id)).join(' & ') : 'Unspecified';
  }
  scrollToLeadership(section: HTMLElement): void {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
    section.focus({ preventScroll: true });
  }
  bookName(book: Book): string { return getBookDisplayName(book); }
  get members(): Character[] {
    return this.model.characterIds.map(id => this.characters.find(character => character.id === id))
      .filter((character): character is Character => !!character);
  }
  private loadMemberThumbnails(): void {
    void this.charactersService.loadThumbnailsForCharacters(this.members).then(() => {
      if (!this.destroyRef.destroyed) this.cdr.markForCheck();
    }).catch(() => undefined);
  }
  async addMember(): Promise<void> {
    if (this.pickingMember || this.saving || this.loading || this.deleted) return;
    const request = this.request;
    this.pickingMember = true;
    try {
      const character = await this.characterPicker.pick();
      if (!character || this.destroyRef.destroyed || request !== this.request || this.model.characterIds.includes(character.id)) return;
      this.model.characterIds = [...this.model.characterIds, character.id];
      this.changed();
      this.loadMemberThumbnails();
    } catch (error) { this.error = String(error); }
    finally { this.pickingMember = false; if (!this.destroyRef.destroyed) this.cdr.markForCheck(); }
  }
  get missingMembers(): string[] { return this.model.characterIds.filter(id => !this.characters.some(character => character.id === id)); }
  get visibleLeadership(): HouseLeadership[] { return this.model.leadership.filter(entry => !this.selectedBook || entry.books.includes(this.selectedBook)); }
  get seatExists(): boolean { return this.locations.some(location => location.id === this.model.seatId); }
  toggleMember(id: string): void {
    this.model.characterIds = this.model.characterIds.includes(id) ? this.model.characterIds.filter(value => value !== id) : [...this.model.characterIds, id];
    this.changed();
  }
  addReign(): void { this.selectedBook = ''; this.model.leadership.push({ id: generateId(), characterIds: [], period: '', books: [], notes: '' }); this.changed(); }
  removeReign(id: string): void {
    this.model.leadership = this.model.leadership.filter(entry => entry.id !== id);
    if (this.model.currentLeadershipId === id) this.model.currentLeadershipId = undefined;
    this.changed();
  }
  moveReign(index: number, direction: number): void {
    if (this.selectedBook) return;
    moveItemInArray(this.model.leadership, index, index + direction);
    this.changed();
  }
  drop(event: CdkDragDrop<HouseLeadership[]>): void {
    if (this.selectedBook) return;
    moveItemInArray(this.model.leadership, event.previousIndex, event.currentIndex);
    this.changed();
  }
  toggleBook(entry: HouseLeadership, bookId: string): void {
    entry.books = entry.books.includes(bookId) ? entry.books.filter(id => id !== bookId) : [...entry.books, bookId];
    this.changed();
  }
  headOptions(entry: HouseLeadership): string[] {
    return [...new Set([...this.members.map(character => character.id), ...entry.characterIds])];
  }
  missingHeads(entry: HouseLeadership): string[] { return entry.characterIds.filter(id => !this.characters.some(character => character.id === id)); }
  missingBooks(entry: HouseLeadership): string[] { return entry.books.filter(id => !this.books.some(book => book.id === id)); }
  addColor(): void { this.model.colors.push('#848484'); this.changed(); }
  changeColor(index: number, color: string): void {
    if (this.model.colors[index] !== color) { this.model.colors[index] = color; this.changed(); }
  }
  removeColor(index: number): void { this.model.colors.splice(index, 1); this.changed(); }
  async openPicker(): Promise<void> { this.showPicker = true; await this.picker.open({ thumbnailHint: this.model.thumbnail }); }
  onImage(image: ProjectImage): void { this.model.thumbnail = formatThumbnailWikiLink(image.relativePath); this.changed(); void this.previewCrest(); }
  async previewCrest(): Promise<void> {
    const reference = this.model.thumbnail;
    try {
      const crest = await this.houses.loadCrest(this.model);
      if (!this.destroyRef.destroyed && reference === this.model.thumbnail) { this.crest = crest; this.cdr.markForCheck(); }
    } catch { this.crest = null; }
  }
  removeCrest(): void { this.model.thumbnail = undefined; this.crest = null; this.changed(); }
  async save(): Promise<void> {
    if (this.saving || this.pickingMember || this.conflict || this.deleted || this.loading) return;
    this.saving = true;
    this.error = '';
    try {
      const saved = this.house ? await this.houses.updateHouse(this.house.id, this.model, this.house.raw) : await this.houses.createHouse(this.model);
      this.accept(saved);
      this.saving = false;
      await this.router.navigate(['/house', saved.id], { replaceUrl: true });
    } catch (error) {
      this.error = String(error);
      if (this.error.includes('changed on disk')) this.conflict = true;
    } finally { this.saving = false; this.cdr.markForCheck(); }
  }
  async reload(): Promise<void> {
    if (this.dirty && !window.confirm('Discard your unsaved House changes and reload from disk?')) return;
    const id = this.house?.id || this.route.snapshot.paramMap.get('id');
    try { await this.houses.loadHouses(true); await this.open(id); } catch (error) { this.error = String(error); }
  }
  async delete(): Promise<void> {
    if (!this.house || this.saving || this.pickingMember || this.conflict) return;
    this.saving = true;
    try {
      await this.houses.deleteHouse(this.house.id, this.house.raw);
      this.dirty = false;
      this.saving = false;
      await this.router.navigate(['/houses']);
    }
    catch (error) { this.error = String(error); }
    finally { this.saving = false; this.cdr.markForCheck(); }
  }
  canLeave(): boolean { return !this.saving && this.picker.handleNavigationAway() && (!this.dirty || window.confirm('Discard your unsaved House changes?')); }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void { if (this.dirty) event.preventDefault(); }
  @HostListener('document:keydown', ['$event']) onKey(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !this.showPicker && !this.pickingMember) { event.preventDefault(); void this.save(); }
  }
  ngOnDestroy(): void { ++this.request; this.picker.close(); }
}

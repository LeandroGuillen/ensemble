import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { Character, ProjectImage } from '../../../../core/interfaces';
import { Location } from '../../../../core/interfaces/location.interface';
import { PromptFile, PromptFileData, PromptSection } from '../../../../core/interfaces/prompt.interface';
import { PromptService } from '../../../../core/services/prompt.service';
import { ImagePickerService } from '../../../../core/services/image-picker.service';
import { CharacterPickerService } from '../../../../core/services/character-picker.service';
import { CommandPaletteService } from '../../../../shared/command-palette/command-palette.service';
import { ElectronService } from '../../../../core/services/electron.service';
import { ProjectService } from '../../../../core/services/project.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { LoggingService } from '../../../../core/services/logging.service';
import { emptyPromptSection, serializePromptFile } from '../../../../core/utils/prompt-file.utils';
import { ImagePickerDialogComponent } from '../../../../shared/image-picker-dialog/image-picker-dialog.component';
import { PromptImageComponent } from '../../../../shared/prompt-image/prompt-image.component';

/** Idle time before edits are written to disk. */
const AUTOSAVE_MS = 800;

function cloneData(file: PromptFileData): PromptFileData {
  return {
    characters: [...file.characters],
    locations: [...file.locations],
    tags: [...file.tags],
    created: file.created,
    modified: file.modified,
    extra: { ...file.extra },
    sections: file.sections.map((section) => ({ ...section, images: [...section.images] })),
  };
}

interface LightboxState {
  images: string[];
  index: number;
}

/**
 * Editor for one prompt file: links, tags, and one card per section (the main
 * section plus `##` variants) with its notes, prompt, negative prompt and
 * attached images. Edits autosave after a short idle.
 */
@Component({
  selector: 'app-prompt-editor',
  imports: [FormsModule, NgTemplateOutlet, ImagePickerDialogComponent, PromptImageComponent],
  templateUrl: './prompt-editor.component.html',
  styleUrls: ['./prompt-editor.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptEditorComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) file!: PromptFile;
  @Input() characters: Character[] = [];
  @Input() locations: Location[] = [];
  @Output() renameRequest = new EventEmitter<PromptFile>();
  @Output() deleteRequest = new EventEmitter<PromptFile>();
  @Output() openCharacter = new EventEmitter<string>();

  draft!: PromptFileData;
  dirty = false;
  saving = false;
  saveError: string | null = null;
  tagDraft = '';
  lightbox: LightboxState | null = null;
  showImagePicker = false;
  private pickerSectionIndex = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private savingPath: string | null = null;

  constructor(
    private promptService: PromptService,
    private imagePickerService: ImagePickerService,
    private characterPicker: CharacterPickerService,
    private commandPalette: CommandPaletteService,
    private electronService: ElectronService,
    private projectService: ProjectService,
    private notifications: NotificationService,
    private logger: LoggingService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['file'];
    if (!change) return;
    const previous = change.previousValue as PromptFile | undefined;
    if (!previous || previous.relativePath !== this.file.relativePath) {
      if (previous && this.dirty) void this.flush(previous.relativePath);
      this.loadDraft();
      return;
    }
    // Same file reloaded (our own save echoing back, or an external edit).
    // Local edits win while they are pending; otherwise take the disk version.
    const comparable = { ...this.draft, created: this.file.created, modified: this.file.modified };
    if (!this.dirty && serializePromptFile(this.file) !== serializePromptFile(comparable)) {
      this.loadDraft();
    }
  }

  ngOnDestroy(): void {
    if (this.dirty) void this.flush(this.file.relativePath);
    this.imagePickerService.close();
  }

  private loadDraft(): void {
    this.cancelTimer();
    this.draft = cloneData(this.file);
    if (this.draft.sections.length === 0) this.draft.sections = [emptyPromptSection()];
    this.dirty = false;
    this.saveError = null;
    this.tagDraft = '';
    this.lightbox = null;
  }

  get mainSection(): PromptSection {
    return this.draft.sections[0];
  }

  get variantSections(): PromptSection[] {
    return this.draft.sections.slice(1);
  }

  // ---- Saving -------------------------------------------------------------

  changed(): void {
    this.dirty = true;
    this.saveError = null;
    this.cancelTimer();
    const path = this.file.relativePath;
    this.saveTimer = setTimeout(() => void this.flush(path), AUTOSAVE_MS);
    this.cdr.markForCheck();
  }

  private cancelTimer(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /** Writes pending edits for `path`; a no-op when that file is gone or clean. */
  async flush(path = this.file.relativePath): Promise<void> {
    if (path !== this.file.relativePath) {
      // Switching files: save the draft we still hold for the previous one.
      const snapshot = cloneData(this.draft);
      await this.saveSnapshot(path, snapshot);
      return;
    }
    this.cancelTimer();
    if (!this.dirty) return;
    if (this.savingPath === path) {
      // A save is in flight; write these newer edits right after it.
      this.saveTimer = setTimeout(() => void this.flush(path), AUTOSAVE_MS);
      return;
    }
    this.savingPath = path;
    this.saving = true;
    this.dirty = false;
    this.cdr.markForCheck();
    const ok = await this.saveSnapshot(path, cloneData(this.draft));
    this.savingPath = null;
    this.saving = false;
    if (!ok) this.dirty = true;
    this.cdr.markForCheck();
  }

  private async saveSnapshot(path: string, data: PromptFileData): Promise<boolean> {
    if (!this.promptService.getPrompt(path)) return true;
    try {
      await this.promptService.savePrompt(path, data);
      return true;
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not save prompt ${path}`, error);
      return false;
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.lightbox) {
      if (event.key === 'Escape') {
        this.closeLightbox();
        event.preventDefault();
      } else if (event.key === 'ArrowRight') {
        this.stepLightbox(1);
        event.preventDefault();
      } else if (event.key === 'ArrowLeft') {
        this.stepLightbox(-1);
        event.preventDefault();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.flush();
    }
  }

  // ---- Links and tags -----------------------------------------------------

  characterName(id: string): string {
    return this.characters.find((c) => c.id === id)?.name || 'Missing character';
  }

  isMissingCharacter(id: string): boolean {
    return !this.characters.some((c) => c.id === id);
  }

  locationName(id: string): string {
    return this.locations.find((l) => l.id === id)?.name || 'Missing location';
  }

  /** Searchable character picker (command palette with portraits). */
  async linkCharacter(): Promise<void> {
    const picked = await this.characterPicker.pick();
    if (!picked || this.draft.characters.includes(picked.id)) return;
    this.draft.characters = [...this.draft.characters, picked.id];
    this.changed();
  }

  async linkLocation(): Promise<void> {
    const options = this.locations.filter((l) => !this.draft.locations.includes(l.id));
    const picked = await this.commandPalette.pick(
      options.map((location) => ({
        id: location.id,
        label: location.name,
        icon: 'map-pin',
        keywords: [location.name],
        action: () => {},
      })),
      'Search locations...'
    );
    if (!picked || this.draft.locations.includes(picked.id)) return;
    this.draft.locations = [...this.draft.locations, picked.id];
    this.changed();
  }

  removeCharacter(id: string): void {
    this.draft.characters = this.draft.characters.filter((c) => c !== id);
    this.changed();
  }

  removeLocation(id: string): void {
    this.draft.locations = this.draft.locations.filter((l) => l !== id);
    this.changed();
  }

  addTag(): void {
    const tags = this.tagDraft
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag && !this.draft.tags.includes(tag));
    this.tagDraft = '';
    if (tags.length === 0) return;
    this.draft.tags = [...this.draft.tags, ...tags];
    this.changed();
  }

  onTagKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.addTag();
    } else if (event.key === 'Backspace' && !this.tagDraft && this.draft.tags.length) {
      this.removeTag(this.draft.tags[this.draft.tags.length - 1]);
    }
  }

  removeTag(tag: string): void {
    this.draft.tags = this.draft.tags.filter((t) => t !== tag);
    this.changed();
  }

  // ---- Sections -----------------------------------------------------------

  addVariant(): void {
    const section = emptyPromptSection(`Variant ${this.draft.sections.length + 1}`);
    section.prompt = '';
    this.draft.sections = [...this.draft.sections, section];
    this.changed();
  }

  removeVariant(index: number): void {
    if (index <= 0) return;
    this.draft.sections = this.draft.sections.filter((_, i) => i !== index);
    this.changed();
  }

  moveVariant(index: number, delta: number): void {
    const target = index + delta;
    if (index <= 0 || target <= 0 || target >= this.draft.sections.length) return;
    const sections = [...this.draft.sections];
    [sections[index], sections[target]] = [sections[target], sections[index]];
    this.draft.sections = sections;
    this.changed();
  }

  addBlock(section: PromptSection, kind: 'prompt' | 'negative'): void {
    section[kind] = '';
    this.changed();
  }

  removeBlock(section: PromptSection, kind: 'prompt' | 'negative'): void {
    section[kind] = null;
    this.changed();
  }

  async copy(text: string | null, label = 'Prompt'): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.notifications.showSuccess(`${label} copied`, 1500);
    } catch (error) {
      this.logger.error('Could not copy to the clipboard', error);
    }
  }

  // ---- Images -------------------------------------------------------------

  async openImagePicker(sectionIndex: number): Promise<void> {
    this.pickerSectionIndex = sectionIndex;
    this.showImagePicker = true;
    this.cdr.markForCheck();
    const section = this.draft.sections[sectionIndex];
    await this.imagePickerService.open({
      thumbnailHint: section?.images[section.images.length - 1] || '',
      imagesFolder: this.projectService.getCurrentProject()?.metadata?.settings?.imagesFolder,
    });
    const error = this.imagePickerService.snapshot.error;
    if (error) this.notifications.showError(error);
    this.cdr.markForCheck();
  }

  closeImagePicker(): void {
    this.imagePickerService.close();
    this.showImagePicker = false;
    this.cdr.markForCheck();
  }

  onImagePicked(image: ProjectImage): void {
    this.showImagePicker = false;
    this.attach(this.pickerSectionIndex, [image.relativePath]);
  }

  async attachFromFiles(sectionIndex: number): Promise<void> {
    const picked = await this.electronService.selectImages();
    if (!picked.length) return;
    const paths: string[] = [];
    for (const source of picked) {
      try {
        paths.push(await this.promptService.importImage(source));
      } catch (error) {
        this.logger.error(`Could not attach ${source}`, error);
      }
    }
    this.attach(sectionIndex, paths);
  }

  private attach(sectionIndex: number, paths: string[]): void {
    const section = this.draft.sections[sectionIndex];
    if (!section) return;
    const fresh = paths.filter((path) => path && !section.images.includes(path));
    if (fresh.length === 0) {
      this.cdr.markForCheck();
      return;
    }
    section.images = [...section.images, ...fresh];
    this.changed();
  }

  removeImage(section: PromptSection, index: number): void {
    section.images = section.images.filter((_, i) => i !== index);
    this.changed();
  }

  openLightbox(images: string[], index: number): void {
    this.lightbox = { images, index };
    this.cdr.markForCheck();
  }

  closeLightbox(): void {
    this.lightbox = null;
    this.cdr.markForCheck();
  }

  stepLightbox(delta: number): void {
    if (!this.lightbox) return;
    const count = this.lightbox.images.length;
    this.lightbox = { ...this.lightbox, index: (this.lightbox.index + delta + count) % count };
    this.cdr.markForCheck();
  }

  async showImageInFolder(path: string): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) return;
    await this.electronService.showItemInFolder(`${project.path}/${path}`);
  }

  // ---- File actions -------------------------------------------------------

  async openInExternalEditor(): Promise<void> {
    await this.flush();
    await this.electronService.openFileInEditor(this.file.filePath);
  }

  async showInFolder(): Promise<void> {
    await this.electronService.showItemInFolder(this.file.filePath);
  }

  async requestRename(): Promise<void> {
    await this.flush();
    this.renameRequest.emit(this.file);
  }

  requestDelete(): void {
    this.cancelTimer();
    this.dirty = false;
    this.deleteRequest.emit(this.file);
  }
}

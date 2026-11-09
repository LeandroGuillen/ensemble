import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, combineLatest, Observable } from 'rxjs';
import { Character } from '../interfaces/character.interface';
import { PromptFile, PromptFileData } from '../interfaces/prompt.interface';
import {
  PromptLinkSnapshot,
  ReferenceRestoreResult,
  ReferenceRestoreSkip,
} from '../interfaces/reference-snapshot.interface';
import {
  emptyPromptFileData,
  parsePromptFile,
  sectionsFromCharacterPrompts,
  serializePromptFile,
} from '../utils/prompt-file.utils';
import { pathBasename, pathDirname, pathExtname, pathJoin, projectRelativePath } from '../utils/path.utils';
import { asciiSlugify } from '../utils/slug.utils';
import { resolveThumbnailPath } from '../utils/thumbnail.utils';
import { requireProject } from '../utils/project.utils';
import {
  sanitizeTrashRecordId,
  trashStagingFailureMessage,
  TrashStagingError,
} from '../trash/trash-record-id';
import { ElectronService } from './electron.service';
import { FileWatcherService } from './file-watcher.service';
import { ProjectService } from './project.service';
import { CharacterService } from './character.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { UndoDeleteService } from './undo-delete.service';

/** Images picked from outside the project are copied here, inside the prompts folder. */
export const PROMPT_IMAGES_FOLDER = '_images';

/** Folder new character prompts go to, relative to the prompts folder. */
export const CHARACTER_PROMPTS_FOLDER = 'characters';

/** A prompt file linking a deleted character/location could not be updated; the delete is cancelled. */
export class PromptUnlinkError extends Error {
  constructor(readonly promptName: string, override readonly cause?: unknown) {
    super(`could not update prompt "${promptName}"`);
    this.name = 'PromptUnlinkError';
  }
}

/** Frontmatter list of a prompt file that links to characters or locations. */
export type PromptLinkField = 'characters' | 'locations';

const ILLEGAL_SEGMENT_CHARS = /[<>:"|?*\\\u0000-\u001f]/g;

/**
 * Cleans a user-typed prompt path such as `places/Academia` into safe
 * `/`-separated segments (no `..`, no leading dots, no reserved characters).
 * Returns '' when nothing usable is left. A trailing `.md` is removed.
 */
export function sanitizePromptPath(input: string): string {
  const segments = (input || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.replace(ILLEGAL_SEGMENT_CHARS, '').trim().replace(/^\.+/, '').trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..');
  if (segments.length === 0) return '';
  const last = segments.length - 1;
  segments[last] = segments[last].replace(/\.md$/i, '').trim();
  if (!segments[last]) return '';
  return segments.join('/');
}

function normalizeRelative(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function sortPrompts(files: PromptFile[]): PromptFile[] {
  return [...files].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base', numeric: true })
  );
}

/**
 * Prompt repository: every `.md` file under the prompts folder (default
 * `prompts/`, configurable per project). Files are addressed by their path
 * relative to that folder. Links to characters and locations are stored on the
 * prompt side only; `promptsForCharacter()` derives the reverse direction.
 */
@Injectable({ providedIn: 'root' })
export class PromptService {
  private readonly promptsSubject = new BehaviorSubject<PromptFile[]>([]);
  readonly prompts$: Observable<PromptFile[]> = this.promptsSubject.asObservable();
  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private loadedProjectPath: string | null = null;
  private loadPromise: Promise<void> | null = null;
  private migrating = false;
  private readonly imageCache = new Map<string, string>();
  /** Prompt files (relative paths) that could not be read or parsed; their links are unknown. */
  private readonly unreadable = new Set<string>();

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private characterService: CharacterService,
    private fileWatcherService: FileWatcherService,
    private logger: LoggingService,
    private notificationService: NotificationService,
    private undoDelete: UndoDeleteService
  ) {
    this.fileWatcherService.fileChanges$.pipe(takeUntilDestroyed()).subscribe((event) => {
      void this.handleFileChange(event);
    });

    this.projectService.currentProject$.pipe(takeUntilDestroyed()).subscribe((project) => {
      if (project?.path !== this.loadedProjectPath) {
        this.loadedProjectPath = null;
        this.loadPromise = null;
        this.imageCache.clear();
        this.unreadable.clear();
        this.promptsSubject.next([]);
      }
    });

    // Legacy character-frontmatter prompts move into prompt files as soon as
    // characters with them are loaded.
    combineLatest([this.characterService.characters$, this.characterService.lore$, this.characterService.drafts$])
      .pipe(takeUntilDestroyed())
      .subscribe(([characters, lore, drafts]) => {
        const pending = [...characters, ...lore, ...drafts].filter((c) => c.prompts?.length > 0);
        if (pending.length > 0) void this.migrateLegacyCharacterPrompts(pending);
      });
  }

  getPromptsSnapshot(): PromptFile[] {
    return this.promptsSubject.value;
  }

  getPrompt(relativePath: string): PromptFile | undefined {
    const key = normalizeRelative(relativePath);
    return this.promptsSubject.value.find((file) => file.relativePath === key);
  }

  /** Prompt files linked to a character, by stable character id. */
  promptsForCharacter(characterId: string, files = this.promptsSubject.value): PromptFile[] {
    return files.filter((file) => file.characters.includes(characterId));
  }

  /** Loads the prompts folder once per project; concurrent callers share the scan. */
  async ensureLoaded(): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) return;
    if (this.loadedProjectPath === project.path && this.loadPromise) {
      return this.loadPromise;
    }
    this.loadedProjectPath = project.path;
    this.loadPromise = this.scan(project.path);
    return this.loadPromise;
  }

  async forceReload(): Promise<void> {
    this.loadedProjectPath = null;
    this.loadPromise = null;
    this.imageCache.clear();
    await this.ensureLoaded();
  }

  private async scan(projectPath: string): Promise<void> {
    this.loadingSubject.next(true);
    try {
      const root = this.projectService.getPromptsFolderPath();
      if (!(await this.electronService.fileExists(root))) {
        this.unreadable.clear();
        this.promptsSubject.next([]);
        return;
      }
      const result = await this.electronService.readDirectoryRecursive(root, '*.md');
      if (!result.success || !result.files) {
        this.logger.warn('Could not scan the prompts folder', result.error);
        if (this.projectService.getCurrentProject()?.path !== projectPath) return;
        // Links are unknown: deletes keep the name for any prompt still linking.
        this.unreadable.clear();
        this.unreadable.add('.');
        this.promptsSubject.next([]);
        return;
      }
      const loaded: PromptFile[] = [];
      const unreadable: string[] = [];
      for (const { relativePath, absolutePath } of result.files) {
        const file = await this.readPromptFile(absolutePath, relativePath);
        if (file) loaded.push(file);
        else unreadable.push(normalizeRelative(relativePath));
      }
      // A project switch during the scan makes this result stale.
      if (this.projectService.getCurrentProject()?.path !== projectPath) return;
      this.unreadable.clear();
      unreadable.forEach((path) => this.unreadable.add(path));
      this.promptsSubject.next(sortPrompts(loaded));
    } finally {
      this.loadingSubject.next(false);
    }
  }

  private async readPromptFile(absolutePath: string, relativePath: string): Promise<PromptFile | null> {
    const read = await this.electronService.readFile(absolutePath);
    if (!read.success || read.content === undefined) {
      this.logger.warn(`Could not read prompt file ${relativePath}`, read.error);
      return null;
    }
    try {
      return this.toPromptFile(parsePromptFile(read.content), absolutePath, relativePath);
    } catch (error) {
      this.logger.warn(`Could not parse prompt file ${relativePath}`, error);
      return null;
    }
  }

  private toPromptFile(data: PromptFileData, filePath: string, relativePath: string): PromptFile {
    const rel = normalizeRelative(relativePath);
    const folder = pathDirname(rel);
    return {
      ...data,
      relativePath: rel,
      filePath,
      name: pathBasename(rel, '.md'),
      folder: folder === '.' ? '' : folder,
    };
  }

  private absolutePathFor(relativePath: string): string {
    return pathJoin(this.projectService.getPromptsFolderPath(), relativePath);
  }

  /** A free `<base>.md`, `<base>-2.md`… path relative to the prompts folder. */
  private async availablePath(base: string, ignore?: string): Promise<string> {
    const taken = async (candidate: string): Promise<boolean> => {
      const lower = candidate.toLowerCase();
      if (lower === ignore?.toLowerCase()) return false;
      if (this.promptsSubject.value.some((f) => f.relativePath.toLowerCase() === lower)) return true;
      return this.electronService.fileExists(this.absolutePathFor(candidate));
    };
    let candidate = `${base}.md`;
    let suffix = 2;
    while (await taken(candidate)) {
      candidate = `${base}-${suffix}.md`;
      suffix += 1;
    }
    return candidate;
  }

  /**
   * Creates a prompt file. `path` is relative to the prompts folder and may
   * include subfolders (`places/Academia`). An existing name gets `-2`, `-3`…
   */
  async createPrompt(path: string, data: Partial<PromptFileData> = {}): Promise<PromptFile> {
    requireProject(this.projectService.getCurrentProject());
    await this.ensureLoaded();
    const clean = sanitizePromptPath(path);
    if (!clean) throw new Error('Enter a name for the prompt');
    const relativePath = await this.availablePath(clean);
    const now = new Date().toISOString();
    const fileData: PromptFileData = {
      ...emptyPromptFileData(),
      ...data,
      created: now,
      modified: now,
    };
    const filePath = this.absolutePathFor(relativePath);
    const dir = pathDirname(filePath);
    const created = await this.electronService.createDirectory(dir);
    if (!created.success) throw new Error(created.error || 'Could not create the prompts folder');
    await this.write(filePath, fileData);
    const file = this.toPromptFile(fileData, filePath, relativePath);
    this.upsert(file);
    return file;
  }

  /** Writes the file's data back to disk and stamps `modified`. */
  async savePrompt(relativePath: string, data: PromptFileData): Promise<PromptFile> {
    const existing = this.getPrompt(relativePath);
    if (!existing) throw new Error(`Prompt not found: ${relativePath}`);
    const next: PromptFileData = {
      ...data,
      created: data.created || existing.created || new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await this.write(existing.filePath, next);
    const file = this.toPromptFile(next, existing.filePath, existing.relativePath);
    this.upsert(file);
    return file;
  }

  /** Renames or moves a prompt file within the prompts folder. */
  async movePrompt(relativePath: string, newPath: string): Promise<PromptFile> {
    const existing = this.getPrompt(relativePath);
    if (!existing) throw new Error(`Prompt not found: ${relativePath}`);
    const clean = sanitizePromptPath(newPath);
    if (!clean) throw new Error('Enter a name for the prompt');
    if (`${clean}.md` === existing.relativePath) return existing;
    const caseOnly = `${clean}.md`.toLowerCase() === existing.relativePath.toLowerCase();
    const target = caseOnly ? `${clean}.md` : await this.availablePath(clean, existing.relativePath);
    const dest = this.absolutePathFor(target);
    const dirResult = await this.electronService.createDirectory(pathDirname(dest));
    if (!dirResult.success) throw new Error(dirResult.error || 'Could not create the folder');
    const moved = await this.electronService.moveFile(existing.filePath, dest);
    if (!moved.success) throw new Error(moved.error || 'Could not move the prompt file');
    const file = this.toPromptFile(existing, dest, target);
    this.promptsSubject.next(
      sortPrompts([...this.promptsSubject.value.filter((f) => f.relativePath !== existing.relativePath), file])
    );
    return file;
  }

  /** Stages the file into `.ensemble-trash` and offers Undo, like other deletes. */
  async deletePrompt(relativePath: string): Promise<void> {
    const existing = this.getPrompt(relativePath);
    if (!existing) return;
    const project = requireProject(this.projectService.getCurrentProject());
    const name = existing.name;
    const staged = await this.electronService.stageForTrash(project.path, existing.filePath, {
      kind: 'prompt',
      recordId: sanitizeTrashRecordId(existing.relativePath),
      name,
    });
    if (!staged.success || !staged.token) {
      const error = staged.error || 'Unknown error';
      this.notificationService.showError(trashStagingFailureMessage(name, error));
      throw new TrashStagingError(error);
    }
    this.promptsSubject.next(this.promptsSubject.value.filter((f) => f.relativePath !== existing.relativePath));
    this.undoDelete.register(staged.token, {
      kind: 'prompt',
      recordId: existing.relativePath,
      name,
      referenceSnapshot: null,
      expiresAt: staged.expiresAt,
      hasConflict: () => !!this.getPrompt(existing.relativePath),
      reload: () => this.forceReload(),
      restoreReferences: async () => ({ restored: 0, skipped: [] }),
    });
  }

  /** Adds (or removes) a character link on a prompt file. */
  async setCharacterLink(relativePath: string, characterId: string, linked: boolean): Promise<void> {
    const existing = this.getPrompt(relativePath);
    if (!existing) throw new Error(`Prompt not found: ${relativePath}`);
    const has = existing.characters.includes(characterId);
    if (has === linked) return;
    const characters = linked
      ? [...existing.characters, characterId]
      : existing.characters.filter((id) => id !== characterId);
    await this.savePrompt(relativePath, { ...existing, characters });
  }

  /**
   * Name a deleted character or location had, for prompt links that still
   * point at it (see `rememberDeletedName()`); null when none is stored.
   */
  deletedName(field: PromptLinkField, targetId: string): string | null {
    const names = this.projectService.getCurrentProject()?.metadata.deletedRecordNames?.[field];
    return names?.[targetId] || null;
  }

  /**
   * Stores a character's or location's name in `ensemble.json`
   * (`deletedRecordNames`) before it is deleted, so a prompt link that still
   * points at it afterwards (a prompt file that could not be read, or a failed
   * unlink whose rollback also failed) shows that name, never an anonymous
   * "Missing character". Writes only when a prompt links the id or some prompt
   * file could not be read; drops names no loaded prompt links any more
   * (unless some file is unreadable). Throws when `ensemble.json` cannot be
   * written, so the caller cancels the delete before anything is changed.
   */
  async rememberDeletedName(field: PromptLinkField, targetId: string, name: string): Promise<void> {
    await this.ensureLoaded();
    const project = this.projectService.getCurrentProject();
    if (!project) return;
    const files = this.promptsSubject.value;
    const linked = (id: string) => files.some((file) => file[field].includes(id));
    if (!linked(targetId) && this.unreadable.size === 0) return;

    const stored = project.metadata.deletedRecordNames ?? {};
    const current = stored[field] ?? {};
    const next: Record<string, string> = {};
    for (const [id, oldName] of Object.entries(current)) {
      if (this.unreadable.size > 0 || linked(id)) next[id] = oldName;
    }
    next[targetId] = name.trim() || (field === 'characters' ? 'Unnamed character' : 'Unnamed location');
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    await this.projectService.updateMetadata({
      deletedRecordNames: { ...stored, [field]: next },
    });
  }

  /** Prompt files whose `characters:` / `locations:` list holds `targetId` (for delete dialogs). */
  async countLinks(field: PromptLinkField, targetId: string): Promise<{ id: string; name: string }[]> {
    await this.ensureLoaded();
    return this.promptsSubject.value
      .filter((file) => file[field].includes(targetId))
      .map((file) => ({ id: file.relativePath, name: file.name }));
  }

  /**
   * Removes a deleted character's or location's id from every prompt file that
   * links it, so no prompt is left pointing at nothing. Returns where each id
   * sat, for Undo.
   *
   * All or nothing: if a file cannot be written, the links already removed are
   * put back and a `PromptUnlinkError` is thrown so the caller cancels the
   * delete (a committed delete must never leave an anonymous dangling id).
   */
  async removeLinks(field: PromptLinkField, targetId: string): Promise<PromptLinkSnapshot> {
    await this.ensureLoaded();
    const snapshot: PromptLinkSnapshot = { field, targetId, removals: [] };
    for (const file of this.promptsSubject.value.filter((f) => f[field].includes(targetId))) {
      const index = file[field].indexOf(targetId);
      try {
        await this.savePrompt(file.relativePath, {
          ...file,
          [field]: file[field].filter((id) => id !== targetId),
        });
      } catch (error) {
        this.logger.error(`Could not unlink ${targetId} from prompt ${file.relativePath}`, error);
        try {
          const { skipped } = await this.restoreLinks(snapshot);
          if (skipped.length > 0) {
            this.logger.error(`Could not relink ${targetId} in: ${skipped.map((s) => s.id).join(', ')}`);
          }
        } catch (restoreError) {
          this.logger.error(`Could not relink ${targetId} after a failed unlink`, restoreError);
        }
        throw new PromptUnlinkError(file.name, error);
      }
      snapshot.removals.push({ relativePath: file.relativePath, promptName: file.name, index });
    }
    return snapshot;
  }

  /** Puts links removed by `removeLinks()` back at their old positions. */
  async restoreLinks(snapshot: PromptLinkSnapshot | null | undefined): Promise<ReferenceRestoreResult> {
    const skipped: ReferenceRestoreSkip[] = [];
    let restored = 0;
    if (!snapshot || snapshot.removals.length === 0) return { restored, skipped };
    await this.ensureLoaded();
    const { field, targetId } = snapshot;
    for (const removal of snapshot.removals) {
      const file = this.getPrompt(removal.relativePath);
      if (!file) {
        skipped.push({ kind: 'prompt', id: removal.relativePath, label: removal.promptName });
        continue;
      }
      if (file[field].includes(targetId)) continue;
      const ids = [...file[field]];
      ids.splice(Math.min(Math.max(removal.index, 0), ids.length), 0, targetId);
      try {
        await this.savePrompt(file.relativePath, { ...file, [field]: ids });
        restored += 1;
      } catch (error) {
        this.logger.error(`Could not relink ${targetId} in prompt ${file.relativePath}`, error);
        skipped.push({ kind: 'prompt', id: removal.relativePath, label: removal.promptName });
      }
    }
    return { restored, skipped };
  }

  /** New prompt for a character under `characters/`, linked to it. */
  async createPromptForCharacter(character: Pick<Character, 'id' | 'name'>): Promise<PromptFile> {
    const base = character.name?.trim() || 'character';
    return this.createPrompt(`${CHARACTER_PROMPTS_FOLDER}/${base}`, { characters: [character.id] });
  }

  /**
   * Returns a project-relative path for an image to attach. Images inside the
   * project are referenced where they are; others are copied into
   * `<prompts>/_images/` so the project stays self-contained.
   */
  async importImage(sourcePath: string): Promise<string> {
    const project = requireProject(this.projectService.getCurrentProject());
    const inside = projectRelativePath(project.path, sourcePath);
    if (inside) return inside;

    const imagesDir = pathJoin(this.projectService.getPromptsFolderPath(), PROMPT_IMAGES_FOLDER);
    const created = await this.electronService.createDirectory(imagesDir);
    if (!created.success) throw new Error(created.error || 'Could not create the prompt images folder');
    const ext = pathExtname(sourcePath).toLowerCase() || '.png';
    const stem = asciiSlugify(pathBasename(sourcePath, pathExtname(sourcePath))) || 'image';
    let dest = pathJoin(imagesDir, `${stem}${ext}`);
    let suffix = 2;
    while (await this.electronService.fileExists(dest)) {
      dest = pathJoin(imagesDir, `${stem}-${suffix}${ext}`);
      suffix += 1;
    }
    const copied = await this.electronService.copyFile(sourcePath, dest);
    if (!copied.success) throw new Error(copied.error || 'Could not copy the image into the project');
    return projectRelativePath(project.path, dest) ?? dest;
  }

  /** Data URL for a project-relative image path (cached per project). */
  async loadImage(relativePath: string): Promise<string | null> {
    const cached = this.imageCache.get(relativePath);
    if (cached) return cached;
    const project = this.projectService.getCurrentProject();
    if (!project) return null;
    try {
      const url = await this.electronService.getImageAsDataUrl(resolveThumbnailPath(project.path, relativePath));
      if (url) this.imageCache.set(relativePath, url);
      return url;
    } catch (error) {
      this.logger.warn(`Could not load prompt image ${relativePath}`, error);
      return null;
    }
  }

  private async write(filePath: string, data: PromptFileData): Promise<void> {
    const result = await this.electronService.writeFileAtomic(filePath, serializePromptFile(data));
    if (!result.success) throw new Error(result.error || `Could not save ${filePath}`);
  }

  private upsert(file: PromptFile): void {
    const others = this.promptsSubject.value.filter((f) => f.relativePath !== file.relativePath);
    this.promptsSubject.next(sortPrompts([...others, file]));
  }

  /**
   * Moves `prompts:` out of character frontmatter into linked prompt files
   * (`<prompts>/characters/<name>.md`), then clears the frontmatter key. A
   * character is skipped when a linked file already holds its first prompt,
   * so an interrupted migration does not create duplicates.
   */
  private async migrateLegacyCharacterPrompts(characters: Character[]): Promise<void> {
    if (this.migrating || !this.projectService.getCurrentProject()) return;
    this.migrating = true;
    let migrated = 0;
    try {
      await this.ensureLoaded();
      for (const character of characters) {
        const prompts = character.prompts || [];
        if (prompts.length === 0) continue;
        try {
          const first = prompts[0].positive.trim();
          const alreadyThere = this.promptsForCharacter(character.id).some((file) =>
            file.sections.some((section) => (section.prompt ?? '').trim() === first)
          );
          if (!alreadyThere) {
            const base = character.name?.trim() || pathBasename(pathDirname(character.relativePath)) || 'character';
            await this.createPrompt(`${CHARACTER_PROMPTS_FOLDER}/${base}`, {
              characters: [character.id],
              sections: sectionsFromCharacterPrompts(prompts),
            });
          }
          await this.characterService.clearLegacyPrompts(character.id);
          migrated += 1;
        } catch (error) {
          this.logger.error(`Could not move prompts of ${character.name || character.id} to the prompts folder`, error);
        }
      }
    } finally {
      this.migrating = false;
    }
    if (migrated > 0) {
      const folder = this.projectService.getCurrentProject()?.metadata.settings?.promptsFolder?.trim() || 'prompts';
      this.notificationService.showSuccess(
        `Moved prompts of ${migrated} character${migrated === 1 ? '' : 's'} into ${folder}/${CHARACTER_PROMPTS_FOLDER}/`
      );
    }
  }

  private async handleFileChange(event: { type: string; path: string; filename: string }): Promise<void> {
    if (!this.loadPromise || !event.filename.toLowerCase().endsWith('.md')) return;
    const project = this.projectService.getCurrentProject();
    if (!project) return;
    let root: string;
    try {
      root = this.projectService.getPromptsFolderPath();
    } catch {
      return;
    }
    const relative = projectRelativePath(root, event.path);
    if (!relative || relative.split('/').includes('.ensemble-trash')) return;

    if (event.type === 'unlink') {
      this.unreadable.delete(relative);
      this.promptsSubject.next(this.promptsSubject.value.filter((f) => f.relativePath !== relative));
      return;
    }
    const file = await this.readPromptFile(event.path, relative);
    if (!file) {
      this.unreadable.add(relative);
      return;
    }
    this.unreadable.delete(relative);
    const current = this.getPrompt(relative);
    if (current && serializePromptFile(current) === serializePromptFile(file)) return;
    this.upsert(file);
  }
}

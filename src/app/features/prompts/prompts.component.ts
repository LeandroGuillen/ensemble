import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest } from 'rxjs';
import { Character } from '../../core/interfaces';
import { Location } from '../../core/interfaces/location.interface';
import { PromptFile } from '../../core/interfaces/prompt.interface';
import { PromptService } from '../../core/services/prompt.service';
import { CharacterService } from '../../core/services/character.service';
import { LocationService } from '../../core/services/location.service';
import { ProjectService } from '../../core/services/project.service';
import { ModalService } from '../../core/services/modal.service';
import { ElectronService } from '../../core/services/electron.service';
import { LoggingService } from '../../core/services/logging.service';
import { isTrashStagingError } from '../../core/trash/trash-record-id';
import { promptCoverImage, promptSearchText, promptVariants } from '../../core/utils/prompt-file.utils';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { PromptImageComponent } from '../../shared/prompt-image/prompt-image.component';
import { PromptEditorComponent } from './components/prompt-editor/prompt-editor.component';
import { PromptPathDialogComponent } from './components/prompt-path-dialog/prompt-path-dialog.component';

export interface PromptFolderNode {
  name: string;
  /** Folder path relative to the prompts folder; '' for the root. */
  path: string;
  folders: PromptFolderNode[];
  files: PromptFile[];
  /** Files in this folder and all subfolders. */
  total: number;
}

/** Builds the folder tree shown in the library's left pane. */
export function buildPromptTree(files: PromptFile[]): PromptFolderNode {
  const root: PromptFolderNode = { name: '', path: '', folders: [], files: [], total: 0 };
  const byPath = new Map<string, PromptFolderNode>([['', root]]);
  const folderFor = (path: string): PromptFolderNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf('/');
    const parent = folderFor(slash === -1 ? '' : path.slice(0, slash));
    const node: PromptFolderNode = { name: path.slice(slash + 1), path, folders: [], files: [], total: 0 };
    parent.folders.push(node);
    byPath.set(path, node);
    return node;
  };
  for (const file of files) folderFor(file.folder).files.push(file);
  const finish = (node: PromptFolderNode): number => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    node.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    node.total = node.files.length + node.folders.reduce((sum, child) => sum + finish(child), 0);
    return node.total;
  };
  finish(root);
  return root;
}

/** All search terms (whitespace-separated) must appear in the prompt's text. */
export function matchesPromptSearch(file: PromptFile, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = promptSearchText(file);
  return terms.every((term) => text.includes(term));
}

@Component({
  selector: 'app-prompts',
  imports: [FormsModule, NgTemplateOutlet, PageHeaderComponent, PromptImageComponent, PromptEditorComponent, PromptPathDialogComponent],
  templateUrl: './prompts.component.html',
  styleUrls: ['./prompts.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptsComponent implements OnInit {
  files: PromptFile[] = [];
  tree: PromptFolderNode = buildPromptTree([]);
  folders: string[] = [];
  searchTerm = '';
  selectedPath: string | null = null;
  selectedFolder = '';
  collapsed = new Set<string>();
  loading = true;

  /** Characters, Lore figures and named drafts: everything a link can point at. */
  linkTargets: Character[] = [];
  locations: Location[] = [];

  dialog: { mode: 'new' | 'rename'; initial: string; target?: PromptFile } | null = null;

  constructor(
    private promptService: PromptService,
    private characterService: CharacterService,
    private locationService: LocationService,
    private projectService: ProjectService,
    private modalService: ModalService,
    private electronService: ElectronService,
    private logger: LoggingService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.selectedPath = params.get('path');
    this.selectedFolder = params.get('folder') || '';

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((map) => {
      const path = map.get('path');
      if (path !== this.selectedPath) {
        this.selectedPath = path;
        if (path) this.expandTo(path);
        this.cdr.markForCheck();
      }
    });

    this.promptService.prompts$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((files) => {
      this.files = files;
      this.tree = buildPromptTree(files);
      this.folders = this.collectFolders(this.tree);
      this.cdr.markForCheck();
    });

    combineLatest([this.characterService.characters$, this.characterService.lore$, this.characterService.drafts$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([characters, lore, drafts]) => {
        const byName = (a: Character, b: Character) => (a.name || '').localeCompare(b.name || '');
        this.linkTargets = [...characters, ...lore, ...drafts.filter((d) => d.name?.trim())].sort(byName);
        this.cdr.markForCheck();
      });

    this.locationService.locations$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((locations) => {
      this.locations = locations;
      this.cdr.markForCheck();
    });

    void this.promptService.ensureLoaded().finally(() => {
      this.loading = false;
      if (this.selectedPath) this.expandTo(this.selectedPath);
      this.cdr.markForCheck();
    });
  }

  get promptsFolderLabel(): string {
    return this.projectService.getCurrentProject()?.metadata.settings?.promptsFolder?.trim() || 'prompts';
  }

  get selectedFile(): PromptFile | null {
    return this.selectedPath ? this.files.find((f) => f.relativePath === this.selectedPath) ?? null : null;
  }

  get searching(): boolean {
    return !!this.searchTerm.trim();
  }

  get searchResults(): PromptFile[] {
    return this.files.filter((file) => matchesPromptSearch(file, this.searchTerm));
  }

  /** Cards in the right pane when no file is open: search results or the selected folder's contents. */
  get gridFiles(): PromptFile[] {
    if (this.searching) return this.searchResults;
    const folder = this.selectedFolder;
    return this.files.filter((f) => !folder || f.folder === folder || f.folder.startsWith(`${folder}/`));
  }

  // ---- Navigation ---------------------------------------------------------

  /** The per-character overview is the Characters page's Prompts view, with all its filters. */
  openCharactersView(): void {
    void this.router.navigate(['/characters'], { queryParams: { view: 'prompts' } });
  }

  selectFile(file: PromptFile): void {
    this.selectedPath = file.relativePath;
    this.selectedFolder = file.folder;
    this.syncUrl();
  }

  selectFolder(path: string): void {
    this.selectedPath = null;
    this.selectedFolder = path;
    this.syncUrl();
  }

  toggleFolder(path: string, event?: Event): void {
    event?.stopPropagation();
    if (this.collapsed.has(path)) this.collapsed.delete(path);
    else this.collapsed.add(path);
    this.collapsed = new Set(this.collapsed);
  }

  private expandTo(relativePath: string): void {
    const parts = relativePath.split('/').slice(0, -1);
    let changed = false;
    for (let i = 1; i <= parts.length; i++) {
      changed = this.collapsed.delete(parts.slice(0, i).join('/')) || changed;
    }
    if (changed) this.collapsed = new Set(this.collapsed);
  }

  private syncUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        path: this.selectedPath,
        folder: !this.selectedPath && this.selectedFolder ? this.selectedFolder : null,
      },
    });
    this.cdr.markForCheck();
  }

  private collectFolders(node: PromptFolderNode): string[] {
    const result: string[] = [];
    const walk = (n: PromptFolderNode) => {
      for (const child of n.folders) {
        result.push(child.path);
        walk(child);
      }
    };
    walk(node);
    return result;
  }

  // ---- Card helpers -------------------------------------------------------

  cover(file: PromptFile): string | null {
    return promptCoverImage(file);
  }

  excerpt(file: PromptFile): string {
    const first = promptVariants(file)[0];
    return (first?.prompt ?? file.sections[0]?.notes ?? '').trim();
  }

  variantCount(file: PromptFile): number {
    return promptVariants(file).length;
  }

  linkNames(file: PromptFile): string[] {
    const names = file.characters
      .map((id) => this.linkTargets.find((c) => c.id === id)?.name)
      .filter((name): name is string => !!name);
    for (const id of file.locations) {
      const name = this.locations.find((l) => l.id === id)?.name;
      if (name) names.push(name);
    }
    return names;
  }

  openCharacter(id: string): void {
    const route = this.characterService.getDraftById(id) ? '/character-draft' : '/character';
    void this.router.navigate([route, id]);
  }

  // ---- Create / rename / delete -------------------------------------------

  openNewDialog(): void {
    const folder = this.selectedFile?.folder ?? this.selectedFolder;
    this.dialog = { mode: 'new', initial: folder ? `${folder}/` : '' };
  }

  openRenameDialog(file: PromptFile): void {
    this.dialog = { mode: 'rename', initial: file.relativePath.replace(/\.md$/i, ''), target: file };
  }

  closeDialog(): void {
    this.dialog = null;
  }

  async onDialogSubmit(path: string): Promise<void> {
    const dialog = this.dialog;
    if (!dialog) return;
    try {
      const file =
        dialog.mode === 'rename' && dialog.target
          ? await this.promptService.movePrompt(dialog.target.relativePath, path)
          : await this.promptService.createPrompt(path, { sections: [{ name: '', notes: '', prompt: '', negative: null, images: [] }] });
      this.dialog = null;
      this.selectFile(file);
    } catch (error) {
      this.logger.error(dialog.mode === 'rename' ? 'Could not rename the prompt' : 'Could not create the prompt', error);
    }
    this.cdr.markForCheck();
  }

  async deletePrompt(file: PromptFile): Promise<void> {
    const confirmed = await this.modalService.confirm(
      `Delete "${file.name}"? You can undo this for a few seconds; after that it goes to the system Trash.`,
      'Delete prompt',
      { confirmText: 'Delete', danger: true }
    );
    if (!confirmed) return;
    try {
      await this.promptService.deletePrompt(file.relativePath);
      if (this.selectedPath === file.relativePath) this.selectFolder(file.folder);
    } catch (error) {
      if (!isTrashStagingError(error)) this.logger.error('Could not delete the prompt', error);
    }
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.cdr.markForCheck();
    try {
      await this.promptService.forceReload();
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  async openPromptsFolder(): Promise<void> {
    const root = this.projectService.getPromptsFolderPath();
    const created = await this.electronService.createDirectory(root);
    if (!created.success) {
      this.logger.error('Could not create the prompts folder', created.error);
      return;
    }
    await this.electronService.openPath(root);
  }
}
